import { describe, it, expect } from 'vitest';
import {
  DIVERGING,
  SEQUENTIAL,
  SOLID_RGB,
  fieldScale,
  colorIndex,
  cpToLattice,
  colormapFor,
} from '../../src/ui/colormaps';

const lum = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('colormaps', () => {
  it('both maps have 256 RGB entries in 0..255', () => {
    for (const m of [DIVERGING, SEQUENTIAL]) {
      expect(m.length).toBe(256);
      for (const c of m) for (const v of c) expect(v >= 0 && v <= 255 && Number.isInteger(v)).toBe(true);
    }
  });

  it('diverging: midpoint is the darkest entry, low end blue, high end red', () => {
    const l = DIVERGING.map(lum);
    const min = Math.min(...l);
    const darkest = l.indexOf(min);
    expect([127, 128]).toContain(darkest);
    expect(lum(DIVERGING[127])).toBeCloseTo(lum(DIVERGING[128]), 0);
    const lo = DIVERGING[0], hi = DIVERGING[255];
    expect(lo[2]).toBeGreaterThan(lo[0] + 40);
    expect(hi[0]).toBeGreaterThan(hi[2] + 40);
    expect(min).toBeLessThan(30);
  });

  it('sequential: luminance increases monotonically, dark to light', () => {
    const l = SEQUENTIAL.map(lum);
    for (let i = 1; i < 256; i++) expect(l[i]).toBeGreaterThanOrEqual(l[i - 1] - 1e-9);
    expect(l[255] - l[0]).toBeGreaterThan(150);
  });

  it('solid colour is #9aa4b2', () => {
    expect([...SOLID_RGB]).toEqual([0x9a, 0xa4, 0xb2]);
  });

  it('fieldScale values', () => {
    expect(fieldScale('vorticity', 0.08, 12)).toEqual([-4 * 0.08 / 12, 4 * 0.08 / 12]);
    expect(fieldScale('speed', 0.08, 12)).toEqual([0, 1.6 * 0.08]);
  });

  it('pressure range is in (rho-1)/3 units: Cp=-3 and Cp=+1 map to the ends', () => {
    const uLb = 0.08;
    const r = fieldScale('pressure', uLb, 12);
    expect(colorIndex(cpToLattice(-3, uLb), r)).toBe(0);
    expect(colorIndex(cpToLattice(1, uLb), r)).toBe(255);
    expect(colorIndex(cpToLattice(-1, uLb), r)).toBe(128);
    // rho = 1 gives Cp 0 -> 3/4 of the way from -3 to 1
    expect(colorIndex(0, r)).toBe(Math.round(0.75 * 255));
  });

  it('colorIndex clamps', () => {
    expect(colorIndex(-5, [0, 1])).toBe(0);
    expect(colorIndex(5, [0, 1])).toBe(255);
  });

  it('colormapFor picks diverging for vorticity/pressure and sequential for speed', () => {
    expect(colormapFor('vorticity')).toBe(DIVERGING);
    expect(colormapFor('pressure')).toBe(DIVERGING);
    expect(colormapFor('speed')).toBe(SEQUENTIAL);
  });
});
