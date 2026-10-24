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
  upperRedPct: number;
  upperBluePct: number;
  lowerRedPct: number;
  lowerBluePct: number;
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
    // orientation: counts above (y > cy, upper image half) and below the axis
    let nUp = 0, nLo = 0, upRed = 0, upBlue = 0, loRed = 0, loBlue = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = 4 * ((H - 1 - y) * W + x);
        const r = px[o], g = px[o + 1], b = px[o + 2];
        n++;
        const isRed = r > b + 40 && r > g + 20, isBlue = b > r + 40 && b > g + 20;
        if (isRed) red++;
        if (isBlue) blue++;
        if (y > cy) {
          nUp++;
          if (isRed) upRed++;
          if (isBlue) upBlue++;
        } else if (y < cy) {
          nLo++;
          if (isRed) loRed++;
          if (isBlue) loBlue++;
        }
      }
    }
    const co = 4 * ((H - 1 - Math.round(cy)) * W + Math.round(cx));
    window.renderResult = {
      backend: kind,
      redPct: (100 * red) / n,
      bluePct: (100 * blue) / n,
      upperRedPct: (100 * upRed) / nUp,
      upperBluePct: (100 * upBlue) / nUp,
      lowerRedPct: (100 * loRed) / nLo,
      lowerBluePct: (100 * loBlue) / nLo,
      centreRGB: [px[co], px[co + 1], px[co + 2]],
    };
  } catch (e) {
    window.renderResult = { backend: kind, redPct: 0, bluePct: 0, upperRedPct: 0, upperBluePct: 0, lowerRedPct: 0, lowerBluePct: 0, centreRGB: [], error: String(e) };
  }
  out.textContent = JSON.stringify(window.renderResult);
}

interface RecoverResult {
  backend: string;
  lostForceFinite?: boolean; // webgl2: readForce while the context is lost
  lostInitError?: string; // webgl2: init() while lost and never restored (bounded wait)
  maxAbsDiffU: number;
  forceRelDiff: number;
  error?: string;
}

declare global {
  interface Window {
    recoverResult?: RecoverResult;
  }
}

const once = (t: EventTarget, type: string) => new Promise<void>((r) => t.addEventListener(type, () => r(), { once: true }));

/**
 * &recover=1: runs the parity case, loses the GPU (WebGPU: device.destroy(); WebGL2:
 * WEBGL_lose_context), then runs it again on the same backend object and compares with the CPU.
 */
async function runRecover(kind: string): Promise<void> {
  const out = document.getElementById('out')!;
  const res: RecoverResult = { backend: kind, maxAbsDiffU: Infinity, forceRelDiff: Infinity };
  try {
    const cpu = await run(new CpuBackend());
    let after: Awaited<ReturnType<typeof run>>;
    if (kind === 'webgpu') {
      const be = new WebGpuBackend();
      await run(be);
      const dev = (be as unknown as { device: GPUDevice }).device;
      dev.destroy();
      await dev.lost;
      after = await run(be);
      be.destroy();
    } else {
      const canvas = document.getElementById('field') as HTMLCanvasElement;
      const be = new WebGL2Backend(canvas);
      await run(be);
      const ext = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
      const lost = once(canvas, 'webglcontextlost');
      ext.loseContext();
      await lost;
      res.lostForceFinite = (await be.readForce()).finite;
      try {
        await run(be); // never restored: init() gives up after its bounded wait
      } catch (e) {
        res.lostInitError = String(e);
      }
      const again = run(be); // waits for the restoration
      const restored = once(canvas, 'webglcontextrestored');
      ext.restoreContext();
      await restored;
      after = await again;
      be.destroy();
    }
    let maxAbsDiffU = 0;
    for (let c = 0; c < cpu.macro.ux.length; c++) {
      const d = Math.max(Math.abs(cpu.macro.ux[c] - after.macro.ux[c]), Math.abs(cpu.macro.uy[c] - after.macro.uy[c]));
      if (!(d <= maxAbsDiffU)) maxAbsDiffU = Number.isNaN(d) ? Infinity : d;
    }
    const fa = cpu.force, fb = after.force;
    res.maxAbsDiffU = maxAbsDiffU;
    res.forceRelDiff = fb.finite ? Math.hypot(fa.fx - fb.fx, fa.fy - fb.fy) / Math.hypot(fa.fx, fa.fy) : Infinity;
  } catch (e) {
    res.error = String(e);
  }
  window.recoverResult = res;
  out.textContent = JSON.stringify(res, null, 2);
}

async function main(): Promise<void> {
  const kind = new URLSearchParams(location.search).get('backend') ?? 'webgpu';
  const out = document.getElementById('out')!;
  if (new URLSearchParams(location.search).get('render') === '1') return runRender(kind);
  if (new URLSearchParams(location.search).get('recover') === '1') return runRecover(kind);
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
