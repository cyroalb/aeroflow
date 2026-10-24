import { LbmCpu } from '../physics/lbm-cpu';
import type { Geometry, SimBackend } from './types';

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

  render(_field: 'vorticity' | 'speed' | 'pressure', _canvas: HTMLCanvasElement): void {
    // Task 9: draw to a 2D canvas using colormaps.ts
  }

  destroy(): void {
    this.sim = null;
  }
}
