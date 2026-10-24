import { describe, it, expect } from 'vitest';
import { reynolds, toLattice } from '../../src/physics/units';

const cyl = { U: 0.15, L: 0.01, alphaDeg: 0, kind: 'cylinder' as const };

describe('units', () => {
  it('reynolds(0.15, 0.01) is about 100', () => {
    expect(reynolds(0.15, 0.01)).toBeCloseTo(100, 6);
  });
  it('cylinder on alta', () => {
    const l = toLattice(cyl, 'alta');
    expect(l.Lcells).toBe(24);
    expect(l.uLb).toBe(0.08);
    expect(l.nuLb).toBeCloseTo((0.08 * 24) / 100, 9);
    expect(l.tau0).toBeCloseTo(0.5576, 6);
    expect(l.showFidelityWarning).toBe(false);
    expect(l.dtPhys).toBeCloseTo(((0.01 / 24) * 0.08) / 0.15, 12);
  });
  it('cylinder on media: Re/18 ≈ 5.56, no warning', () => {
    const l = toLattice(cyl, 'media');
    expect(l.Lcells).toBe(18);
    expect(l.re / l.Lcells).toBeCloseTo(100 / 18, 6);
    expect(l.showFidelityWarning).toBe(false);
  });
  it('default cylinder on baixa: Re/12 ≈ 8.33 ≤ 10, no warning', () => {
    const l = toLattice(cyl, 'baixa');
    expect(l.Lcells).toBe(12);
    expect(l.re / l.Lcells).toBeCloseTo(100 / 12, 6);
    expect(l.showFidelityWarning).toBe(false);
  });
  it('cylinder at 0.2 m/s on baixa: Re/12 ≈ 11.1 > 10, warning', () => {
    const l = toLattice({ ...cyl, U: 0.2 }, 'baixa');
    expect(l.re / l.Lcells).toBeCloseTo(0.2 * 0.01 / 1.5e-5 / 12, 6);
    expect(l.showFidelityWarning).toBe(true);
  });
  it('naca0012 at 30 m/s, 1 m on alta: Re = 2e6, warning', () => {
    const l = toLattice({ U: 30, L: 1, alphaDeg: 0, kind: 'naca0012' }, 'alta');
    expect(l.Lcells).toBe(48);
    expect(l.re).toBeCloseTo(2e6, 0);
    expect(l.showFidelityWarning).toBe(true);
  });
});
