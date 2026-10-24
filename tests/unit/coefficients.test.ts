import { describe, it, expect } from 'vitest';
import { toCoeffs, CoeffTracker } from '../../src/analysis/coefficients';

const CONV = 200;

function feed(
  t: CoeffTracker,
  total: number,
  stepFn: (i: number) => number,
  cd: (s: number) => number,
  cl: (s: number) => number,
) {
  let s = 0;
  for (let i = 0; s <= total; i++) {
    t.push(s, cd(s), cl(s));
    s += stepFn(i);
  }
}
const every10 = () => 10;
const alt = (i: number) => (i % 2 === 0 ? 7 : 23);

describe('toCoeffs', () => {
  it('normalises force by dynamic pressure', () => {
    const r = toCoeffs(0.5 * 0.08 ** 2 * 40, 0, 0.08, 40);
    expect(r.cd).toBeCloseTo(1, 12);
    expect(r.cl).toBe(0);
  });
  it('normalises fy for cl', () => {
    expect(toCoeffs(0, -0.5 * 0.08 ** 2 * 40 * 2, 0.08, 40).cl).toBeCloseTo(-2, 12);
  });
});

describe('CoeffTracker', () => {
  it('constant signal: mean, no strouhal, steady', () => {
    const t = new CoeffTracker(CONV);
    feed(t, 3000, every10, () => 1.3, () => 0);
    expect(t.mean().cd).toBeCloseTo(1.3, 10);
    expect(t.mean().cl).toBeCloseTo(0, 10);
    expect(t.strouhal()).toBeNull();
    expect(t.isSteady()).toBe(true);
  });

  it('not steady before 10 convective steps', () => {
    const t = new CoeffTracker(CONV);
    feed(t, 1500, every10, () => 1.3, () => 0);
    expect(t.isSteady()).toBe(false);
  });

  it('sine Cl gives Strouhal 0.4', () => {
    const T = 500;
    const t = new CoeffTracker(CONV);
    feed(t, 6000, every10, () => 1.2, (s) => 0.3 * Math.sin((2 * Math.PI * s) / T));
    expect(t.strouhal()!).toBeCloseTo(0.4, 1);
    expect(Math.abs(t.strouhal()! - 0.4)).toBeLessThan(0.4 * 0.02);
  });

  it('sine Cl with irregular sampling gives Strouhal 0.4', () => {
    const T = 500;
    const t = new CoeffTracker(CONV);
    feed(t, 6000, alt, () => 1.2, (s) => 0.3 * Math.sin((2 * Math.PI * s) / T));
    expect(Math.abs(t.strouhal()! - 0.4)).toBeLessThan(0.4 * 0.02);
  });

  it('periodic mean averages over a full period (offset Cd oscillation)', () => {
    const T = 500;
    const t = new CoeffTracker(CONV);
    feed(t, 6137, alt, (s) => 1.2 + 0.2 * Math.sin((2 * Math.PI * s) / T), (s) => 0.3 * Math.sin((2 * Math.PI * s) / T));
    expect(Math.abs(t.mean().cd - 1.2)).toBeLessThan(0.01);
    expect(Math.abs(t.mean().cl)).toBeLessThan(0.01);
  });

  it('small noise gives null Strouhal', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.01;
    const t = new CoeffTracker(CONV);
    feed(t, 6000, every10, () => 1.0, () => rnd());
    expect(t.strouhal()).toBeNull();
  });

  it('too few periods gives null Strouhal', () => {
    const t = new CoeffTracker(CONV);
    feed(t, 1200, every10, () => 1, (s) => 0.3 * Math.sin((2 * Math.PI * s) / 500));
    expect(t.strouhal()).toBeNull();
  });

  it('decaying acoustic transient is averaged out in time (not by sample count)', () => {
    const t = new CoeffTracker(CONV);
    // dense samples early with a high cd, sparse later at the true value
    let s = 0;
    for (; s < 100; s += 1) t.push(s, 5, 0);
    for (; s < 6000; s += 100) t.push(s, 1.0, 0);
    expect(t.mean().cd).toBeCloseTo(1.0, 6);
  });

  it('periodic signal is steady in its means; changing mean is not', () => {
    const t = new CoeffTracker(CONV);
    feed(t, 6000, every10, () => 1.2, (s) => 0.3 * Math.sin((2 * Math.PI * s) / 500));
    expect(t.isSteady()).toBe(true);
    const u = new CoeffTracker(CONV);
    feed(u, 6000, every10, (s) => 1 + s / 3000, () => 0);
    expect(u.isSteady()).toBe(false);
  });

  it('reset clears state', () => {
    const t = new CoeffTracker(CONV);
    feed(t, 3000, every10, () => 1.3, () => 0);
    expect(t.isSteady()).toBe(true);
    t.reset();
    expect(t.isSteady()).toBe(false);
    expect(t.strouhal()).toBeNull();
  });

  it('keeps memory bounded', () => {
    const t = new CoeffTracker(CONV);
    feed(t, 200000, every10, () => 1, () => 0);
    expect(t.sampleCount()).toBeLessThan((20 * CONV) / 10 + 100);
  });
});
