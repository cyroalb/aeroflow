import { describe, it, expect } from 'vitest';
import { LbmCpu } from '../../src/physics/lbm-cpu';
import { rasterize, objectCenter } from '../../src/geometry/rasterize';
import { makeShape } from '../../src/geometry/shapes';
import { PRESETS } from '../../src/config';

// Slow (~46 s each): moved out of the unit project so they do not gate the Pages deploy.
const { W, H } = PRESETS.baixa;
const U = 0.08, RE = 20;
const tauFor = (Lcells: number) => 0.5 + 3 * ((U * Lcells) / RE);

function runBody(kind: 'cylinder' | 'naca0012', Lcells: number, steps: number): { fx: number; fy: number } {
  const { cx, cy } = objectCenter(kind, 'baixa');
  const g = rasterize(makeShape(kind, Lcells, 0), W, H, cx, cy);
  const s = new LbmCpu(g, tauFor(Lcells), U);
  s.initUniform(U, 0);
  for (let n = 0; n < steps; n++) s.step();
  return { ...s.lastForce };
}

describe('momentum-exchange force on symmetric bodies (Re = 20, Baixa grid)', () => {
  it('symmetric cylinder, Re = 20 (Lcells 16, Baixa grid): Fx > 0 and |Fy|/Fx < 0.01 after 6000 steps', () => {
    const F = runBody('cylinder', 16, 6000);
    expect(F.fx).toBeGreaterThan(0);
    expect(Math.abs(F.fy) / F.fx).toBeLessThan(0.01);
  }, 120_000);

  it('NACA 0012 at α = 0, Re = 20 (chord 32, Baixa grid): Fx > 0 and |Fy| < 0.02·Fx after 6000 steps', () => {
    const F = runBody('naca0012', 32, 6000);
    expect(F.fx).toBeGreaterThan(0);
    expect(Math.abs(F.fy)).toBeLessThan(0.02 * F.fx);
  }, 120_000);
});
