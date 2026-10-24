import { describe, it, expect } from 'vitest';
import { SweepStore } from '../../src/ui/sweepStore';

describe('SweepStore', () => {
  it('keeps distinct alphas and replaces within the rounding step', () => {
    const a = new SweepStore();
    a.add('naca0012', 4.0, 0.4);
    a.add('naca0012', 4.2, 0.45);
    expect(a.points('naca0012')).toHaveLength(2);
    const b = new SweepStore();
    b.add('naca0012', 4.0, 0.4);
    b.add('naca0012', 4.1, 0.5);
    expect(b.points('naca0012')).toHaveLength(1);
    expect(b.points('naca0012')[0]![1]).toBe(0.5);
  });
  it('rounds Re to 3 significant digits and sorts by x', () => {
    const s = new SweepStore();
    s.add('cylinder', 1000, 1);
    s.add('cylinder', 100.04, 2);
    s.add('cylinder', 100.01, 3);
    expect(s.points('cylinder')).toEqual([[100, 3], [1000, 1]]);
  });
  it('keeps points per kind and clears one kind or all', () => {
    const s = new SweepStore();
    s.add('cylinder', 100, 1.3);
    s.add('naca0012', 4, 0.4);
    s.clear('naca0012');
    expect(s.points('naca0012')).toEqual([]);
    expect(s.points('cylinder')).toHaveLength(1);
    s.clear();
    expect(s.points('cylinder')).toEqual([]);
  });
});
