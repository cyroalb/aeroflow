/**
 * Parity page: runs the same case on the CPU reference backend and on a GPU backend
 * (?backend=webgpu|webgl2) and exposes window.parityResult = { maxAbsDiffU, forceRelDiff }.
 * Case: square on Baixa at Re = 100, uniform init + kick, 100 steps, setGeometry(α = 10°), 100 steps.
 */
import { CpuBackend } from '../src/backend/cpu-backend';
import { WebGpuBackend } from '../src/backend/webgpu/backend';
import type { SimBackend } from '../src/backend/types';
import { NU_AIR, PRESETS } from '../src/config';
import { toLattice } from '../src/physics/units';
import { rasterize, objectCenter } from '../src/geometry/rasterize';
import { makeShape } from '../src/geometry/shapes';

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

async function main(): Promise<void> {
  const kind = new URLSearchParams(location.search).get('backend') ?? 'webgpu';
  const out = document.getElementById('out')!;
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
