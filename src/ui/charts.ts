import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { ObjectKind, PhysParams } from '../physics/units';
import type { SimState } from '../sim/controller';
import { SweepStore } from './sweepStore';

export { SweepStore };

const MAX_HZ = 10;
const isAirfoil = (k: ObjectKind) => k === 'naca0012' || k === 'naca2412';

const nf = (max: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: max });
const fmt = (v: number | null | undefined, max = 2): string =>
  v == null || !Number.isFinite(v) ? '—' : nf(max).format(Math.abs(v) < 5e-13 ? 0 : v).replace('-', '−');

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

interface Theme {
  text: string;
  muted: string;
  grid: string;
  cd: string;
  cl: string;
}
function theme(): Theme {
  return {
    text: token('--text', '#e9edf3'),
    muted: token('--muted', '#8d99ab'),
    grid: token('--line', '#232c39'),
    cd: token('--accent', '#7fd8c4'),
    cl: token('--amber', '#f3b443'),
  };
}

const FONT = '13px system-ui, "Segoe UI", sans-serif';
const SMALL = '12px system-ui, "Segoe UI", sans-serif';

function axis(t: Theme, label: string, extra: Partial<uPlot.Axis> = {}): uPlot.Axis {
  return {
    stroke: t.muted,
    label,
    labelFont: FONT,
    labelSize: 18,
    font: FONT,
    grid: { stroke: t.grid, width: 1 },
    ticks: { stroke: t.grid, width: 1 },
    values: (_u, vals) => vals.map((v) => (v == null ? '' : fmt(v, 3))),
    ...extra,
  };
}

/** Keeps a uPlot sized to its host element. */
function fit(host: HTMLElement, u: () => uPlot | null, reserve: (p: uPlot) => number = () => 0): void {
  new ResizeObserver(() => {
    const p = u();
    const w = host.clientWidth;
    const h = p ? host.clientHeight - reserve(p) : 0;
    if (p && w > 0 && h > 0) p.setSize({ width: w, height: h });
  }).observe(host);
}

function padRange(min: number, max: number, minSpan: number): [number, number] {
  if (!(max > min)) return [min - minSpan / 2, max + minSpan / 2];
  const pad = (max - min) * 0.1;
  return [min - pad, max + pad];
}

/** Instantaneous Cd and Cl against simulated time, last 20 convective times. */
export class TimeChart {
  private t: number[] = [];
  private cd: number[] = [];
  private cl: number[] = [];
  private u: uPlot | null = null;
  private lastStep = -1;
  private lastDraw = -Infinity;
  private dirty = false;

  /** `windowSec` returns the span to keep (20·L/U), in physical seconds. */
  constructor(el: HTMLElement, private readonly windowSec: () => number = () => Infinity) {
    const th = theme();
    this.u = new uPlot(
      {
        width: Math.max(el.clientWidth, 200),
        height: Math.max(el.clientHeight, 120),
        padding: [6, 4, 0, 0],
        cursor: { drag: { x: false, y: false } },
        scales: {
          x: { time: false },
          cd: { range: (_u, mn, mx) => padRange(mn, mx, 0.2) },
          cl: { range: (_u, mn, mx) => padRange(mn, mx, 0.2) },
        },
        series: [
          { label: 't (s)', value: (_u, v) => fmt(v, 3) },
          { label: 'Cd', scale: 'cd', stroke: th.cd, width: 2, points: { show: false }, value: (_u, v) => fmt(v, 3) },
          { label: 'Cl', scale: 'cl', stroke: th.cl, width: 2, points: { show: false }, value: (_u, v) => fmt(v, 3) },
        ],
        axes: [
          axis(th, '', {
            size: 32,
            labelSize: 0,
            space: 60,
            values: (_u, vals) => vals.map((v) => (v == null ? '' : fmt(v, 2) + ' s')),
          }),
          axis(th, 'Cd', { scale: 'cd', size: 46, space: 20, labelSize: 16, stroke: th.cd, font: SMALL, labelFont: SMALL, grid: { stroke: th.grid, width: 1 } }),
          axis(th, 'Cl', { scale: 'cl', side: 1, size: 46, space: 20, labelSize: 16, stroke: th.cl, font: SMALL, labelFont: SMALL, grid: { show: false } }),
        ],
        legend: { show: false },
      },
      [this.t, this.cd, this.cl],
      el,
    );
    fit(el, () => this.u);
    this.u.setSize({ width: Math.max(el.clientWidth, 200), height: Math.max(el.clientHeight, 80) });
  }

  size(): number {
    return this.t.length;
  }

  push(s: SimState): void {
    if (s.step === this.lastStep) return;
    const samples = s.samples?.length ? s.samples : [{ t: s.simTimePhys, cdInst: s.cdInst, clInst: s.clInst }];
    if (s.step < this.lastStep || (this.t.length > 0 && samples[0]!.t < this.t[this.t.length - 1]!)) this.reset();
    this.lastStep = s.step;
    for (const p of samples) {
      this.t.push(p.t);
      this.cd.push(p.cdInst);
      this.cl.push(p.clInst);
    }
    const span = this.windowSec();
    if (Number.isFinite(span) && span > 0) {
      const cut = samples[samples.length - 1]!.t - span;
      let n = 0;
      while (n < this.t.length - 1 && this.t[n]! < cut) n++;
      if (n > 0) {
        this.t.splice(0, n);
        this.cd.splice(0, n);
        this.cl.splice(0, n);
      }
    }
    this.dirty = true;
    this.flush(false);
  }

  clear(): void {
    this.reset();
    this.lastStep = -1;
    this.flush(true);
  }

  private reset(): void {
    this.t.length = 0;
    this.cd.length = 0;
    this.cl.length = 0;
    this.dirty = true;
    this.lastDraw = -Infinity;
  }

  private flush(force: boolean): void {
    const now = performance.now();
    if (!force && (!this.dirty || now - this.lastDraw < 1000 / MAX_HZ)) return;
    this.lastDraw = now;
    this.dirty = false;
    this.u?.setData([this.t, this.cd, this.cl]);
  }
}

/** Cl × α (airfoils) or Cd × Re (blunt bodies), one point per settled state. */
export class SweepChart {
  private u: uPlot | null = null;
  private readonly plot: HTMLElement;
  private readonly title: HTMLElement;
  private kind: ObjectKind | null = null;
  private prevSteady = false;

  constructor(el: HTMLElement, private readonly store: SweepStore) {
    el.classList.add('af-sweep');
    el.innerHTML =
      '<div class="af-sweep-head"><span class="af-sweep-title"></span><button type="button" class="af-sweep-clear">Limpar</button></div><div class="af-sweep-plot"></div>';
    this.title = el.querySelector<HTMLElement>('.af-sweep-title')!;
    this.plot = el.querySelector<HTMLElement>('.af-sweep-plot')!;
    el.querySelector<HTMLButtonElement>('.af-sweep-clear')!.addEventListener('click', () => {
      if (this.kind) {
        this.store.clear(this.kind);
        this.redraw();
      }
    });
    fit(this.plot, () => this.u);
    this.build('cylinder');
    this.kind = 'cylinder';
  }

  update(kind: ObjectKind, state: SimState, params: PhysParams): void {
    if (kind !== this.kind) {
      this.kind = kind;
      this.build(kind);
    }
    if (state.steady && !this.prevSteady) {
      if (isAirfoil(kind)) this.store.add(kind, params.alphaDeg, state.cl);
      else this.store.add(kind, state.re, state.cd);
      this.redraw();
    }
    this.prevSteady = state.steady;
  }

  private build(kind: ObjectKind): void {
    this.u?.destroy();
    const th = theme();
    const air = isAirfoil(kind);
    this.title.textContent = air ? 'Cl × α (°)' : 'Cd × Re';
    const color = air ? th.cl : th.cd;
    this.u = new uPlot(
      {
        width: Math.max(this.plot.clientWidth, 200),
        height: Math.max(this.plot.clientHeight, 100),
        padding: [8, 16, 0, 0],
        cursor: { drag: { x: false, y: false } },
        scales: {
          x: air
            ? { time: false, range: (_u, mn, mx) => padRange(mn, mx, 4) }
            : { time: false, distr: 3, range: (_u, mn, mx) => (mx > mn ? [mn / 1.3, mx * 1.3] : [mn / 2, mx * 2]) },
          y: { range: (_u, mn, mx) => padRange(mn, mx, 0.4) },
        },
        series: [
          { label: air ? 'α (°)' : 'Re', value: (_u, v) => fmt(v, air ? 2 : 0) },
          {
            label: air ? 'Cl' : 'Cd',
            stroke: color,
            width: 1,
            points: { show: true, size: 9, width: 2, stroke: color, fill: color },
            value: (_u, v) => fmt(v, 3),
          },
        ],
        axes: [
          axis(th, air ? 'α (°)' : 'Re', { values: (_u, vals) => vals.map((v) => (v == null ? '' : fmt(v, air ? 1 : 0))) }),
          axis(th, air ? 'Cl' : 'Cd', { size: 52 }),
        ],
        legend: { show: false },
      },
      this.data(kind),
      this.plot,
    );
  }

  private data(kind: ObjectKind): [number[], number[]] {
    const pts = this.store.points(kind);
    return [pts.map((p) => p[0]), pts.map((p) => p[1])];
  }

  private redraw(): void {
    if (this.kind && this.u) this.u.setData(this.data(this.kind));
  }
}
