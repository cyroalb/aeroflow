/**
 * CPU reference D2Q9 Lattice Boltzmann solver — the executable spec of the physics.
 * The WGSL and GLSL ports mirror this algorithm line for line.
 *
 * Step = collide (in place) -> pull-stream into the other buffer -> pressure outlet ->
 * swap -> recompute macroscopic fields from the new f.
 *
 * Collision (fluid cells): regularized BGK with Smagorinsky
 *   Π_neq = Σ c c (f − feq);  f_neq_i = 4.5·W_i·(Q_i : Π_neq),  Q_i = c_i c_i − I/3
 *   |Π| = sqrt(Πxx² + Πyy² + 2Πxy²)
 *   τ = 0.5·(τ0 + sqrt(τ0² + 18·√2·Cs²·|Π|/ρ))
 *   f*_i = feq_i + (1 − 1/τ)·f_neq_i
 *
 * Streaming (pull) for fluid cell x, direction i, source s = x − c_i:
 *   - column 0 (inlet): f_i = feq_i(ρ(1,y) of previous step, uIn)   [all i]
 *   - s.y outside [0,H): free slip, f_i = f*_{MIRROR_Y i}(clamp(x.x − c_ix), x.y);
 *       if that mirror source is solid, simple bounce-back f*_{OPP i}(x)
 *   - s solid: simple bounce-back f_i = f*_{OPP i}(x)   (Bouzidi: Task 4)
 *   - otherwise f_i = f*_i(s)
 *   - column W−1 (outlet, fixed pressure ρ = 1, non-equilibrium extrapolation), after
 *       streaming, when (W−2,y) is fluid: with ρ', u' the moments of the post-streaming f
 *       at (W−2,y):  f_i(W−1,y) = feq_i(1, u') + (f_i(W−2,y) − feq_i(ρ', u'))
 *       (if (W−2,y) is solid, (W−1,y) keeps its streamed values)
 * Solid cells hold feq(1,0,0) and macroscopic ρ=1, u=0.
 */
import { C, W as WT, OPP, MIRROR_Y } from './d2q9';
import { CS_SMAG } from '../config';
import type { Geometry } from '../geometry/rasterize';

export function feq(i: number, rho: number, ux: number, uy: number): number {
  const cu = C[i][0] * ux + C[i][1] * uy;
  return WT[i] * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * (ux * ux + uy * uy));
}

const CX = Int32Array.from(C.map((c) => c[0]));
const CY = Int32Array.from(C.map((c) => c[1]));
const WI = Float64Array.from(WT);
const OPPI = Int32Array.from(OPP);
const MIRI = Int32Array.from(MIRROR_Y);
const SMAG_K = 18 * Math.SQRT2 * CS_SMAG * CS_SMAG;

export class LbmCpu {
  readonly W: number;
  readonly H: number;
  geom: Geometry;
  tau0: number;
  uInX: number;
  uInY = 0;
  readonly bouzidi: boolean;
  /** current distributions (post-streaming), layout f[i*W*H + cell] */
  f: Float32Array;
  private g: Float32Array;
  rho: Float32Array;
  ux: Float32Array;
  uy: Float32Array;
  lastForce = { fx: 0, fy: 0 };
  private readonly feqRest: Float32Array;

  constructor(geom: Geometry, tau0: number, uIn: number, opts?: { bouzidi?: boolean }) {
    this.W = geom.W;
    this.H = geom.H;
    this.geom = geom;
    this.tau0 = tau0;
    this.uInX = uIn;
    this.bouzidi = opts?.bouzidi ?? false; // only simple bounce-back exists until Task 4
    const N = this.W * this.H;
    this.f = new Float32Array(9 * N);
    this.g = new Float32Array(9 * N);
    this.rho = new Float32Array(N);
    this.ux = new Float32Array(N);
    this.uy = new Float32Array(N);
    this.feqRest = new Float32Array(9);
    for (let i = 0; i < 9; i++) this.feqRest[i] = feq(i, 1, 0, 0);
    this.initUniform(uIn, 0);
  }

  setTau0(t: number): void {
    this.tau0 = t;
  }

  setInlet(ux: number, uy: number): void {
    this.uInX = ux;
    this.uInY = uy;
  }

  /** Writes feq(rho,ux,uy) into cell c of buffer f and stores the macroscopic values. */
  private setCellEq(c: number, rho: number, ux: number, uy: number): void {
    const N = this.W * this.H;
    for (let i = 0; i < 9; i++) this.f[i * N + c] = feq(i, rho, ux, uy);
    this.rho[c] = rho;
    this.ux[c] = ux;
    this.uy[c] = uy;
  }

  initUniform(ux: number, uy: number): void {
    const N = this.W * this.H;
    const solid = this.geom.solid;
    for (let c = 0; c < N; c++) {
      if (solid[c]) this.setCellEq(c, 1, 0, 0);
      else this.setCellEq(c, 1, ux, uy);
    }
  }

  /** Same W,H. Cells that stay fluid keep f; cells that change solid↔fluid get feq(1,0,0). */
  setGeometry(geom: Geometry): void {
    if (geom.W !== this.W || geom.H !== this.H) throw new Error('setGeometry: grid size mismatch');
    const N = this.W * this.H;
    const old = this.geom.solid;
    for (let c = 0; c < N; c++) if (old[c] !== geom.solid[c]) this.setCellEq(c, 1, 0, 0);
    this.geom = geom;
  }

  /** Fluid cells in [x0,x1]×[y0,y1] (inclusive, clipped): f = feq(rho, ux, uy + dvy). */
  addKick(x0: number, y0: number, x1: number, y1: number, dvy: number): void {
    const xa = Math.max(0, Math.ceil(x0)), xb = Math.min(this.W - 1, Math.floor(x1));
    const ya = Math.max(0, Math.ceil(y0)), yb = Math.min(this.H - 1, Math.floor(y1));
    const solid = this.geom.solid;
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        const c = y * this.W + x;
        if (solid[c]) continue;
        this.setCellEq(c, this.rho[c], this.ux[c], this.uy[c] + dvy);
      }
  }

  step(): void {
    const Wd = this.W, H = this.H, N = Wd * H;
    const solid = this.geom.solid;
    const f = this.f, g = this.g;
    const tau0 = this.tau0;

    // ---- 1. collision (in place, fluid cells) ----
    for (let c = 0; c < N; c++) {
      if (solid[c]) continue;
      const f0 = f[c], f1 = f[N + c], f2 = f[2 * N + c], f3 = f[3 * N + c], f4 = f[4 * N + c];
      const f5 = f[5 * N + c], f6 = f[6 * N + c], f7 = f[7 * N + c], f8 = f[8 * N + c];
      const rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
      const ux = (f1 - f3 + f5 - f6 - f7 + f8) / rho;
      const uy = (f2 - f4 + f5 + f6 - f7 - f8) / rho;
      const usq = 1.5 * (ux * ux + uy * uy);
      // Π_neq = Σ c c (f − feq) and feq stored temporarily via recomputation below
      let pxx = 0, pxy = 0, pyy = 0;
      for (let i = 0; i < 9; i++) {
        const cx = CX[i], cy = CY[i];
        const cu = cx * ux + cy * uy;
        const fq = WI[i] * rho * (1 + 3 * cu + 4.5 * cu * cu - usq);
        const fn = f[i * N + c] - fq;
        pxx += cx * cx * fn;
        pxy += cx * cy * fn;
        pyy += cy * cy * fn;
      }
      const pmag = Math.sqrt(pxx * pxx + pyy * pyy + 2 * pxy * pxy);
      const tau = 0.5 * (tau0 + Math.sqrt(tau0 * tau0 + (SMAG_K * pmag) / rho));
      const omega = 1 - 1 / tau;
      for (let i = 0; i < 9; i++) {
        const cx = CX[i], cy = CY[i];
        const cu = cx * ux + cy * uy;
        const fq = WI[i] * rho * (1 + 3 * cu + 4.5 * cu * cu - usq);
        const qxx = cx * cx - 1 / 3, qyy = cy * cy - 1 / 3, qxy = cx * cy;
        const fneq = 4.5 * WI[i] * (qxx * pxx + 2 * qxy * pxy + qyy * pyy);
        f[i * N + c] = fq + omega * fneq;
      }
    }

    // ---- 2. pull streaming with boundaries, f (post-collision) -> g ----
    const uIx = this.uInX, uIy = this.uInY;
    const rhoPrev = this.rho;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < Wd; x++) {
        const c = y * Wd + x;
        if (solid[c]) {
          for (let i = 0; i < 9; i++) g[i * N + c] = this.feqRest[i];
          continue;
        }
        if (x === 0) {
          // inlet: density of (1, y) from the previous step's macroscopic values
          const r = rhoPrev[c + 1];
          for (let i = 0; i < 9; i++) g[i * N + c] = feq(i, r, uIx, uIy);
          continue;
        }
        g[c] = f[c]; // rest population
        for (let i = 1; i < 9; i++) {
          const sy = y - CY[i];
          let sx = x - CX[i];
          sx = sx < 0 ? 0 : sx > Wd - 1 ? Wd - 1 : sx; // only reachable at x = W−1 (outlet)
          let v: number;
          if (sy < 0 || sy >= H) {
            // free slip: mirrored population from the same row
            const s = y * Wd + sx;
            v = solid[s] ? f[OPPI[i] * N + c] : f[MIRI[i] * N + s];
          } else {
            const s = sy * Wd + sx;
            v = solid[s] ? f[OPPI[i] * N + c] : f[i * N + s];
          }
          g[i * N + c] = v;
        }
      }
    }
    // Note: at x = W−1 with c_ix = −1 the source column W is clamped to W−1; those values
    // are then overwritten by the pressure-outlet rule below (whenever (W−2, y) is fluid).

    // ---- 3. outlet: fixed pressure (rho = 1) by non-equilibrium extrapolation from W−2 ----
    for (let y = 0; y < H; y++) {
      const c = y * Wd + Wd - 1;
      const s = c - 1;
      if (solid[c] || solid[s]) continue;
      const g0 = g[s], g1 = g[N + s], g2 = g[2 * N + s], g3 = g[3 * N + s], g4 = g[4 * N + s];
      const g5 = g[5 * N + s], g6 = g[6 * N + s], g7 = g[7 * N + s], g8 = g[8 * N + s];
      const r = g0 + g1 + g2 + g3 + g4 + g5 + g6 + g7 + g8;
      const vx = (g1 - g3 + g5 - g6 - g7 + g8) / r;
      const vy = (g2 - g4 + g5 + g6 - g7 - g8) / r;
      for (let i = 0; i < 9; i++) g[i * N + c] = feq(i, 1, vx, vy) + (g[i * N + s] - feq(i, r, vx, vy));
    }

    // ---- 4. swap and recompute macroscopic fields ----
    this.f = g;
    this.g = f;
    this.computeMacro();
  }

  private computeMacro(): void {
    const N = this.W * this.H;
    const f = this.f, solid = this.geom.solid;
    for (let c = 0; c < N; c++) {
      if (solid[c]) {
        this.rho[c] = 1;
        this.ux[c] = 0;
        this.uy[c] = 0;
        continue;
      }
      const f0 = f[c], f1 = f[N + c], f2 = f[2 * N + c], f3 = f[3 * N + c], f4 = f[4 * N + c];
      const f5 = f[5 * N + c], f6 = f[6 * N + c], f7 = f[7 * N + c], f8 = f[8 * N + c];
      const rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
      this.rho[c] = rho;
      this.ux[c] = (f1 - f3 + f5 - f6 - f7 + f8) / rho;
      this.uy[c] = (f2 - f4 + f5 + f6 - f7 - f8) / rho;
    }
  }
}
