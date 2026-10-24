import { describe, it, expect } from 'vitest';
import { LbmCpu, feq } from '../../src/physics/lbm-cpu';
import { rasterize } from '../../src/geometry/rasterize';
import { makeShape } from '../../src/geometry/shapes';

describe('Poiseuille channel', () => {
  it('develops a parabolic profile (halfway bounce-back walls at y=0.5, 39.5)', () => {
    const W = 300, H = 41;
    const g = rasterize((_x, y) => Math.min(y - 1, 39 - y), W, H, 0, 0);
    const s = new LbmCpu(g, 0.8, 0.05);
    s.initUniform(0.05, 0);
    const meanRhoAll = () => {
      let r = 0, k = 0;
      for (let c = 0; c < W * H; c++) if (!g.solid[c]) { r += s.rho[c]; k++; }
      return r / k;
    };
    const t0 = performance.now();
    for (let n = 0; n < 15000; n++) s.step();
    const rho15k = meanRhoAll();
    for (let n = 15000; n < 20000; n++) s.step();
    const ms = performance.now() - t0;
    const rho20k = meanRhoAll();
    const x = 200;
    let max = 0, sum = 0, cnt = 0;
    for (let y = 0; y < H; y++) {
      const c = y * W + x;
      if (g.solid[c]) continue;
      max = Math.max(max, s.ux[c]);
      sum += s.ux[c];
      cnt++;
    }
    const mean = sum / cnt;
    let worst = 0;
    for (let y = 0; y < H; y++) {
      const c = y * W + x;
      if (g.solid[c]) continue;
      const exact = 1 - ((2 * (y - 20)) / 39) ** 2;
      const err = Math.abs(s.ux[c] / max - exact);
      worst = Math.max(worst, err);
      expect(err).toBeLessThan(0.03);
    }
    const ratio = max / mean;
    console.log(`poiseuille: ${ms.toFixed(0)} ms, fluid rows=${cnt}, max=${max.toFixed(5)}, mean=${mean.toFixed(5)}, max/mean=${ratio.toFixed(4)}, worst profile err=${worst.toFixed(4)}`);
    expect(cnt).toBe(39);
    expect(Math.abs(ratio - 1.5) / 1.5).toBeLessThan(0.03);

    // steadiness / no mass growth: mean rho at 15000 vs 20000 steps
    console.log(`poiseuille: mean rho @15000=${rho15k.toFixed(6)}, @20000=${rho20k.toFixed(6)}`);
    expect(Math.abs(rho20k - rho15k)).toBeLessThan(1e-3);

    // mass flux Σ rho·ux across columns x = 50 and x = 250 (steady state => equal)
    const flux = (xc: number) => {
      let q = 0;
      for (let y = 0; y < H; y++) { const c = y * W + xc; if (!g.solid[c]) q += s.rho[c] * s.ux[c]; }
      return q;
    };
    const q50 = flux(50), q250 = flux(250);
    console.log(`poiseuille: flux x=50: ${q50.toFixed(5)}, x=250: ${q250.toFixed(5)}, rel diff=${(Math.abs(q50 - q250) / q50).toExponential(3)}`);
    expect(Math.abs(q50 - q250) / q50).toBeLessThan(0.02);

    // fixed-pressure outlet: rho = 1 at x = W−1 on every fluid row
    let worstOut = 0;
    for (let y = 0; y < H; y++) {
      const c = y * W + W - 1;
      if (g.solid[c]) continue;
      worstOut = Math.max(worstOut, Math.abs(s.rho[c] - 1));
    }
    // pressure gradient: −dρ/dx = 3·dp/dx = 36·ν·ū/D² (D = 39, walls at y = 0.5, 39.5)
    const colRho = (xc: number) => {
      let r = 0, k = 0;
      for (let y = 0; y < H; y++) { const c = y * W + xc; if (!g.solid[c]) { r += s.rho[c]; k++; } }
      return r / k;
    };
    const grad = (colRho(50) - colRho(250)) / 200;
    const nu = (0.8 - 0.5) / 3;
    const gradTh = (36 * nu * mean) / (39 * 39);
    console.log(`poiseuille: outlet |rho−1| max=${worstOut.toExponential(3)}, −drho/dx=${grad.toExponential(4)}, analytic=${gradTh.toExponential(4)}, rel err=${(Math.abs(grad - gradTh) / gradTh).toFixed(4)}`);
    expect(worstOut).toBeLessThan(1e-3);
    expect(Math.abs(grad - gradTh) / gradTh).toBeLessThan(0.05);
  });

  it('setGeometry(cylinder) on a uniform flow stays finite; solid cells hold feq(1,0,0)', () => {
    const W = 240, H = 96, N = W * H;
    const s = new LbmCpu(rasterize(() => 1, W, H, 0, 0), 0.56, 0.08);
    s.initUniform(0.08, 0);
    for (let n = 0; n < 50; n++) s.step();
    const g = rasterize(makeShape('cylinder', 16, 0), W, H, 48, 48);
    s.setGeometry(g);
    for (let n = 0; n < 500; n++) s.step();
    for (let k = 0; k < s.f.length; k++) expect(Number.isFinite(s.f[k])).toBe(true);
    let nSolid = 0;
    for (let c = 0; c < N; c++) {
      if (!g.solid[c]) continue;
      nSolid++;
      for (let i = 0; i < 9; i++) expect(s.f[i * N + c]).toBe(Math.fround(feq(i, 1, 0, 0)));
    }
    expect(nSolid).toBeGreaterThan(0);
  });
});
