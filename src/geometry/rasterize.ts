import { C } from '../physics/d2q9';
import { PRESETS, type PresetId } from '../config';
import type { ObjectKind } from '../physics/units';
import type { Sdf } from './shapes';

export interface Geometry {
  W: number;
  H: number;
  solid: Uint8Array;
  /** q[i*W*H + cell]; -1 where no wall link */
  q: Float32Array;
  /** flattened [cell, i] pairs: fluid cell, i points INTO solid */
  links: Int32Array;
}

export function rasterize(sdf: Sdf, W: number, H: number, cx: number, cy: number): Geometry {
  const N = W * H;
  const solid = new Uint8Array(N);
  const q = new Float32Array(N * 9).fill(-1);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (sdf(x - cx, y - cy) < 0) solid[y * W + x] = 1;

  const links: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = y * W + x;
      if (solid[cell]) continue;
      for (let i = 1; i < 9; i++) {
        const nx = x + C[i][0], ny = y + C[i][1];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H || !solid[ny * W + nx]) continue;
        let lo = 0, hi = 1;
        for (let it = 0; it < 20; it++) {
          const mid = 0.5 * (lo + hi);
          if (sdf(x - cx + mid * C[i][0], y - cy + mid * C[i][1]) < 0) hi = mid;
          else lo = mid;
        }
        const t = 0.5 * (lo + hi);
        q[i * N + cell] = Math.min(1, Math.max(1e-3, t));
        links.push(cell, i);
      }
    }
  }
  return { W, H, solid, q, links: Int32Array.from(links) };
}

export function objectCenter(kind: ObjectKind, preset: PresetId): { cx: number; cy: number } {
  return centerFor(kind, PRESETS[preset]);
}

/** Object centre on an explicit grid: (0.2W, 0.5H) blunt, (0.3W, 0.5H) NACA. */
export function centerFor(kind: ObjectKind, grid: { W: number; H: number }): { cx: number; cy: number } {
  const { W, H } = grid;
  const naca = kind === 'naca0012' || kind === 'naca2412';
  return { cx: (naca ? 0.3 : 0.2) * W, cy: 0.5 * H };
}
