import { describe, it, expect } from 'vitest';
import { makeShape } from '../../src/geometry/shapes';

function extentY(f: (x: number, y: number) => number, x: number) {
  let lo = Infinity, hi = -Infinity;
  for (let y = -40; y <= 40; y += 0.01) if (f(x, y) < 0) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
  return [lo, hi];
}

describe('shapes', () => {
  it('cylinder sdf', () => {
    const f = makeShape('cylinder', 20, 0);
    expect(f(10, 0)).toBeCloseTo(0, 6);
    expect(f(0, 0)).toBeCloseTo(-10, 6);
  });
  it('NACA0012 max thickness ~0.12 chord at ~0.3 chord', () => {
    const L = 100;
    const f = makeShape('naca0012', L, 0);
    let best = 0, bestX = 0;
    for (let xc = 0.05; xc < 0.95; xc += 0.01) {
      const [lo, hi] = extentY(f, (xc - 0.25) * L);
      if (hi - lo > best) { best = hi - lo; bestX = xc; }
    }
    expect(best / L).toBeCloseTo(0.12, 2);
    expect(bestX).toBeGreaterThan(0.25);
    expect(bestX).toBeLessThan(0.35);
  });
  it('NACA2412 camber above chord', () => {
    const f = makeShape('naca2412', 100, 0);
    const [lo, hi] = extentY(f, 0.15 * 100);
    expect((lo + hi) / 2).toBeGreaterThan(0.5);
  });
  it('positive alpha moves nose up', () => {
    const f = makeShape('naca0012', 100, 10);
    const [lo, hi] = extentY(f, -0.2 * 100);
    expect((lo + hi) / 2).toBeGreaterThan(0);
  });
  it('plate taller than wide at alpha 0', () => {
    const f = makeShape('plate', 30, 0);
    expect(f(0, 14)).toBeLessThan(0);
    expect(f(3, 0)).toBeGreaterThan(0);
  });
  it('square', () => {
    const f = makeShape('square', 10, 0);
    expect(f(0, 0)).toBeCloseTo(-5, 6);
    expect(f(5, 0)).toBeCloseTo(0, 6);
  });
});
