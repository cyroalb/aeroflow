/**
 * Parity page: runs the same case on the CPU reference backend and on a GPU backend
 * (?backend=webgpu|webgl2) and exposes window.parityResult = { maxAbsDiffU, forceRelDiff }.
 * Case: square on Baixa at Re = 100, uniform init + kick, 100 steps, setGeometry(α = 10°), 100 steps.
 */
import { CpuBackend } from '../src/backend/cpu-backend';
import { WebGpuBackend } from '../src/backend/webgpu/backend';
import { WebGL2Backend } from '../src/backend/webgl2/backend';
import type { SimBackend } from '../src/backend/types';
import { NU_AIR, PRESETS } from '../src/config';
import { toLattice } from '../src/physics/units';
import { rasterize, objectCenter } from '../src/geometry/rasterize';
import { makeShape } from '../src/geometry/shapes';
import { fieldScale } from '../src/ui/colormaps';

interface ParityResult {
  backend: string;
  maxAbsDiffU: number;
  forceRelDiff: number;
  cpuForce?: { fx: number; fy: number };
  gpuForce?: { fx: number; fy: number; finite: boolean };
  ms?: number;
  error?: string;
}

declare global {
  interface Window {
    parityResult?: ParityResult;
  }
}

const PRESET = 'baixa' as const;
const STEPS = 100;

async function makeGpu(kind: string): Promise<SimBackend> {
  if (kind === 'webgpu') return new WebGpuBackend();
  if (kind === 'webgl2') return new WebGL2Backend();
  throw new Error(`backend não suportado na página de paridade: ${kind}`);
}

async function run(be: SimBackend) {
  const L = 0.01;
  const lat = toLattice({ U: (100 * NU_AIR) / L, L, alphaDeg: 0, kind: 'square' }, PRESET);
  const { cx, cy } = objectCenter('square', PRESET);
  const { W, H } = PRESETS[PRESET];
  const g0 = rasterize(makeShape('square', lat.Lcells, 0), W, H, cx, cy);
  const g1 = rasterize(makeShape('square', lat.Lcells, 10), W, H, cx, cy);
  const Lc = lat.Lcells;
  await be.init(g0, lat.tau0, lat.uLb);
  be.initUniform(lat.uLb, 0);
  be.addKick(cx + 0.5 * Lc, cy, cx + 2.5 * Lc, cy + Lc, 0.1 * lat.uLb);
  be.step(STEPS);
  be.setGeometry(g1);
  be.step(STEPS);
  const force = await be.readForce();
  const macro = await be.readMacro();
  return { force, macro };
}

interface RenderResult {
  backend: string;
  redPct: number;
  bluePct: number;
  centreRGB: number[];
  error?: string;
}

declare global {
  interface Window {
    renderResult?: RenderResult;
  }
}

/** &render=1: default cylinder (Re 100, Baixa), 2000 steps, vorticity drawn to the visible #field canvas. */
async function runRender(kind: string): Promise<void> {
  const out = document.getElementById('out')!;
  const canvas = document.getElementById('field') as HTMLCanvasElement;
  canvas.hidden = false;
  try {
    const L = 0.01, U = 0.15;
    const lat = toLattice({ U, L, alphaDeg: 0, kind: 'cylinder' }, PRESET);
    const { cx, cy } = objectCenter('cylinder', PRESET);
    const { W, H } = PRESETS[PRESET];
    const geom = rasterize(makeShape('cylinder', lat.Lcells, 0), W, H, cx, cy);
    const be: SimBackend = kind === 'webgl2' ? new WebGL2Backend(canvas) : await makeGpu(kind);
    await be.init(geom, lat.tau0, lat.uLb);
    be.initUniform(lat.uLb, 0);
    be.addKick(cx + 0.5 * lat.Lcells, cy, cx + 2.5 * lat.Lcells, cy + lat.Lcells, 0.1 * lat.uLb);
    be.step(2000);
    be.render('vorticity', canvas, fieldScale('vorticity', lat.uLb, lat.Lcells));
    // same task as render(): copy through a 2D canvas to read the pixels back
    const copy = document.createElement('canvas');
    copy.width = W;
    copy.height = H;
    const ctx = copy.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(canvas, 0, 0);
    const px = ctx.getImageData(0, 0, W, H).data;
    // near-wake region: x in [cx + L, cx + 10L), y within +-2L of the axis (image row = H - 1 - y)
    const x0 = Math.floor(cx + lat.Lcells), x1 = Math.floor(cx + 10 * lat.Lcells);
    const y0 = Math.floor(cy - 2 * lat.Lcells), y1 = Math.floor(cy + 2 * lat.Lcells);
    let n = 0, red = 0, blue = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = 4 * ((H - 1 - y) * W + x);
        const r = px[o], g = px[o + 1], b = px[o + 2];
        n++;
        if (r > b + 40 && r > g + 20) red++;
        if (b > r + 40 && b > g + 20) blue++;
      }
    }
    const co = 4 * ((H - 1 - Math.round(cy)) * W + Math.round(cx));
    window.renderResult = {
      backend: kind,
      redPct: (100 * red) / n,
      bluePct: (100 * blue) / n,
      centreRGB: [px[co], px[co + 1], px[co + 2]],
    };
  } catch (e) {
    window.renderResult = { backend: kind, redPct: 0, bluePct: 0, centreRGB: [], error: String(e) };
  }
  out.textContent = JSON.stringify(window.renderResult);
}

async function main(): Promise<void> {
  const kind = new URLSearchParams(location.search).get('backend') ?? 'webgpu';
  const out = document.getElementById('out')!;
  if (new URLSearchParams(location.search).get('render') === '1') return runRender(kind);
  try {
    const t0 = performance.now();
    const cpu = new CpuBackend();
    const gpu = await makeGpu(kind);
    const a = await run(cpu);
    const b = await run(gpu);
    gpu.destroy();
    cpu.destroy();
    let maxAbsDiffU = 0;
    for (let c = 0; c < a.macro.ux.length; c++) {
      const d = Math.max(Math.abs(a.macro.ux[c] - b.macro.ux[c]), Math.abs(a.macro.uy[c] - b.macro.uy[c]));
      if (!(d <= maxAbsDiffU)) maxAbsDiffU = Number.isNaN(d) ? Infinity : d;
    }
    const fa = a.force, fb = b.force;
    const forceRelDiff = Math.hypot(fa.fx - fb.fx, fa.fy - fb.fy) / Math.hypot(fa.fx, fa.fy);
    window.parityResult = {
      backend: kind,
      maxAbsDiffU,
      forceRelDiff: fb.finite ? forceRelDiff : Infinity,
      cpuForce: { fx: fa.fx, fy: fa.fy },
      gpuForce: fb,
      ms: performance.now() - t0,
    };
  } catch (e) {
    window.parityResult = { backend: kind, maxAbsDiffU: Infinity, forceRelDiff: Infinity, error: String(e) };
  }
  out.textContent = JSON.stringify(window.parityResult, null, 2);
}

void main();
