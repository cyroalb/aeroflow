import { describe, it, expect } from 'vitest';
import { LbmCpu } from '../../src/physics/lbm-cpu';
import { rasterize, objectCenter } from '../../src/geometry/rasterize';
import { makeShape } from '../../src/geometry/shapes';
import { U_LB } from '../../src/config';
import type { ObjectKind } from '../../src/physics/units';

// Re ≈ 1.3e7 on the Baixa preset (100 m/s, 2 m): nu_lb = 0.08·16/1.3e7
const TAU0 = 0.5 + (3 * 0.08 * 16) / 1.3e7;

function runFinite(kind: ObjectKind, L: number, alpha: number, steps: number) {
  const W = 240, H = 96;
  const { cx, cy } = objectCenter(kind, 'baixa');
  const g = rasterize(makeShape(kind, L, alpha), W, H, cx, cy);
  const s = new LbmCpu(g, TAU0, U_LB);
  s.initUniform(U_LB, 0);
  const t0 = performance.now();
  for (let n = 0; n < steps; n++) s.step();
  const ms = performance.now() - t0;
  let bad = 0, maxU = 0, minRho = Infinity, maxRho = -Infinity;
  for (let k = 0; k < s.f.length; k++) if (!Number.isFinite(s.f[k])) bad++;
  for (let c = 0; c < W * H; c++) {
    if (!Number.isFinite(s.rho[c]) || !Number.isFinite(s.ux[c]) || !Number.isFinite(s.uy[c])) bad++;
    maxU = Math.max(maxU, Math.hypot(s.ux[c], s.uy[c]));
    minRho = Math.min(minRho, s.rho[c]);
    maxRho = Math.max(maxRho, s.rho[c]);
  }
  console.log(`stability ${kind} α=${alpha}: ${ms.toFixed(0)} ms, |u|max=${maxU.toFixed(4)}, rho=[${minRho.toFixed(4)}, ${maxRho.toFixed(4)}]`);
  return bad;
}

describe('stability at Re ≈ 1.3e7 (tau0 ≈ 0.5000003)', () => {
  it('cylinder 240×96: 3000 steps finite', () => {
    expect(runFinite('cylinder', 16, 0, 3000)).toBe(0);
  });
  it('NACA 0012 at α = 30°: 3000 steps finite', () => {
    expect(runFinite('naca0012', 32, 30, 3000)).toBe(0);
  });
});
