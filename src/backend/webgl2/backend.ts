import vertSrc from './quad.vert.glsl?raw';
import lbmSrc from './lbm.frag.glsl?raw';
import outletSrc from './outlet.frag.glsl?raw';
import forceSrc from './force.frag.glsl?raw';
import renderSrc from './render.frag.glsl?raw';
import { colormapFor, colormapRGBA8, type FieldName } from '../../ui/colormaps';
import { CS_SMAG } from '../../config';
import type { Geometry, SimBackend } from '../types';

const SMAG_K = 18 * Math.SQRT2 * CS_SMAG * CS_SMAG;

/** Texture units, fixed per sampler name across all programs. */
const UNITS = {
  uF0: 0, uF1: 1, uF2: 2,
  uS0: 3, uS1: 4, uS2: 5,
  uQ0: 6, uQ1: 7, uQ2: 8,
  uSolid: 9, uMac: 10, uChanged: 11, uLinks: 12, uCmap: 13,
} as const;
type Unit = keyof typeof UNITS;
const N_UNITS = 14;

type Prog = 'collide' | 'stream' | 'macro' | 'util' | 'outlet' | 'force' | 'render';

interface Program {
  prog: WebGLProgram;
  loc: Map<string, WebGLUniformLocation | null>;
}

/** A set of 9 populations: tex0 = f0..f3, tex1 = f4..f7, tex2.r = f8 (all RGBA32F). */
type FSet = [WebGLTexture, WebGLTexture, WebGLTexture];

interface Resources {
  f: [FSet, FSet]; // ping-pong: f[cur] = current f, f[1 - cur] = streamed (pre-outlet)
  fs: FSet; // post-collision f*
  mac: [WebGLTexture, WebGLTexture]; // RGBA32F (rho, ux, uy, 0), ping-pong for util passes
  q: FSet;
  solid: WebGLTexture; // R8
  changed: WebGLTexture; // R8
  links: WebGLTexture; // RG32F (cell, ib), linkW × linkH
  force: WebGLTexture; // RG32F, linkW × linkH
  fbF: [WebGLFramebuffer, WebGLFramebuffer];
  fbFs: WebGLFramebuffer;
  fbMac: [WebGLFramebuffer, WebGLFramebuffer];
  fbUtil: WebGLFramebuffer[]; // index 2 * fset + macset: f[fset] + mac[macset]
  fbForce: WebGLFramebuffer;
}

/**
 * WebGL2 SimBackend (fallback without WebGPU): fragment passes mirroring LbmCpu.step and
 * lbm.wgsl. Per step: collide (f → fs) ; stream (fs → f') ; outlet (f' → f, full copy +
 * column W−1) ; [last step only] force (per link) ; macro (f → mac).
 */
export class WebGL2Backend implements SimBackend {
  readonly kind = 'webgl2' as const;
  private gl: WebGL2RenderingContext | null = null;
  private progs: Record<Prog, Program> | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private glCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private cmaps = new Map<FieldName, WebGLTexture>();
  private res: Resources | null = null;
  private geom: Geometry | null = null;
  private cur = 0; // current f set
  private curMac = 0; // current mac texture
  private nLinks = 0;
  private linkW = 1;
  private linkH = 1;
  private tau0 = 0.6;
  private uInX = 0;
  private uInY = 0;

  constructor(private readonly canvas?: HTMLCanvasElement | OffscreenCanvas) {}

  static isSupported(gl: WebGL2RenderingContext | null | undefined): boolean {
    return !!gl && gl.getExtension('EXT_color_buffer_float') !== null;
  }

  // ---------- context, shaders ----------

  private ensureContext(): WebGL2RenderingContext {
    if (this.gl && !this.gl.isContextLost()) return this.gl;
    this.gl = null;
    this.progs = null;
    this.res = null;
    this.cmaps.clear();
    const canvas = this.canvas ?? document.createElement('canvas');
    this.glCanvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      depth: false,
      stencil: false,
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 unavailable: getContext("webgl2") returned null');
    if (!WebGL2Backend.isSupported(gl)) throw new Error('WebGL2: EXT_color_buffer_float unavailable');
    const vs = vertSrc;
    const lbm = (pass: number) => `#define PASS ${pass}\n${lbmSrc}`;
    this.gl = gl;
    this.progs = {
      collide: this.link(vs, lbm(1)),
      stream: this.link(vs, lbm(2)),
      macro: this.link(vs, lbm(3)),
      util: this.link(vs, lbm(4)),
      outlet: this.link(vs, outletSrc),
      force: this.link(vs, forceSrc),
      render: this.link(vs, renderSrc),
    };
    this.vao = gl.createVertexArray();
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.DITHER);
    return gl;
  }

  private compile(type: number, body: string): WebGLShader {
    const gl = this.gl!;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, `#version 300 es\n${body}`);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`WebGL2 shader compile: ${log}`);
    }
    return sh;
  }

  private link(vsSrc: string, fsSrc: string): Program {
    const gl = this.gl!;
    const vs = this.compile(gl.VERTEX_SHADER, vsSrc);
    const fs = this.compile(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(`WebGL2 program link: ${gl.getProgramInfoLog(prog)}`);
    const loc = new Map<string, WebGLUniformLocation | null>();
    gl.useProgram(prog);
    for (const [name, unit] of Object.entries(UNITS)) {
      const l = gl.getUniformLocation(prog, name);
      if (l) gl.uniform1i(l, unit);
    }
    return { prog, loc };
  }

  private uni(p: Program, name: string): WebGLUniformLocation | null {
    let l = p.loc.get(name);
    if (l === undefined) {
      l = this.gl!.getUniformLocation(p.prog, name);
      p.loc.set(name, l);
    }
    return l;
  }

  // ---------- resources ----------

  private tex(internal: number, format: number, type: number, w: number, h: number, data: ArrayBufferView | null) {
    const gl = this.gl!;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    return t;
  }

  private rgba32f(w: number, h: number, data: Float32Array | null = null): WebGLTexture {
    const gl = this.gl!;
    return this.tex(gl.RGBA32F, gl.RGBA, gl.FLOAT, w, h, data);
  }

  private fset(w: number, h: number): FSet {
    return [this.rgba32f(w, h), this.rgba32f(w, h), this.rgba32f(w, h)];
  }

  private fbo(targets: WebGLTexture[]): WebGLFramebuffer {
    const gl = this.gl!;
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const bufs = targets.map((t, k) => {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0);
      return gl.COLOR_ATTACHMENT0 + k;
    });
    gl.drawBuffers(bufs);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`WebGL2 framebuffer incomplete (0x${st.toString(16)})`);
    return fb;
  }

  private freeResources(): void {
    const gl = this.gl, r = this.res;
    this.res = null;
    if (!gl || !r || gl.isContextLost()) return;
    const texs = [...r.f[0], ...r.f[1], ...r.fs, ...r.mac, ...r.q, r.solid, r.changed, r.links, r.force];
    for (const t of texs) gl.deleteTexture(t);
    for (const t of this.cmaps.values()) gl.deleteTexture(t);
    this.cmaps.clear();
    for (const fb of [...r.fbF, r.fbFs, ...r.fbMac, ...r.fbUtil, r.fbForce]) gl.deleteFramebuffer(fb);
  }

  /** Packs a [i*N + c] array (9 planes) into 3 RGBA32F textures: (0..3), (4..7), (8). */
  private uploadPlanes(set: FSet, planes: Float32Array, W: number, H: number): void {
    const gl = this.gl!;
    const N = W * H;
    for (let t = 0; t < 3; t++) {
      const d = new Float32Array(4 * N);
      for (let k = 0; k < 4; k++) {
        const i = 4 * t + k;
        if (i > 8) break;
        for (let c = 0; c < N; c++) d[4 * c + k] = planes[i * N + c];
      }
      gl.bindTexture(gl.TEXTURE_2D, set[t]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, d);
    }
  }

  private uploadR8(t: WebGLTexture, data: Uint8Array, W: number, H: number): void {
    const gl = this.gl!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED, gl.UNSIGNED_BYTE, data);
  }

  /** Uploads solid and q; (re)creates the link and force textures (wrapped to rows if needed). */
  private uploadGeometry(geom: Geometry): void {
    const gl = this.gl!, r = this.res!;
    const { W, H } = geom;
    this.uploadR8(r.solid, Uint8Array.from(geom.solid, (v) => (v ? 255 : 0)) /* R8 UNORM: 255 → 1.0 */, W, H);
    this.uploadPlanes(r.q, geom.q, W, H);
    this.nLinks = geom.links.length / 2;
    const maxW = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.linkW = Math.max(1, Math.min(this.nLinks, maxW));
    this.linkH = Math.max(1, Math.ceil(this.nLinks / this.linkW));
    if (this.linkH > maxW) throw new Error(`WebGL2: too many wall links (${this.nLinks})`);
    const n = this.linkW * this.linkH;
    const ld = new Float32Array(2 * n).fill(-1);
    for (let k = 0; k < 2 * this.nLinks; k++) ld[k] = geom.links[k];
    gl.deleteTexture(r.links);
    gl.deleteTexture(r.force);
    gl.deleteFramebuffer(r.fbForce);
    r.links = this.tex(gl.RG32F, gl.RG, gl.FLOAT, this.linkW, this.linkH, ld);
    r.force = this.tex(gl.RG32F, gl.RG, gl.FLOAT, this.linkW, this.linkH, new Float32Array(2 * n));
    r.fbForce = this.fbo([r.force]);
    this.geom = geom;
  }

  async init(geom: Geometry, tau0: number, uIn: number): Promise<void> {
    const gl = this.ensureContext();
    this.freeResources();
    const { W, H } = geom;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (W > max || H > max) throw new Error(`WebGL2: grid ${W}×${H} exceeds MAX_TEXTURE_SIZE ${max}`);
    const f: [FSet, FSet] = [this.fset(W, H), this.fset(W, H)];
    const fs = this.fset(W, H);
    const mac: [WebGLTexture, WebGLTexture] = [this.rgba32f(W, H), this.rgba32f(W, H)];
    const r8 = () => this.tex(gl.R8, gl.RED, gl.UNSIGNED_BYTE, W, H, new Uint8Array(W * H));
    const dummy = this.tex(gl.RG32F, gl.RG, gl.FLOAT, 1, 1, new Float32Array(2));
    this.res = {
      f,
      fs,
      mac,
      q: this.fset(W, H),
      solid: r8(),
      changed: r8(),
      links: dummy,
      force: this.tex(gl.RG32F, gl.RG, gl.FLOAT, 1, 1, new Float32Array(2)),
      fbF: [this.fbo(f[0]), this.fbo(f[1])],
      fbFs: this.fbo(fs),
      fbMac: [this.fbo([mac[0]]), this.fbo([mac[1]])],
      fbUtil: [
        this.fbo([...f[0], mac[0]]),
        this.fbo([...f[0], mac[1]]),
        this.fbo([...f[1], mac[0]]),
        this.fbo([...f[1], mac[1]]),
      ],
      fbForce: gl.createFramebuffer()!,
    };
    this.cur = 0;
    this.curMac = 0;
    this.tau0 = tau0;
    this.uInX = uIn;
    this.uInY = 0;
    this.uploadGeometry(geom);
    this.initUniform(uIn, 0);
  }

  private get ready(): boolean {
    return !!this.gl && !!this.res && !this.gl.isContextLost();
  }

  private require(): void {
    if (!this.res || !this.geom) throw new Error('WebGL2Backend: init() not called');
  }

  // ---------- passes ----------

  /** Binds the given textures to their units (all other units unbound: no feedback loops). */
  private bindTextures(tex: Partial<Record<Unit, WebGLTexture>>): void {
    const gl = this.gl!;
    const byUnit: (WebGLTexture | null)[] = new Array(N_UNITS).fill(null);
    for (const [name, t] of Object.entries(tex)) byUnit[UNITS[name as Unit]] = t!;
    for (let u = 0; u < N_UNITS; u++) {
      gl.activeTexture(gl.TEXTURE0 + u);
      gl.bindTexture(gl.TEXTURE_2D, byUnit[u]);
    }
  }

  private fTex(set: FSet, prefix: 'uF' | 'uS' | 'uQ'): Partial<Record<Unit, WebGLTexture>> {
    return { [`${prefix}0`]: set[0], [`${prefix}1`]: set[1], [`${prefix}2`]: set[2] };
  }

  private draw(
    name: Prog,
    fb: WebGLFramebuffer | null,
    tex: Partial<Record<Unit, WebGLTexture>>,
    set?: (p: Program) => void,
    vw = this.geom!.W,
    vh = this.geom!.H,
  ): void {
    const gl = this.gl!, p = this.progs![name];
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, vw, vh);
    gl.useProgram(p.prog);
    gl.uniform2i(this.uni(p, 'uSize'), this.geom!.W, this.geom!.H);
    set?.(p);
    this.bindTextures(tex);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Util pass: f[cur], mac[curMac] → f[1−cur], mac[1−curMac]; then swaps both. */
  private runUtil(mode: number, rect = [0, 0, -1, -1], a = 0, b = 0): void {
    const gl = this.gl!, r = this.res!;
    const fo = 1 - this.cur, mo = 1 - this.curMac;
    this.draw(
      'util',
      r.fbUtil[2 * fo + mo],
      { ...this.fTex(r.f[this.cur], 'uF'), uMac: r.mac[this.curMac], uSolid: r.solid, uChanged: r.changed },
      (p) => {
        gl.uniform1i(this.uni(p, 'uMode'), mode);
        gl.uniform4i(this.uni(p, 'uRect'), rect[0], rect[1], rect[2], rect[3]);
        gl.uniform2f(this.uni(p, 'uAB'), a, b);
      },
    );
    this.cur = fo;
    this.curMac = mo;
  }

  setGeometry(geom: Geometry): void {
    this.require();
    const old = this.geom!;
    if (geom.W !== old.W || geom.H !== old.H) throw new Error('setGeometry: grid size mismatch');
    if (!this.ready) return;
    const N = geom.W * geom.H;
    const changed = new Uint8Array(N);
    for (let c = 0; c < N; c++) changed[c] = old.solid[c] !== geom.solid[c] ? 255 : 0;
    this.uploadR8(this.res!.changed, changed, geom.W, geom.H);
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

  initUniform(ux: number, uy: number): void {
    this.require();
    if (!this.ready) return;
    this.runUtil(0, undefined, ux, uy);
  }

  addKick(x0: number, y0: number, x1: number, y1: number, dvy: number): void {
    this.require();
    if (!this.ready) return;
    const g = this.geom!;
    const xa = Math.max(0, Math.ceil(x0)), xb = Math.min(g.W - 1, Math.floor(x1));
    const ya = Math.max(0, Math.ceil(y0)), yb = Math.min(g.H - 1, Math.floor(y1));
    this.runUtil(1, [xa, ya, xb, yb], dvy, 0);
  }

  step(n: number): void {
    this.require();
    if (n <= 0 || !this.ready) return;
    const gl = this.gl!, r = this.res!;
    for (let k = 0; k < n; k++) {
      const f = r.f[this.cur], fNext = r.f[1 - this.cur];
      this.draw('collide', r.fbFs, { ...this.fTex(f, 'uF'), uSolid: r.solid }, (p) => {
        gl.uniform1f(this.uni(p, 'uTau0'), this.tau0);
        gl.uniform1f(this.uni(p, 'uSmagK'), SMAG_K);
      });
      this.draw(
        'stream',
        r.fbF[1 - this.cur],
        { ...this.fTex(r.fs, 'uS'), ...this.fTex(r.q, 'uQ'), uSolid: r.solid, uMac: r.mac[this.curMac] },
        (p) => gl.uniform2f(this.uni(p, 'uIn'), this.uInX, this.uInY),
      );
      this.draw('outlet', r.fbF[this.cur], { ...this.fTex(fNext, 'uF'), uSolid: r.solid });
      if (k === n - 1 && this.nLinks > 0) {
        this.draw(
          'force',
          r.fbForce,
          { ...this.fTex(f, 'uF'), ...this.fTex(r.fs, 'uS'), uLinks: r.links },
          (p) => {
            gl.uniform1i(this.uni(p, 'uLinkW'), this.linkW);
            gl.uniform1i(this.uni(p, 'uNLinks'), this.nLinks);
          },
          this.linkW,
          this.linkH,
        );
      }
      this.draw('macro', r.fbMac[this.curMac], { ...this.fTex(f, 'uF'), uSolid: r.solid });
    }
  }

  // ---------- readback ----------

  /** Reads attachment 0 of `fb` as RGBA/FLOAT (the readback combination guaranteed for float buffers). */
  private readRGBA(fb: WebGLFramebuffer, w: number, h: number): Float32Array {
    const gl = this.gl!;
    const out = new Float32Array(4 * w * h);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    return out;
  }

  async readForce(): Promise<{ fx: number; fy: number; finite: boolean }> {
    this.require();
    if (!this.ready) return { fx: NaN, fy: NaN, finite: false };
    if (this.nLinks === 0) return { fx: 0, fy: 0, finite: true };
    const v = this.readRGBA(this.res!.fbForce, this.linkW, this.linkH);
    let fx = 0, fy = 0, finite = true;
    for (let k = 0; k < this.nLinks; k++) {
      const a = v[4 * k], b = v[4 * k + 1];
      if (!Number.isFinite(a) || !Number.isFinite(b)) finite = false;
      fx += a;
      fy += b;
    }
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) finite = false;
    return { fx, fy, finite };
  }

  async readMacro(): Promise<{ rho: Float32Array; ux: Float32Array; uy: Float32Array }> {
    this.require();
    if (!this.ready) throw new Error('WebGL2Backend: context lost');
    const g = this.geom!;
    const N = g.W * g.H;
    const m = this.readRGBA(this.res!.fbMac[this.curMac], g.W, g.H);
    const rho = new Float32Array(N), ux = new Float32Array(N), uy = new Float32Array(N);
    for (let c = 0; c < N; c++) {
      rho[c] = m[4 * c];
      ux[c] = m[4 * c + 1];
      uy[c] = m[4 * c + 2];
    }
    return { rho, ux, uy };
  }

  private cmapTexture(field: FieldName): WebGLTexture {
    let t = this.cmaps.get(field);
    if (!t) {
      t = this.tex(this.gl!.RGBA8, this.gl!.RGBA, this.gl!.UNSIGNED_BYTE, 256, 1, colormapRGBA8(colormapFor(field)));
      this.cmaps.set(field, t);
    }
    return t;
  }

  /**
   * A GL context can only draw to its own canvas (the one passed to the constructor, or an internal
   * one). The field is always drawn there at grid size W×H; if `canvas` is a different element, the
   * result is then copied into it with a 2D drawImage in the same task (the drawing buffer is still
   * intact, there is no preserveDrawingBuffer).
   */
  render(field: FieldName, canvas: HTMLCanvasElement, range: [number, number]): void {
    this.require();
    if (!this.ready) return;
    const gl = this.gl!, r = this.res!, g = this.geom!;
    const own = this.glCanvas!;
    if (own.width !== g.W) own.width = g.W;
    if (own.height !== g.H) own.height = g.H;
    this.draw(
      'render',
      null,
      { uMac: r.mac[this.curMac], uSolid: r.solid, uCmap: this.cmapTexture(field) },
      (p) => {
        gl.uniform2f(this.uni(p, 'uRange'), range[0], range[1]);
        gl.uniform1i(this.uni(p, 'uField'), field === 'vorticity' ? 0 : field === 'speed' ? 1 : 2);
      },
    );
    if (canvas !== (own as unknown)) {
      canvas.width = g.W;
      canvas.height = g.H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('WebGL2Backend.render: 2d context unavailable on target canvas');
      ctx.drawImage(own as CanvasImageSource, 0, 0);
    }
  }

  destroy(): void {
    const gl = this.gl;
    this.freeResources();
    if (gl && !gl.isContextLost() && this.progs) {
      for (const p of Object.values(this.progs)) gl.deleteProgram(p.prog);
      gl.deleteVertexArray(this.vao);
    }
    this.progs = null;
    this.vao = null;
    this.geom = null;
    // release the GPU context early, but only for a canvas this backend created itself
    if (!this.canvas) this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = null;
  }
}
