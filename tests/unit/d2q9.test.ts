import { describe, it, expect } from 'vitest';
import { C, W, OPP, MIRROR_Y } from '../../src/physics/d2q9';

describe('d2q9', () => {
  it('weights sum to 1', () => {
    expect(W.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
  it('first moment is zero', () => {
    expect(W.reduce((a, w, i) => a + w * C[i][0], 0)).toBeCloseTo(0, 12);
    expect(W.reduce((a, w, i) => a + w * C[i][1], 0)).toBeCloseTo(0, 12);
  });
  it('second moment is cs^2 = 1/3', () => {
    expect(W.reduce((a, w, i) => a + w * C[i][0] ** 2, 0)).toBeCloseTo(1 / 3, 12);
    expect(W.reduce((a, w, i) => a + w * C[i][1] ** 2, 0)).toBeCloseTo(1 / 3, 12);
  });
  it('OPP reverses velocities', () => {
    for (let i = 0; i < 9; i++) {
      expect(C[OPP[i]]).toEqual([0 - C[i][0], 0 - C[i][1]]);
    }
  });
  it('MIRROR_Y flips y component', () => {
    expect(MIRROR_Y[2]).toBe(4);
    expect(MIRROR_Y[4]).toBe(2);
    expect(MIRROR_Y[5]).toBe(8);
    expect(MIRROR_Y[8]).toBe(5);
    expect(MIRROR_Y[6]).toBe(7);
    expect(MIRROR_Y[7]).toBe(6);
    for (const i of [0, 1, 3]) expect(MIRROR_Y[i]).toBe(i);
    for (let i = 0; i < 9; i++) expect(C[MIRROR_Y[i]]).toEqual([C[i][0], 0 - C[i][1]]);
  });
});
