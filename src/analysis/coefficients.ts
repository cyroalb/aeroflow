/** Force coefficients, time-window averaging, Strouhal and steady-state detection. */

export function toCoeffs(fx: number, fy: number, uLb: number, Lcells: number): { cd: number; cl: number } {
  const q = 0.5 * uLb * uLb * Lcells; // rho = 1
  return { cd: fx / q, cl: fy / q };
}

export const RETAIN_CONV = 40;
const JITTER_MAX = 0.1;
const P2P_MIN = 0.02;
const PERIODS = 3;
const STEADY_REL = 0.02;
const STEADY_FLOOR = 0.1;

export class CoeffTracker {
  private steps: number[] = [];
  private cds: number[] = [];
  private cls: number[] = [];
  private startStep: number | null = null;

  constructor(private readonly convectiveSteps: number) {}

  push(step: number, cd: number, cl: number): void {
    if (this.startStep === null) this.startStep = step;
    this.steps.push(step);
    this.cds.push(cd);
    this.cls.push(cl);
    // Trim: keep one sample at/before the retention horizon, drop the rest.
    const horizon = step - RETAIN_CONV * this.convectiveSteps;
    let k = 0;
    while (k + 1 < this.steps.length && this.steps[k + 1] <= horizon) k++;
    if (k > 64 && k > this.steps.length / 4) {
      this.steps.splice(0, k);
      this.cds.splice(0, k);
      this.cls.splice(0, k);
    }
  }

  reset(): void {
    this.steps = [];
    this.cds = [];
    this.cls = [];
    this.startStep = null;
  }

  /** Number of retained samples (for tests). */
  sampleCount(): number {
    return this.steps.length;
  }

  private last(): number {
    return this.steps[this.steps.length - 1];
  }

  /** Linear interpolation of series y at step s (clamped). */
  private at(y: number[], s: number): number {
    const x = this.steps;
    if (s <= x[0]) return y[0];
    if (s >= x[x.length - 1]) return y[y.length - 1];
    let lo = 0;
    let hi = x.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x[mid] <= s) lo = mid;
      else hi = mid;
    }
    const f = (s - x[lo]) / (x[hi] - x[lo]);
    return y[lo] + f * (y[hi] - y[lo]);
  }

  /** Trapezoidal (step-weighted) mean of y over [a, b]. */
  private windowMean(y: number[], a: number, b: number): number {
    const x = this.steps;
    if (x.length === 0) return 0;
    if (!(b > a)) return this.at(y, b);
    let area = 0;
    let px = a;
    let py = this.at(y, a);
    for (let i = 0; i < x.length; i++) {
      if (x[i] <= a) continue;
      if (x[i] >= b) break;
      area += 0.5 * (py + y[i]) * (x[i] - px);
      px = x[i];
      py = y[i];
    }
    const qy = this.at(y, b);
    area += 0.5 * (py + qy) * (b - px);
    return area / (b - a);
  }

  /** Upward zero crossings of cl - mean(cl), interpolated, in steps. */
  private crossings(): number[] {
    const n = this.steps.length;
    if (n < 3) return [];
    const m = this.windowMean(this.cls, this.steps[0], this.last());
    const out: number[] = [];
    for (let i = 1; i < n; i++) {
      const a = this.cls[i - 1] - m;
      const b = this.cls[i] - m;
      if (a < 0 && b >= 0) {
        out.push(this.steps[i - 1] + ((0 - a) / (b - a)) * (this.steps[i] - this.steps[i - 1]));
      }
    }
    return out;
  }

  /** Crossings bounding the last PERIODS periods if the signal is periodic, else null. */
  private periodic(): { cross: number[]; period: number } | null {
    const c = this.crossings();
    if (c.length < PERIODS + 1) return null;
    const cross = c.slice(c.length - (PERIODS + 1));
    const ints: number[] = [];
    for (let i = 1; i < cross.length; i++) ints.push(cross[i] - cross[i - 1]);
    const period = ints.reduce((s, v) => s + v, 0) / ints.length;
    if (!(period > 0)) return null;
    if ((Math.max(...ints) - Math.min(...ints)) / period >= JITTER_MAX) return null;
    const t0 = cross[0];
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < this.steps.length; i++) {
      if (this.steps[i] < t0) continue;
      lo = Math.min(lo, this.cls[i]);
      hi = Math.max(hi, this.cls[i]);
    }
    if (!(hi - lo > P2P_MIN)) return null;
    return { cross, period };
  }

  strouhal(): number | null {
    const p = this.periodic();
    return p ? this.convectiveSteps / p.period : null;
  }

  mean(): { cd: number; cl: number } {
    if (this.steps.length === 0) return { cd: 0, cl: 0 };
    const p = this.periodic();
    const end = this.last();
    let a: number;
    let b: number;
    if (p) {
      b = p.cross[p.cross.length - 1];
      a = p.cross[p.cross.length - 2];
    } else {
      b = end;
      a = end - 2 * this.convectiveSteps;
    }
    return { cd: this.windowMean(this.cds, a, b), cl: this.windowMean(this.cls, a, b) };
  }

  isSteady(): boolean {
    if (this.steps.length < 2 || this.startStep === null) return false;
    const end = this.last();
    if (end - this.startStep < 10 * this.convectiveSteps) return false;
    const p = this.periodic();
    let a0: number, a1: number, b0: number, b1: number;
    if (p) {
      b1 = p.cross[p.cross.length - 1];
      b0 = p.cross[p.cross.length - 2];
      a1 = b0;
      a0 = p.cross[p.cross.length - 3];
    } else {
      const w = 2 * this.convectiveSteps;
      b1 = end;
      b0 = end - w;
      a1 = b0;
      a0 = b0 - w;
    }
    const eq = (y: number[]) => {
      const m1 = this.windowMean(y, a0, a1);
      const m2 = this.windowMean(y, b0, b1);
      return Math.abs(m1 - m2) < STEADY_REL * Math.max(Math.abs(m1), Math.abs(m2), STEADY_FLOOR);
    };
    return eq(this.cds) && eq(this.cls);
  }
}
