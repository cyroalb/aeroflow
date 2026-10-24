import { describe, it, expect } from 'vitest';
import { LbmCpu } from '../../src/physics/lbm-cpu';
import { rasterize, objectCenter, type Geometry } from '../../src/geometry/rasterize';
import { makeShape } from '../../src/geometry/shapes';
import { PRESETS } from '../../src/config';

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

/** Same geometry with every link fraction forced to q = 0.5. */
function withHalfQ(g: Geometry): Geometry {
  const q = g.q.slice();
  const N = g.W * g.H;
  for (let k = 0; k < g.links.length; k += 2) q[g.links[k + 1] * N + g.links[k]] = 0.5;
  return { ...g, q };
}

describe('Bouzidi boundaries and momentum-exchange force', () => {
  it('no flow (u = 0): |F| < 1e-6 after 200 steps', () => {
    const { cx, cy } = objectCenter('cylinder', 'baixa');
    const g = rasterize(makeShape('cylinder', 16, 0), W, H, cx, cy);
    const s = new LbmCpu(g, 0.6, 0);
    s.initUniform(0, 0);
    for (let n = 0; n < 200; n++) s.step();
    expect(Math.hypot(s.lastForce.fx, s.lastForce.fy)).toBeLessThan(1e-6);
  });

  it('q = 0.5 everywhere reproduces simple bounce-back bit-for-bit', () => {
    const Wd = 120, Hd = 48;
    const g = withHalfQ(rasterize(makeShape('cylinder', 12, 0), Wd, Hd, 30, 24));
    const a = new LbmCpu(g, 0.6, 0.06); // Bouzidi (default)
    const b = new LbmCpu(g, 0.6, 0.06, { bouzidi: false });
    expect(a.bouzidi).toBe(true);
    expect(b.bouzidi).toBe(false);
    for (let n = 0; n < 300; n++) {
      a.step();
      b.step();
    }
    expect(a.lastForce.fx).not.toBe(0); // non-trivial force (sign oscillates in the start-up transient)
    expect(a.lastForce).toEqual(b.lastForce);
    let mismatches = 0;
    for (let k = 0; k < a.f.length; k++) if (a.f[k] !== b.f[k]) mismatches++;
    expect(mismatches).toBe(0);
  });

  it('with real link fractions, Bouzidi (default) differs from halfway bounce-back', () => {
    const Wd = 120, Hd = 48;
    const g = rasterize(makeShape('cylinder', 12, 0), Wd, Hd, 30, 24);
    const a = new LbmCpu(g, 0.6, 0.06);
    const b = new LbmCpu(g, 0.6, 0.06, { bouzidi: false });
    for (let n = 0; n < 50; n++) {
      a.step();
      b.step();
    }
    expect(a.lastForce.fx).not.toBe(b.lastForce.fx);
  });

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
