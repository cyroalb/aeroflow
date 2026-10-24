import { describe, it, expect } from 'vitest';
import { LbmCpu, feq } from '../../src/physics/lbm-cpu';
import { C } from '../../src/physics/d2q9';
import { rasterize } from '../../src/geometry/rasterize';
import { makeShape } from '../../src/geometry/shapes';

const empty = (W: number, H: number) => rasterize(() => 1, W, H, 0, 0);

function totalMass(s: LbmCpu, solid: Uint8Array): number {
  let m = 0;
  for (let c = 0; c < solid.length; c++) if (!solid[c]) m += s.rho[c];
  return m;
}

describe('feq', () => {
  it('moments: Σ feq = rho, Σ c feq = rho u (random inputs)', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let k = 0; k < 200; k++) {
      const rho = 0.8 + 0.4 * rnd();
      const ux = 0.3 * (rnd() - 0.5);
      const uy = 0.3 * (rnd() - 0.5);
      let m0 = 0, mx = 0, my = 0;
      for (let i = 0; i < 9; i++) {
        const v = feq(i, rho, ux, uy);
        m0 += v;
        mx += C[i][0] * v;
        my += C[i][1] * v;
      }
      expect(Math.abs(m0 - rho)).toBeLessThan(1e-12);
      expect(Math.abs(mx - rho * ux)).toBeLessThan(1e-12);
      expect(Math.abs(my - rho * uy)).toBeLessThan(1e-12);
    }
  });
});

describe('LbmCpu', () => {
  it('uniform flow without obstacle stays uniform for 100 steps', () => {
    const W = 64, H = 32, u = 0.08;
    const s = new LbmCpu(empty(W, H), 0.6, u);
    s.initUniform(u, 0);
    for (let n = 0; n < 100; n++) s.step();
    for (let c = 0; c < W * H; c++) {
      expect(Math.abs(s.rho[c] - 1)).toBeLessThan(1e-6);
      expect(Math.abs(s.ux[c] - u)).toBeLessThan(1e-6);
      expect(Math.abs(s.uy[c])).toBeLessThan(1e-6);
    }
    expect(s.lastForce).toEqual({ fx: 0, fy: 0 });
  });

  it('mass stays bounded with an obstacle: drift < 1e-3 @500, mean rho within 1% of 1 @3000', () => {
    const W = 240, H = 96;
    const g = rasterize(makeShape('cylinder', 16, 0), W, H, 48, 48);
    const s = new LbmCpu(g, 0.56, 0.08);
    s.initUniform(0.08, 0);
    let nFluid = 0;
    for (const v of g.solid) if (!v) nFluid++;
    const m0 = totalMass(s, g.solid);
    for (let n = 0; n < 500; n++) s.step();
    const m1 = totalMass(s, g.solid);
    for (let n = 500; n < 3000; n++) s.step();
    const meanRho = totalMass(s, g.solid) / nFluid;
    console.log(`mass drift @500: ${((m1 - m0) / m0).toExponential(3)}, mean rho @3000: ${meanRho.toFixed(5)}`);
    expect(Math.abs(m1 - m0) / m0).toBeLessThan(1e-3);
    expect(Math.abs(meanRho - 1)).toBeLessThan(0.01);
  }, 60_000);

  it('solid cells hold feq(1,0,0) and macroscopic (1,0,0)', () => {
    const W = 80, H = 40;
    const g = rasterize(makeShape('square', 10, 0), W, H, 20, 20);
    const s = new LbmCpu(g, 0.6, 0.05);
    s.initUniform(0.05, 0);
    for (let n = 0; n < 50; n++) s.step();
    const N = W * H;
    for (let c = 0; c < N; c++) {
      if (!g.solid[c]) continue;
      expect(s.rho[c]).toBe(1);
      expect(s.ux[c]).toBe(0);
      expect(s.uy[c]).toBe(0);
      for (let i = 0; i < 9; i++) expect(s.f[i * N + c]).toBe(Math.fround(feq(i, 1, 0, 0)));
    }
  });

  it('addKick adds dvy to fluid cells in the (inclusive, clipped) box only', () => {
    const W = 40, H = 20;
    const s = new LbmCpu(empty(W, H), 0.6, 0.05);
    s.initUniform(0.05, 0);
    s.addKick(-5, 3, 4, 5, 0.01);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = y * W + x;
        const inBox = x <= 4 && y >= 3 && y <= 5;
        expect(s.uy[c]).toBeCloseTo(inBox ? 0.01 : 0, 6);
        expect(s.ux[c]).toBeCloseTo(0.05, 6);
      }
  });
});
