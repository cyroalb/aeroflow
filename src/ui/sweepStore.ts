import type { ObjectKind } from '../physics/units';

const ALPHA_STEP = 0.5;

/** Rounds the sweep key: α to 0.5° (blunt kinds' Re to 3 significant digits). */
function keyFor(kind: ObjectKind, x: number): number {
  const airfoil = kind === 'naca0012' || kind === 'naca2412';
  return airfoil ? Math.round(x / ALPHA_STEP) * ALPHA_STEP : Number(x.toPrecision(3));
}

/** Settled-state points per object kind; re-adding the same (rounded) x replaces the point. */
export class SweepStore {
  private data = new Map<ObjectKind, Map<number, number>>();

  add(kind: ObjectKind, x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    let m = this.data.get(kind);
    if (!m) this.data.set(kind, (m = new Map()));
    m.set(keyFor(kind, x), y);
  }

  points(kind: ObjectKind): [number, number][] {
    const m = this.data.get(kind);
    return m ? [...m.entries()].sort((a, b) => a[0] - b[0]) : [];
  }

  clear(kind?: ObjectKind): void {
    if (kind) this.data.delete(kind);
    else this.data.clear();
  }
}
