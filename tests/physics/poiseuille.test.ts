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
    const t0 = performance.now();
    for (let n = 0; n < 20000; n++) s.step();
    const ms = performance.now() - t0;
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
