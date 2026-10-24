import type { ObjectKind } from '../physics/units';

export type Sdf = (x: number, y: number) => number;

function boxSdf(hx: number, hy: number): Sdf {
  return (x, y) => {
    const dx = Math.abs(x) - hx;
    const dy = Math.abs(y) - hy;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
  };
}

/** Polygon outline of a NACA 4-digit airfoil in body coords (origin at quarter chord). */
function nacaPolygon(m: number, p: number, t: number, L: number, n = 120): [number, number][] {
  const upper: [number, number][] = [];
  const lower: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const x = 0.5 * (1 - Math.cos((Math.PI * k) / n));
    const yt =
      5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    let yc = 0, dyc = 0;
    if (m > 0) {
      if (x < p) {
        yc = (m / (p * p)) * (2 * p * x - x * x);
        dyc = ((2 * m) / (p * p)) * (p - x);
      } else {
        yc = (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x);
        dyc = ((2 * m) / ((1 - p) ** 2)) * (p - x);
      }
    }
    const th = Math.atan(dyc);
    upper.push([(x - yt * Math.sin(th) - 0.25) * L, (yc + yt * Math.cos(th)) * L]);
    lower.push([(x + yt * Math.sin(th) - 0.25) * L, (yc - yt * Math.cos(th)) * L]);
  }
  // upper from LE to TE, then lower from TE back to LE (skip duplicate endpoints)
  const poly = upper.slice();
  for (let k = n - 1; k >= 1; k--) poly.push(lower[k]);
  return poly;
}

function polygonSdf(poly: [number, number][]): Sdf {
  const n = poly.length;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const margin = 2;
  return (px, py) => {
    // far-field shortcut: distance to expanded bbox is a positive lower bound
    const ex = Math.max(minX - margin - px, px - maxX - margin, 0);
    const ey = Math.max(minY - margin - py, py - maxY - margin, 0);
    if (ex > 0 || ey > 0) return Math.hypot(ex, ey) + margin;
    let d2 = Infinity;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [ax, ay] = poly[j];
      const [bx, by] = poly[i];
      const ux = bx - ax, uy = by - ay;
      const len2 = ux * ux + uy * uy;
      let t = len2 > 0 ? ((px - ax) * ux + (py - ay) * uy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - (ax + t * ux), dy = py - (ay + t * uy);
      const dd = dx * dx + dy * dy;
      if (dd < d2) d2 = dd;
      if ((ay > py) !== (by > py) && px < ax + ((py - ay) / (by - ay)) * ux) inside = !inside;
    }
    const d = Math.sqrt(d2);
    return inside ? -d : d;
  };
}

/** Signed distance (negative inside), lattice units, centred at origin. */
export function makeShape(kind: ObjectKind, Lcells: number, alphaDeg: number): Sdf {
  let base: Sdf;
  switch (kind) {
    case 'cylinder': {
      const r = Lcells / 2;
      return (x, y) => Math.hypot(x, y) - r;
    }
    case 'square':
      base = boxSdf(Lcells / 2, Lcells / 2);
      break;
    case 'plate':
      base = boxSdf(Math.max(2, Lcells / 10) / 2, Lcells / 2);
      break;
    case 'naca0012':
      base = polygonSdf(nacaPolygon(0, 0.4, 0.12, Lcells));
      break;
    case 'naca2412':
      base = polygonSdf(nacaPolygon(0.02, 0.4, 0.12, Lcells));
      break;
  }
  const a = (alphaDeg * Math.PI) / 180;
  if (a === 0) return base;
  const c = Math.cos(a), s = Math.sin(a);
  // positive alpha: body rotated clockwise (nose up for flow from -x)
  return (x, y) => base(x * c - y * s, x * s + y * c);
}
