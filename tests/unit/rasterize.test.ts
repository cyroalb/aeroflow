import { describe, it, expect } from 'vitest';
import { makeShape } from '../../src/geometry/shapes';
import { rasterize, objectCenter } from '../../src/geometry/rasterize';
import { C } from '../../src/physics/d2q9';

describe('rasterize', () => {
  it('cylinder area within 5%', () => {
    const g = rasterize(makeShape('cylinder', 16, 0), 240, 96, 48, 48);
    let n = 0;
    for (const s of g.solid) n += s;
    expect(Math.abs(n - Math.PI * 64) / (Math.PI * 64)).toBeLessThan(0.05);
  });
  it('links are consistent', () => {
    const W = 240, H = 96;
    const g = rasterize(makeShape('naca2412', 32, 5), W, H, 72, 48);
    expect(g.links.length).toBeGreaterThan(0);
    for (let k = 0; k < g.links.length; k += 2) {
      const cell = g.links[k], i = g.links[k + 1];
      const x = cell % W, y = (cell / W) | 0;
      expect(g.solid[cell]).toBe(0);
      expect(g.solid[(y + C[i][1]) * W + x + C[i][0]]).toBe(1);
      const q = g.q[i * W * H + cell];
      expect(q).toBeGreaterThan(0);
      expect(q).toBeLessThanOrEqual(1);
    }
  });
  it('Bouzidi q for cylinder', () => {
    const W = 60, H = 40;
    const g = rasterize(makeShape('cylinder', 15, 0), W, H, 30, 20);
    const cell = 20 * W + 38;
    expect(g.solid[cell]).toBe(0);
    expect(Math.abs(g.q[3 * W * H + cell] - 0.5)).toBeLessThan(1e-3);
  });
  it('objectCenter', () => {
    expect(objectCenter('cylinder', 'baixa')).toEqual({ cx: 48, cy: 48 });
    expect(objectCenter('naca0012', 'baixa').cx).toBeCloseTo(72);
  });
});
