import type { Geometry } from '../geometry/rasterize';

export type { Geometry };

export interface SimBackend {
  readonly kind: 'webgpu' | 'webgl2' | 'cpu';
  init(geom: Geometry, tau0: number, uIn: number): Promise<void>; // also used for reset
  setGeometry(geom: Geometry): void; // same grid size; keeps f, newly-solid → feq(1,0,0), newly-fluid → feq(1,0,0)
  setTau0(t: number): void;
  setInlet(ux: number, uy: number): void;
  initUniform(ux: number, uy: number): void;
  addKick(x0: number, y0: number, x1: number, y1: number, dvy: number): void;
  step(n: number): void;                       // n steps; force computed on the last one
  readForce(): Promise<{ fx: number; fy: number; finite: boolean }>;
  readMacro(): Promise<{ rho: Float32Array; ux: Float32Array; uy: Float32Array }>; // tests/parity only
  render(field: 'vorticity' | 'speed' | 'pressure', canvas: HTMLCanvasElement): void; // Task 9
  destroy(): void;
}
