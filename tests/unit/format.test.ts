import { describe, it, expect } from 'vitest';
import { formatRe, formatSigned, formatOverlay, formatSimTime, formatSlowMotion } from '../../src/ui/format';

describe('formatRe (pt-BR scientific, 2 significant digits)', () => {
  it.each([
    [100, '1,0×10²'],
    [2e6, '2,0×10⁶'],
    [1234, '1,2×10³'],
    [99.96, '1,0×10²'],
    [9.96e5, '1,0×10⁶'],
    [1.3e7, '1,3×10⁷'],
    [5, '5,0×10⁰'],
    [0.0667, '6,7×10⁻²'],
    [12345678901, '1,2×10¹⁰'],
  ])('%s → %s', (re, out) => {
    expect(formatRe(re)).toBe(out);
  });
  it('non-finite → em dash', () => {
    expect(formatRe(NaN)).toBe('—');
    expect(formatRe(0)).toBe('—');
  });
});

describe('formatSigned', () => {
  it('comma decimal, U+2212 minus, no plus sign', () => {
    expect(formatSigned(1.333, 2)).toBe('1,33');
    expect(formatSigned(-0.05, 2)).toBe('−0,05');
    expect(formatSigned(0.1654, 3)).toBe('0,165');
    expect(formatSigned(1234.5, 2)).toBe('1234,50');
  });
  it('negative values that round to zero print as 0', () => {
    expect(formatSigned(-0.001, 2)).toBe('0,00');
  });
  it('non-finite → em dash', () => {
    expect(formatSigned(NaN, 2)).toBe('—');
    expect(formatSigned(Infinity, 2)).toBe('—');
  });
});

describe('formatOverlay', () => {
  it('Re · Cd · Cl · St', () => {
    expect(formatOverlay({ re: 100, cd: 1.333, cl: -0.05, st: 0.1654 })).toBe(
      'Re 1,0×10² · Cd 1,33 · Cl −0,05 · St 0,165',
    );
  });
  it('St hidden when null', () => {
    expect(formatOverlay({ re: 2e6, cd: 0.012, cl: 0.32, st: null })).toBe('Re 2,0×10⁶ · Cd 0,01 · Cl 0,32');
  });
});

describe('footer formats', () => {
  it('sim time in seconds', () => {
    expect(formatSimTime(0)).toBe('t = 0,000 s');
    expect(formatSimTime(1.23456)).toBe('t = 1,23 s');
    expect(formatSimTime(0.0123)).toBe('t = 0,012 s');
    expect(formatSimTime(1234.5)).toBe('t = 1.235 s');
  });
  it('slow motion / time-lapse factor', () => {
    expect(formatSlowMotion(14.2)).toBe('câmera lenta ×14');
    expect(formatSlowMotion(2.345)).toBe('câmera lenta ×2,3');
    expect(formatSlowMotion(1500)).toBe('câmera lenta ×1.500');
    expect(formatSlowMotion(0.1)).toBe('acelerado ×10');
    expect(formatSlowMotion(NaN)).toBe('');
  });
});
