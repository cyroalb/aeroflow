import type { SimBackend } from '../backend/types';
import { COPY, PRESETS, type PresetId } from '../config';
import { latticeFor, type LatticeParams, type PhysParams } from '../physics/units';
import { makeShape } from '../geometry/shapes';
import { rasterize, centerFor, type Geometry } from '../geometry/rasterize';
import { CoeffTracker, toCoeffs } from '../analysis/coefficients';

export interface SimState {
  re: number; cd: number; cl: number; st: number | null;
  cdInst: number; clInst: number; step: number;
  simTimePhys: number; slowMotion: number;           // slowMotion = wall s per physical s
  stepsPerFrame: number; fps: number;
  fidelityWarning: boolean; steady: boolean; message: string | null;
  /** Every force sample taken during the last frame (sub-frame sampling), oldest first. */
  samples: { t: number; cdInst: number; clInst: number }[];
}

export type PresetEntry = { W: number; H: number; Lblunt: number; Lchord: number };

const STEPS_START = 10;
const STEPS_MIN = 1;
const STEPS_MAX = 300;
const STEPS_DELTA = 2;
const FAST_MS = 25;
const SLOW_MS = 31; // below 33.3 ms so a 60 Hz cadence settles above 30 fps, not at it
const IGNORE_DT_MS = 250;
const FPS_SMOOTH = 0.1; // EMA weight of the newest frame
const MESSAGE_MS = 4000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Backend-agnostic simulation driver: parameters, resets, live updates, adaptive stepping,
 * force readback → coefficients and divergence recovery. The UI renders; this does not.
 */
export class SimController {
  private presetId: string;
  private p: PhysParams;
  private lat: LatticeParams;
  private tracker: CoeffTracker;
  private pending = { reset: true, angle: false, tau: false };
  private stepCount = 0;
  private spf = STEPS_START;
  private lastNow: number | null = null;
  private fpsEma = 0;
  private frameSec = 1 / 60;
  private cdInst = 0;
  private clInst = 0;
  private message: string | null = null;
  private messageUntil = -Infinity;
  private inflight: Promise<unknown> | null = null;
  private listeners: ((s: SimState) => void)[] = [];
  private samples: { t: number; cdInst: number; clInst: number }[] = [];
  private last: SimState;

  constructor(
    private readonly backend: SimBackend,
    preset: PresetId | (string & {}),
    initial: PhysParams,
    private readonly presetTable: Record<string, PresetEntry> = PRESETS,
  ) {
    this.presetId = preset;
    this.p = SimController.clampParams(initial);
    this.lat = latticeFor(this.p, this.grid);
    this.tracker = new CoeffTracker(this.lat.Lcells / this.lat.uLb);
    this.last = this.buildState();
  }

  /** Lattice parameters currently applied to the backend (for fieldScale in the UI). */
  get lattice(): LatticeParams {
    return this.lat;
  }

  /** Latest requested physical parameters (clamped). */
  get params(): PhysParams {
    return { ...this.p };
  }

  /** Current grid entry (W, H, Lblunt, Lchord). */
  get grid(): PresetEntry {
    const g = this.presetTable[this.presetId];
    if (!g) throw new Error(`SimController: unknown preset ${this.presetId}`);
    return g;
  }

  get preset(): string {
    return this.presetId;
  }

  private static clampParams(p: PhysParams): PhysParams {
    return {
      U: clamp(p.U, 0.001, 100),
      L: clamp(p.L, 0.001, 2),
      alphaDeg: clamp(p.alphaDeg, -20, 90),
      kind: p.kind,
    };
  }

  setParams(p: Partial<PhysParams>): void {
    const next = SimController.clampParams({ ...this.p, ...p });
    if (next.kind !== this.p.kind || next.L !== this.p.L) this.pending.reset = true;
    if (next.alphaDeg !== this.p.alphaDeg) this.pending.angle = true;
    if (next.U !== this.p.U) this.pending.tau = true;
    this.p = next;
  }

  async setPreset(p: PresetId | (string & {})): Promise<void> {
    if (!this.presetTable[p]) throw new Error(`SimController: unknown preset ${p}`);
    this.presetId = p;
    this.pending.reset = true;
    while (this.inflight) await this.inflight.catch(() => undefined);
    const run = this.applyPending().catch(() => {
      // backend failure: pending.reset stays set; the next frame retries and reports it
    });
    this.inflight = run;
    try {
      await run;
    } finally {
      this.inflight = null;
    }
  }

  onState(cb: (s: SimState) => void): void {
    this.listeners.push(cb);
  }

  frame(nowMs: number): Promise<SimState> {
    if (this.inflight) return Promise.resolve(this.last);
    const run = this.doFrame(nowMs);
    this.inflight = run;
    return run.finally(() => {
      this.inflight = null;
    });
  }

  private geometry(): Geometry {
    const { W, H } = this.grid;
    const { cx, cy } = centerFor(this.p.kind, { W, H });
    return rasterize(makeShape(this.p.kind, this.lat.Lcells, this.p.alphaDeg), W, H, cx, cy);
  }

  /** Applies at most one geometry action (reset beats angle) plus a τ0 update, from the latest params. */
  private async applyPending(): Promise<void> {
    const pend = this.pending;
    this.pending = { reset: false, angle: false, tau: false };
    if (!pend.reset && !pend.angle && !pend.tau) return;
    const prevLat = this.lat;
    this.lat = latticeFor(this.p, this.grid);
    try {
      if (pend.reset) {
        const geom = this.geometry();
        await this.backend.init(geom, this.lat.tau0, this.lat.uLb);
        const { cx, cy } = centerFor(this.p.kind, this.grid);
        const L = this.lat.Lcells;
        const u = this.lat.uLb;
        this.backend.initUniform(u, 0);
        this.backend.addKick(cx + 0.5 * L, cy, cx + 2.5 * L, cy + L, 0.1 * u);
        this.stepCount = 0;
      } else {
        if (pend.angle) this.backend.setGeometry(this.geometry());
        if (pend.tau) this.backend.setTau0(this.lat.tau0);
      }
    } catch (e) {
      // keep the request: retry as a full reset next time
      this.lat = prevLat;
      this.pending.reset = true;
      throw e;
    }
    this.tracker = new CoeffTracker(this.lat.Lcells / this.lat.uLb);
    this.cdInst = 0;
    this.clInst = 0;
  }

  private adapt(nowMs: number): void {
    const prev = this.lastNow;
    this.lastNow = nowMs;
    if (prev === null) return;
    const dt = nowMs - prev;
    if (!(dt > 0) || dt > IGNORE_DT_MS) return;
    if (dt < FAST_MS) this.spf += STEPS_DELTA;
    else if (dt > SLOW_MS) this.spf -= STEPS_DELTA;
    this.spf = clamp(this.spf, STEPS_MIN, STEPS_MAX);
    const fps = 1000 / dt;
    if (this.fpsEma === 0) {
      this.fpsEma = fps;
      this.frameSec = dt / 1000;
    } else {
      this.fpsEma += FPS_SMOOTH * (fps - this.fpsEma);
      this.frameSec += FPS_SMOOTH * (dt / 1000 - this.frameSec);
    }
  }

  private async doFrame(nowMs: number): Promise<SimState> {
    this.adapt(nowMs);
    this.samples = [];
    try {
      await this.applyPending();
      const chunkMax = Math.max(1, Math.floor(this.lat.Lcells / this.lat.uLb / 4));
      const reads: { step: number; p: ReturnType<SimBackend['readForce']> }[] = [];
      let left = this.spf;
      let at = this.stepCount;
      while (left > 0) {
        const n = Math.min(left, chunkMax);
        this.backend.step(n);
        left -= n;
        at += n;
        reads.push({ step: at, p: this.backend.readForce() }); // not awaited: each call snapshots its own sample
      }
      const forces = await Promise.all(reads.map((r) => r.p));
      if (forces.some((f) => !f.finite)) throw new Error('diverged');
      this.stepCount = at;
      forces.forEach((f, i) => {
        const c = toCoeffs(f.fx, f.fy, this.lat.uLb, this.lat.Lcells);
        this.cdInst = c.cd;
        this.clInst = c.cl;
        this.tracker.push(reads[i]!.step, c.cd, c.cl);
        this.samples.push({ t: reads[i]!.step * this.lat.dtPhys, cdInst: c.cd, clInst: c.cl });
      });
    } catch {
      // divergence or backend failure (e.g. device lost): one reset attempt per frame
      this.message = COPY.divergence;
      this.messageUntil = nowMs + MESSAGE_MS;
      this.pending = { reset: true, angle: false, tau: false };
      try {
        await this.applyPending();
      } catch {
        // pending.reset is kept; the next frame tries again
      }
    }
    if (this.message !== null && nowMs >= this.messageUntil) this.message = null;
    this.last = this.buildState();
    for (const cb of this.listeners) cb(this.last);
    return this.last;
  }

  private buildState(): SimState {
    const lat = this.lat;
    const m = this.tracker.mean();
    return {
      re: lat.re,
      cd: m.cd,
      cl: m.cl,
      st: this.tracker.strouhal(),
      cdInst: this.cdInst,
      clInst: this.clInst,
      step: this.stepCount,
      simTimePhys: this.stepCount * lat.dtPhys,
      slowMotion: this.frameSec / (this.spf * lat.dtPhys),
      stepsPerFrame: this.spf,
      fps: this.fpsEma,
      fidelityWarning: lat.showFidelityWarning,
      steady: this.tracker.isSteady(),
      message: this.message,
      samples: this.samples,
    };
  }
}
