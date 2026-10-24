import { LbmCpu } from '../physics/lbm-cpu';
import type { Geometry, SimBackend } from './types';
import { colormapFor, colorIndex, SOLID_RGB, type FieldName } from '../ui/colormaps';

/** SimBackend over the CPU reference solver (tests and parity reference). */
export class CpuBackend implements SimBackend {
  readonly kind = 'cpu' as const;
  private sim: LbmCpu | null = null;

  private get s(): LbmCpu {
    if (!this.sim) throw new Error('CpuBackend: init() not called');
    return this.sim;
  }

  async init(geom: Geometry, tau0: number, uIn: number): Promise<void> {
    this.sim = new LbmCpu(geom, tau0, uIn);
  }

  setGeometry(geom: Geometry): void {
    this.s.setGeometry(geom);
  }

  setTau0(t: number): void {
    this.s.setTau0(t);
  }

  setInlet(ux: number, uy: number): void {
    this.s.setInlet(ux, uy);
  }

  initUniform(ux: number, uy: number): void {
    this.s.initUniform(ux, uy);
  }

  addKick(x0: number, y0: number, x1: number, y1: number, dvy: number): void {
    this.s.addKick(x0, y0, x1, y1, dvy);
  }

  step(n: number): void {
    const s = this.s;
    for (let k = 0; k < n; k++) s.step();
  }

  async readForce(): Promise<{ fx: number; fy: number; finite: boolean }> {
    const { fx, fy } = this.s.lastForce;
    return { fx, fy, finite: Number.isFinite(fx) && Number.isFinite(fy) };
  }

  async readMacro(): Promise<{ rho: Float32Array; ux: Float32Array; uy: Float32Array }> {
    const s = this.s;
    return { rho: s.rho.slice(), ux: s.ux.slice(), uy: s.uy.slice() };
  }

  /** Draws with a 2D context and ImageData (tests/dev only). */
  render(field: FieldName, canvas: HTMLCanvasElement, range: [number, number]): void {
    const s = this.s;
    const { W, H } = s;
    const solid = s.geom.solid;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('CpuBackend.render: 2d context unavailable');
    const cmap = colormapFor(field);
    const img = ctx.createImageData(W, H);
    const ux = (x: number, y: number) => (solid[y * W + x] ? 0 : s.ux[y * W + x]);
    const uy = (x: number, y: number) => (solid[y * W + x] ? 0 : s.uy[y * W + x]);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = y * W + x;
        let rgb: readonly number[];
        if (solid[c]) rgb = SOLID_RGB;
        else {
          let v: number;
          if (field === 'pressure') v = (s.rho[c] - 1) / 3;
          else if (field === 'speed') v = Math.hypot(s.ux[c], s.uy[c]);
          else {
            const xl = Math.max(x - 1, 0), xr = Math.min(x + 1, W - 1);
            const yl = Math.max(y - 1, 0), yr = Math.min(y + 1, H - 1);
            v = (uy(xr, y) - uy(xl, y)) / (xr - xl) - (ux(x, yr) - ux(x, yl)) / (yr - yl);
          }
          rgb = cmap[colorIndex(v, range)];
        }
        const o = 4 * ((H - 1 - y) * W + x);
        img.data[o] = rgb[0];
        img.data[o + 1] = rgb[1];
        img.data[o + 2] = rgb[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  destroy(): void {
    this.sim = null;
  }
}
