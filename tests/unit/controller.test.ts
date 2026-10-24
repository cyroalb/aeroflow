import { describe, it, expect } from 'vitest';
import { SimController } from '../../src/sim/controller';
import { CpuBackend } from '../../src/backend/cpu-backend';
import type { Geometry, SimBackend } from '../../src/backend/types';
import { toLattice, latticeFor, type PhysParams } from '../../src/physics/units';
import { rasterize, centerFor, objectCenter } from '../../src/geometry/rasterize';
import { makeShape } from '../../src/geometry/shapes';
import { COPY, PRESETS } from '../../src/config';

const TABLE = { test: { W: 60, H: 24, Lblunt: 4, Lchord: 8 } };
const CYL: PhysParams = { U: 0.15, L: 0.01, alphaDeg: 0, kind: 'cylinder' };

type Call = { name: string; args: unknown[] };

/** Wraps CpuBackend, records calls, and can fake a non-finite force or a rejected readback. */
class SpyBackend implements SimBackend {
  readonly kind = 'cpu' as const;
  readonly inner = new CpuBackend();
  calls: Call[] = [];
  nonFinite = 0; // number of upcoming readForce calls that report finite:false
  rejectForce = 0; // number of upcoming readForce calls that reject

  private log(name: string, ...args: unknown[]) {
    this.calls.push({ name, args });
  }
  count(name: string) {
    return this.calls.filter((c) => c.name === name).length;
  }
  of(name: string) {
    return this.calls.filter((c) => c.name === name);
  }
  clear() {
    this.calls = [];
  }

  async init(geom: Geometry, tau0: number, uIn: number) {
    this.log('init', geom, tau0, uIn);
    return this.inner.init(geom, tau0, uIn);
  }
  setGeometry(geom: Geometry) {
    this.log('setGeometry', geom);
    this.inner.setGeometry(geom);
  }
  setTau0(t: number) {
    this.log('setTau0', t);
    this.inner.setTau0(t);
  }
  setInlet(ux: number, uy: number) {
    this.log('setInlet', ux, uy);
    this.inner.setInlet(ux, uy);
  }
  initUniform(ux: number, uy: number) {
    this.log('initUniform', ux, uy);
    this.inner.initUniform(ux, uy);
  }
  addKick(x0: number, y0: number, x1: number, y1: number, dvy: number) {
    this.log('addKick', x0, y0, x1, y1, dvy);
    this.inner.addKick(x0, y0, x1, y1, dvy);
  }
  step(n: number) {
    this.log('step', n);
    this.inner.step(n);
  }
  async readForce() {
    this.log('readForce');
    if (this.rejectForce > 0) {
      this.rejectForce--;
      throw new Error('device lost');
    }
    const f = await this.inner.readForce();
    if (this.nonFinite > 0) {
      this.nonFinite--;
      return { fx: NaN, fy: f.fy, finite: false };
    }
    return f;
  }
  readMacro() {
    return this.inner.readMacro();
  }
  render() {}
  destroy() {
    this.inner.destroy();
  }
}

function make(initial: PhysParams = CYL) {
  const b = new SpyBackend();
  const c = new SimController(b, 'test', initial, TABLE);
  return { b, c };
}

describe('helpers', () => {
  it('latticeFor matches toLattice for a real preset', () => {
    const p: PhysParams = { U: 3, L: 0.2, alphaDeg: 4, kind: 'naca2412' };
    expect(latticeFor(p, PRESETS.media)).toEqual(toLattice(p, 'media'));
  });
  it('centerFor matches objectCenter for a real preset', () => {
    expect(centerFor('cylinder', PRESETS.baixa)).toEqual(objectCenter('cylinder', 'baixa'));
    expect(centerFor('naca0012', PRESETS.alta)).toEqual(objectCenter('naca0012', 'alta'));
    expect(centerFor('square', TABLE.test)).toEqual({ cx: 12, cy: 12 });
  });
});

describe('SimController', () => {
  it('first frame resets: init, initUniform(uLb,0), kick, then steps', async () => {
    const { b, c } = make();
    const s = await c.frame(0);
    const lat = latticeFor(CYL, TABLE.test);
    expect(b.count('init')).toBe(1);
    const [, tau0, uIn] = b.of('init')[0].args as [Geometry, number, number];
    expect(tau0).toBeCloseTo(lat.tau0, 12);
    expect(uIn).toBe(lat.uLb);
    expect(b.of('initUniform')[0].args).toEqual([lat.uLb, 0]);
    // cx = 12, cy = 12, L = 4
    expect(b.of('addKick')[0].args).toEqual([14, 12, 22, 16, 0.1 * lat.uLb]);
    expect(b.count('step')).toBe(1);
    expect(s.step).toBe(10);
    expect(s.stepsPerFrame).toBe(10);
    expect(s.re).toBeCloseTo(100, 6);
    expect(c.lattice).toEqual(lat);
    expect(s.message).toBeNull();
  });

  it('setParams({U}) → next frame calls setTau0 with the new τ0, no init', async () => {
    const { b, c } = make();
    await c.frame(0);
    b.clear();
    c.setParams({ U: 0.3 });
    const s = await c.frame(16);
    expect(b.count('init')).toBe(0);
    expect(b.count('setGeometry')).toBe(0);
    expect(b.count('setTau0')).toBe(1);
    const lat = latticeFor({ ...CYL, U: 0.3 }, TABLE.test);
    expect(b.of('setTau0')[0].args[0]).toBeCloseTo(lat.tau0, 12);
    expect(s.re).toBeCloseTo(200, 6);
    expect(s.step).toBe(10 + 12); // step counter kept
  });

  it('10 setParams({alphaDeg}) in one frame → exactly one setGeometry with the last α, no init', async () => {
    const naca: PhysParams = { U: 0.15, L: 0.01, alphaDeg: 0, kind: 'naca0012' };
    const { b, c } = make(naca);
    await c.frame(0);
    b.clear();
    for (let k = 1; k <= 10; k++) c.setParams({ alphaDeg: 2 * k });
    await c.frame(16);
    expect(b.count('init')).toBe(0);
    expect(b.count('setGeometry')).toBe(1);
    const g = b.of('setGeometry')[0].args[0] as Geometry;
    const { cx, cy } = centerFor('naca0012', TABLE.test);
    const expected = rasterize(makeShape('naca0012', 8, 20), 60, 24, cx, cy);
    expect(Array.from(g.solid)).toEqual(Array.from(expected.solid));
    b.clear();
    await c.frame(32);
    expect(b.count('setGeometry')).toBe(0);
  });

  it('setParams({kind}) → init once', async () => {
    const { b, c } = make();
    await c.frame(0);
    b.clear();
    c.setParams({ kind: 'square' });
    c.setParams({ kind: 'plate' });
    const s = await c.frame(16);
    expect(b.count('init')).toBe(1);
    expect(b.count('setGeometry')).toBe(0);
    expect(s.step).toBe(12);
    b.clear();
    await c.frame(32);
    expect(b.count('init')).toBe(0);
  });

  it('setParams({L}) resets; reset + angle pending → only the reset', async () => {
    const { b, c } = make({ ...CYL, kind: 'square' });
    await c.frame(0);
    b.clear();
    c.setParams({ alphaDeg: 10 });
    c.setParams({ L: 0.02 });
    await c.frame(16);
    expect(b.count('init')).toBe(1);
    expect(b.count('setGeometry')).toBe(0);
    expect(b.count('setTau0')).toBe(0);
    const g = b.of('init')[0].args[0] as Geometry;
    const expected = rasterize(makeShape('square', 4, 10), 60, 24, 12, 12);
    expect(Array.from(g.solid)).toEqual(Array.from(expected.solid));
  });

  it('clamps U, L and alpha', async () => {
    const { c } = make();
    c.setParams({ U: 1e6, L: 50, alphaDeg: 400 });
    expect(c.params).toEqual({ U: 100, L: 2, alphaDeg: 90, kind: 'cylinder' });
    c.setParams({ U: 0, L: -1, alphaDeg: -400 });
    expect(c.params).toEqual({ U: 0.001, L: 0.001, alphaDeg: -20, kind: 'cylinder' });
  });

  it('adaptive steps: +2 below 25 ms, −2 above 31 ms, unchanged in between, clamped', async () => {
    const { c } = make();
    let s = await c.frame(0);
    expect(s.stepsPerFrame).toBe(10);
    s = await c.frame(16);
    expect(s.stepsPerFrame).toBe(12);
    s = await c.frame(56); // dt 40 ms
    expect(s.stepsPerFrame).toBe(10);
    s = await c.frame(86); // dt 30 ms
    expect(s.stepsPerFrame).toBe(10);
    s = await c.frame(118); // dt 32 ms: above the 31 ms slow threshold
    expect(s.stepsPerFrame).toBe(8);
    let t = 118;
    for (let k = 0; k < 8; k++) s = await c.frame((t += 100));
    expect(s.stepsPerFrame).toBe(1);
  });

  it('samples force several times per frame (chunks of <= Lcells/uLb/4 steps) with increasing t', async () => {
    const { b, c } = make();
    let s = await c.frame(0);
    expect(s.samples).toHaveLength(1);
    let now = 0;
    for (let k = 0; k < 20; k++) s = await c.frame((now += 16));
    const chunk = Math.floor(latticeFor(CYL, TABLE.test).Lcells / latticeFor(CYL, TABLE.test).uLb / 4);
    expect(s.stepsPerFrame).toBeGreaterThan(chunk);
    expect(s.samples).toHaveLength(Math.ceil(s.stepsPerFrame / chunk));
    for (let i = 1; i < s.samples.length; i++) expect(s.samples[i]!.t).toBeGreaterThan(s.samples[i - 1]!.t);
    expect(s.samples[s.samples.length - 1]!.t).toBeCloseTo(s.simTimePhys, 12);
    expect(Math.max(...b.of('step').map((x) => x.args[0] as number))).toBeLessThanOrEqual(chunk);
  });

  it('a 5000 ms nowMs jump leaves stepsPerFrame and fps unchanged', async () => {
    const { c } = make();
    await c.frame(0);
    await c.frame(16);
    const before = await c.frame(32);
    expect(before.stepsPerFrame).toBe(14);
    expect(before.fps).toBeGreaterThan(30);
    const after = await c.frame(5032);
    expect(after.stepsPerFrame).toBe(14);
    expect(after.fps).toBe(before.fps);
  });

  it('time: simTimePhys = step·dtPhys, slowMotion = wall s per frame / (steps·dtPhys)', async () => {
    const { c } = make();
    await c.frame(0);
    const s = await c.frame(20);
    const dtPhys = c.lattice.dtPhys;
    expect(s.simTimePhys).toBeCloseTo(s.step * dtPhys, 12);
    expect(s.fps).toBeCloseTo(50, 6);
    expect(s.slowMotion).toBeCloseTo(0.02 / (s.stepsPerFrame * dtPhys), 6);
  });

  it('frame is re-entrancy guarded', async () => {
    const { b, c } = make();
    await c.frame(0);
    b.clear();
    const p1 = c.frame(16);
    const p2 = c.frame(17);
    const [s1, s2] = await Promise.all([p1, p2]);
    expect(b.count('step')).toBe(1);
    expect(s2.step).toBe(10);
    expect(s1.step).toBe(22);
  });

  it('finite:false → init + COPY.divergence, cleared after 4 s of fake time', async () => {
    const { b, c } = make();
    await c.frame(0);
    await c.frame(16);
    b.clear();
    b.nonFinite = 1;
    let s = await c.frame(1000);
    expect(b.count('init')).toBe(1);
    expect(s.message).toBe(COPY.divergence);
    expect(s.step).toBe(0);
    s = await c.frame(4999);
    expect(s.message).toBe(COPY.divergence);
    s = await c.frame(5001);
    expect(s.message).toBeNull();
    expect(b.count('init')).toBe(1);
  });

  it('a rejected backend promise (device lost) → reset + message', async () => {
    const { b, c } = make();
    await c.frame(0);
    b.clear();
    b.rejectForce = 1;
    const s = await c.frame(16);
    expect(b.count('init')).toBe(1);
    expect(s.message).toBe(COPY.divergence);
  });

  it('persistent divergence: one reset per frame, no infinite loop', async () => {
    const { b, c } = make();
    await c.frame(0);
    b.clear();
    b.nonFinite = 1000;
    await c.frame(16);
    expect(b.count('init')).toBe(1);
    await c.frame(32);
    expect(b.count('init')).toBe(2);
  });

  it('fidelityWarning matches toLattice(...).showFidelityWarning', async () => {
    for (const p of [CYL, { ...CYL, U: 100, L: 2 }, { ...CYL, U: 0.3 }]) {
      const b = new SpyBackend();
      const c = new SimController(b, 'baixa', p);
      const s = await c.frame(0);
      expect(s.fidelityWarning).toBe(toLattice(p, 'baixa').showFidelityWarning);
      expect(s.re).toBeCloseTo(toLattice(p, 'baixa').re, 6);
    }
  });

  it('setPreset resets on the new grid', async () => {
    const table = { ...TABLE, big: { W: 80, H: 32, Lblunt: 6, Lchord: 10 } };
    const b = new SpyBackend();
    const c = new SimController(b, 'test', CYL, table);
    await c.frame(0);
    b.clear();
    await c.setPreset('big');
    expect(b.count('init')).toBe(1);
    const g = b.of('init')[0].args[0] as Geometry;
    expect([g.W, g.H]).toEqual([80, 32]);
    expect(c.lattice.Lcells).toBe(6);
    const s = await c.frame(16);
    expect(b.count('init')).toBe(1);
    expect(s.step).toBe(12);
  });

  it('onState receives each frame state; cd/cl/st/steady are wired', async () => {
    const { c } = make();
    const seen: number[] = [];
    c.onState((s) => seen.push(s.step));
    let s = await c.frame(0);
    for (let k = 1; k <= 5; k++) s = await c.frame(16 * k);
    expect(seen.length).toBe(6);
    expect(seen[5]).toBe(s.step);
    expect(Number.isFinite(s.cd)).toBe(true);
    expect(Number.isFinite(s.cdInst)).toBe(true);
    expect(s.cd).not.toBe(0);
    expect(s.st).toBeNull();
    expect(s.steady).toBe(false);
  });

  it('Re≈1.3e7 on the test grid: 50 frames with at most one recovery', async () => {
    const { b, c } = make({ U: 100, L: 2, alphaDeg: 0, kind: 'cylinder' });
    let messages = 0;
    let s = await c.frame(0);
    for (let k = 1; k <= 50; k++) {
      s = await c.frame(16 * k);
      if (s.message) messages++;
    }
    expect(b.count('init')).toBeLessThanOrEqual(2);
    expect(s.fidelityWarning).toBe(true);
    expect(Number.isFinite(s.cd)).toBe(true);
    if (b.count('init') === 1) expect(messages).toBe(0);
  });
});
