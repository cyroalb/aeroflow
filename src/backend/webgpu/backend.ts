import shaderSrc from './lbm.wgsl?raw';
import { CS_SMAG } from '../../config';
import type { Geometry, SimBackend } from '../types';

const SMAG_K = 18 * Math.SQRT2 * CS_SMAG * CS_SMAG;
const PARAMS_BYTES = 64;
const ENTRY_POINTS = ['collide', 'stream', 'outlet', 'macro_', 'force', 'util'] as const;
type Entry = (typeof ENTRY_POINTS)[number];

interface Buffers {
  f: GPUBuffer;
  fs: GPUBuffer;
  mac: GPUBuffer;
  forceOut: GPUBuffer;
  solid: GPUBuffer;
  q: GPUBuffer;
  links: GPUBuffer;
  changed: GPUBuffer;
  params: GPUBuffer;
}

/** WebGPU SimBackend: compute passes mirroring LbmCpu.step (see lbm.wgsl). */
export class WebGpuBackend implements SimBackend {
  readonly kind = 'webgpu' as const;
  private device: GPUDevice | null = null;
  private pipelines: Record<Entry, GPUComputePipeline> | null = null;
  private layout: GPUBindGroupLayout | null = null;
  private buf: Buffers | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private geom: Geometry | null = null;
  private nLinks = 0;
  private tau0 = 0.6;
  private uInX = 0;
  private uInY = 0;
  private readonly paramsData = new ArrayBuffer(PARAMS_BYTES);

  /** Requests the adapter/device and compiles the pipelines (called by init if needed). */
  private async ensureDevice(): Promise<GPUDevice> {
    if (this.device) return this.device;
    if (!navigator.gpu) throw new Error('WebGPU unavailable: navigator.gpu is undefined');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU unavailable: no adapter');
    const device = await adapter.requestDevice();
    device.addEventListener('uncapturederror', (e) => {
      console.error('WebGPU error:', (e as GPUUncapturedErrorEvent).error.message);
    });
    const module = device.createShaderModule({ code: shaderSrc });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    if (errors.length)
      throw new Error('lbm.wgsl: ' + errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; '));

    const storage = (binding: number, readOnly: boolean): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: readOnly ? 'read-only-storage' : 'storage' },
    });
    this.layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        storage(1, false), // f
        storage(2, false), // fs
        storage(3, false), // mac
        storage(4, false), // forceOut
        storage(5, true), // solid
        storage(6, true), // q
        storage(7, true), // links
        storage(8, true), // changed
      ],
    });
    const pl = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    const pipes = {} as Record<Entry, GPUComputePipeline>;
    for (const e of ENTRY_POINTS)
      pipes[e] = await device.createComputePipelineAsync({ layout: pl, compute: { module, entryPoint: e } });
    this.pipelines = pipes;
    this.device = device;
    return device;
  }

  private get dev(): GPUDevice {
    if (!this.device || !this.buf) throw new Error('WebGpuBackend: init() not called');
    return this.device;
  }

  private createBuffer(size: number, usage: GPUBufferUsageFlags): GPUBuffer {
    return this.dev.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage });
  }

  private freeBuffers(): void {
    if (!this.buf) return;
    for (const b of Object.values(this.buf)) b.destroy();
    this.buf = null;
    this.bindGroup = null;
  }

  private rebind(): void {
    const b = this.buf!;
    const order = [b.params, b.f, b.fs, b.mac, b.forceOut, b.solid, b.q, b.links, b.changed];
    this.bindGroup = this.dev.createBindGroup({
      layout: this.layout!,
      entries: order.map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
  }

  /** (Re)creates the link-dependent buffers and uploads solid, q and links. */
  private uploadGeometry(geom: Geometry): void {
    const d = this.dev, b = this.buf!;
    d.queue.writeBuffer(b.solid, 0, Uint32Array.from(geom.solid));
    d.queue.writeBuffer(b.q, 0, geom.q);
    this.nLinks = geom.links.length / 2;
    b.links.destroy();
    b.forceOut.destroy();
    const STO = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    b.links = this.createBuffer(geom.links.byteLength, STO);
    b.forceOut = this.createBuffer(8 * this.nLinks, STO);
    if (geom.links.length) d.queue.writeBuffer(b.links, 0, geom.links);
    if (this.nLinks) d.queue.writeBuffer(b.forceOut, 0, new Float32Array(2 * this.nLinks));
    this.geom = geom;
    this.rebind();
  }

  async init(geom: Geometry, tau0: number, uIn: number): Promise<void> {
    await this.ensureDevice();
    const d = this.device!;
    this.freeBuffers();
    const N = geom.W * geom.H;
    const STO = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const mk = (size: number, usage = STO): GPUBuffer =>
      d.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage });
    this.buf = {
      f: mk(36 * N),
      fs: mk(36 * N),
      mac: mk(12 * N),
      forceOut: mk(16),
      solid: mk(4 * N),
      q: mk(36 * N),
      links: mk(16),
      changed: mk(4 * N),
      params: mk(PARAMS_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    };
    this.tau0 = tau0;
    this.uInX = uIn;
    this.uInY = 0;
    this.uploadGeometry(geom);
    this.initUniform(uIn, 0);
  }

  setGeometry(geom: Geometry): void {
    const old = this.geom;
    if (!old) throw new Error('WebGpuBackend: init() not called');
    if (geom.W !== old.W || geom.H !== old.H) throw new Error('setGeometry: grid size mismatch');
    const N = geom.W * geom.H;
    const changed = new Uint32Array(N);
    for (let c = 0; c < N; c++) changed[c] = old.solid[c] !== geom.solid[c] ? 1 : 0;
    this.dev.queue.writeBuffer(this.buf!.changed, 0, changed);
    this.runUtil(2);
    this.uploadGeometry(geom);
  }

  setTau0(t: number): void {
    this.tau0 = t;
  }

  setInlet(ux: number, uy: number): void {
    this.uInX = ux;
    this.uInY = uy;
  }

  private writeParams(mode = 0, rect = [0, 0, -1, -1], a = 0, b = 0): void {
    const g = this.geom!;
    const u = new Uint32Array(this.paramsData);
    const fl = new Float32Array(this.paramsData);
    const i = new Int32Array(this.paramsData);
    u[0] = g.W;
    u[1] = g.H;
    u[2] = this.nLinks;
    u[3] = mode;
    fl[4] = this.tau0;
    fl[5] = SMAG_K;
    fl[6] = this.uInX;
    fl[7] = this.uInY;
    i[8] = rect[0];
    i[9] = rect[1];
    i[10] = rect[2];
    i[11] = rect[3];
    fl[12] = a;
    fl[13] = b;
    this.dev.queue.writeBuffer(this.buf!.params, 0, this.paramsData);
  }

  private runUtil(mode: number, rect?: number[], a = 0, b = 0): void {
    const d = this.dev, g = this.geom!;
    this.writeParams(mode, rect, a, b);
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, this.bindGroup!);
    pass.setPipeline(this.pipelines!.util);
    pass.dispatchWorkgroups(Math.ceil(g.W / 8), Math.ceil(g.H / 8));
    pass.end();
    d.queue.submit([enc.finish()]);
  }

  initUniform(ux: number, uy: number): void {
    this.runUtil(0, undefined, ux, uy);
  }

  addKick(x0: number, y0: number, x1: number, y1: number, dvy: number): void {
    const g = this.geom!;
    const xa = Math.max(0, Math.ceil(x0)), xb = Math.min(g.W - 1, Math.floor(x1));
    const ya = Math.max(0, Math.ceil(y0)), yb = Math.min(g.H - 1, Math.floor(y1));
    this.runUtil(1, [xa, ya, xb, yb], dvy, 0);
  }

  step(n: number): void {
    if (n <= 0) return;
    const d = this.dev, g = this.geom!, p = this.pipelines!;
    this.writeParams();
    const gx = Math.ceil(g.W / 8), gy = Math.ceil(g.H / 8);
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, this.bindGroup!);
    for (let k = 0; k < n; k++) {
      pass.setPipeline(p.collide);
      pass.dispatchWorkgroups(gx, gy);
      pass.setPipeline(p.stream);
      pass.dispatchWorkgroups(gx, gy);
      pass.setPipeline(p.outlet);
      pass.dispatchWorkgroups(Math.ceil(g.H / 64));
      if (k === n - 1 && this.nLinks > 0) {
        // force before macro is fine: it reads fs and f only
        pass.setPipeline(p.force);
        pass.dispatchWorkgroups(Math.ceil(this.nLinks / 64));
      }
      pass.setPipeline(p.macro_);
      pass.dispatchWorkgroups(gx, gy);
    }
    pass.end();
    d.queue.submit([enc.finish()]);
  }

  private async readBuffer(src: GPUBuffer, bytes: number): Promise<Float32Array> {
    const d = this.dev;
    const staging = d.createBuffer({
      size: Math.max(16, bytes),
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const enc = d.createCommandEncoder();
    if (bytes > 0) enc.copyBufferToBuffer(src, 0, staging, 0, bytes);
    d.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange(0, bytes).slice(0));
    staging.unmap();
    staging.destroy();
    return out;
  }

  async readForce(): Promise<{ fx: number; fy: number; finite: boolean }> {
    const v = await this.readBuffer(this.buf!.forceOut, 8 * this.nLinks);
    let fx = 0, fy = 0, finite = true;
    for (let k = 0; k < v.length; k += 2) {
      const a = v[k], b = v[k + 1];
      if (!Number.isFinite(a) || !Number.isFinite(b)) finite = false;
      fx += a;
      fy += b;
    }
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) finite = false;
    return { fx, fy, finite };
  }

  async readMacro(): Promise<{ rho: Float32Array; ux: Float32Array; uy: Float32Array }> {
    const g = this.geom!;
    const N = g.W * g.H;
    const m = await this.readBuffer(this.buf!.mac, 12 * N);
    return { rho: m.slice(0, N), ux: m.slice(N, 2 * N), uy: m.slice(2 * N, 3 * N) };
  }

  render(_field: 'vorticity' | 'speed' | 'pressure', _canvas: HTMLCanvasElement): void {
    // Task 9 (render.wgsl)
  }

  destroy(): void {
    this.freeBuffers();
    this.device?.destroy();
    this.device = null;
    this.pipelines = null;
    this.layout = null;
    this.geom = null;
  }
}
