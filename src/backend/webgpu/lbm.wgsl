// D2Q9 Lattice Boltzmann, WebGPU port of src/physics/lbm-cpu.ts (the executable spec).
// Buffers: f = current (post-streaming) distributions, fs = post-collision f*, both laid out
// f[i*N + cell]. One step = collide (f -> fs) ; stream + Bouzidi + inlet + free slip (fs -> f) ;
// outlet (f, column W-1) ; macro (f -> mac) ; [last step only] force (per link -> forceOut).

struct Params {
  W: u32, H: u32, nLinks: u32, mode: u32,
  tau0: f32, smagK: f32, uInX: f32, uInY: f32,
  x0: i32, y0: i32, x1: i32, y1: i32,
  a: f32, b: f32, pad0: f32, pad1: f32,
};

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> f: array<f32>;
@group(0) @binding(2) var<storage, read_write> fs: array<f32>;
// mac[c] = rho, mac[N + c] = ux, mac[2N + c] = uy
@group(0) @binding(3) var<storage, read_write> mac: array<f32>;
@group(0) @binding(4) var<storage, read_write> forceOut: array<f32>;
@group(0) @binding(5) var<storage, read> solid: array<u32>;
@group(0) @binding(6) var<storage, read> qv: array<f32>;
@group(0) @binding(7) var<storage, read> links: array<i32>;
@group(0) @binding(8) var<storage, read> changed: array<u32>;

// Order: 0 rest, 1 E, 2 N, 3 W, 4 S, 5 NE, 6 NW, 7 SW, 8 SE
const CX = array<i32, 9>(0, 1, 0, -1, 0, 1, -1, -1, 1);
const CY = array<i32, 9>(0, 0, 1, 0, -1, 1, 1, -1, -1);
const WT = array<f32, 9>(4.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0,
                         1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0);
const OPP = array<u32, 9>(0u, 3u, 4u, 1u, 2u, 7u, 8u, 5u, 6u);
const MIR = array<u32, 9>(0u, 1u, 4u, 3u, 2u, 8u, 7u, 6u, 5u);

fn feq(i: u32, rho: f32, ux: f32, uy: f32) -> f32 {
  let cu = f32(CX[i]) * ux + f32(CY[i]) * uy;
  return WT[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * (ux * ux + uy * uy));
}

fn isSolid(c: u32) -> bool {
  return solid[c] != 0u;
}

fn setCellEq(c: u32, rho: f32, ux: f32, uy: f32) {
  let N = P.W * P.H;
  for (var i = 0u; i < 9u; i++) {
    f[i * N + c] = feq(i, rho, ux, uy);
  }
  mac[c] = rho;
  mac[N + c] = ux;
  mac[2u * N + c] = uy;
}

// ---- 1. collision: regularized BGK + Smagorinsky, f -> fs (solids copied unchanged) ----
@compute @workgroup_size(8, 8)
fn collide(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= P.W || id.y >= P.H) { return; }
  let N = P.W * P.H;
  let c = id.y * P.W + id.x;
  var fl: array<f32, 9>;
  for (var i = 0u; i < 9u; i++) { fl[i] = f[i * N + c]; }
  if (isSolid(c)) {
    for (var i = 0u; i < 9u; i++) { fs[i * N + c] = fl[i]; }
    return;
  }
  let rho = fl[0] + fl[1] + fl[2] + fl[3] + fl[4] + fl[5] + fl[6] + fl[7] + fl[8];
  let ux = (fl[1] - fl[3] + fl[5] - fl[6] - fl[7] + fl[8]) / rho;
  let uy = (fl[2] - fl[4] + fl[5] + fl[6] - fl[7] - fl[8]) / rho;
  let usq = 1.5 * (ux * ux + uy * uy);
  var pxx = 0.0;
  var pxy = 0.0;
  var pyy = 0.0;
  for (var i = 0u; i < 9u; i++) {
    let cx = f32(CX[i]);
    let cy = f32(CY[i]);
    let cu = cx * ux + cy * uy;
    let fq = WT[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - usq);
    let fnq = fl[i] - fq;
    pxx += cx * cx * fnq;
    pxy += cx * cy * fnq;
    pyy += cy * cy * fnq;
  }
  let pmag = sqrt(pxx * pxx + pyy * pyy + 2.0 * pxy * pxy);
  let tau0 = P.tau0;
  let tau = 0.5 * (tau0 + sqrt(tau0 * tau0 + (P.smagK * pmag) / rho));
  let omega = 1.0 - 1.0 / tau;
  for (var i = 0u; i < 9u; i++) {
    let cx = f32(CX[i]);
    let cy = f32(CY[i]);
    let cu = cx * ux + cy * uy;
    let fq = WT[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - usq);
    let qxx = cx * cx - 1.0 / 3.0;
    let qyy = cy * cy - 1.0 / 3.0;
    let qxy = cx * cy;
    let fneq = 4.5 * WT[i] * (qxx * pxx + 2.0 * qxy * pxy + qyy * pyy);
    fs[i * N + c] = fq + omega * fneq;
  }
}

// ---- 2. pull streaming with boundaries, fs -> f ----
// Wall links (source x - c_i solid and inside the grid) use Bouzidi with ī = OPP[i],
// q = qv[ī*N + x]; this is exactly the set of links in geom.links. The inlet column is
// handled first, so its links never reach Bouzidi (as in the CPU).
@compute @workgroup_size(8, 8)
fn stream(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= P.W || id.y >= P.H) { return; }
  let Wd = P.W;
  let H = P.H;
  let N = Wd * H;
  let x = id.x;
  let y = id.y;
  let c = y * Wd + x;
  if (isSolid(c)) {
    for (var i = 0u; i < 9u; i++) { f[i * N + c] = feq(i, 1.0, 0.0, 0.0); }
    return;
  }
  if (x == 0u) {
    // inlet: density of (1, y) from the previous step's macroscopic values
    let r = mac[c + 1u];
    for (var i = 0u; i < 9u; i++) { f[i * N + c] = feq(i, r, P.uInX, P.uInY); }
    return;
  }
  f[c] = fs[c];
  for (var i = 1u; i < 9u; i++) {
    let sy = i32(y) - CY[i];
    let sxr = i32(x) - CX[i];
    let sx = clamp(sxr, 0, i32(Wd) - 1); // only clamps at x = W-1 (outlet)
    var v: f32;
    if (sy < 0 || sy >= i32(H)) {
      // free slip: mirrored population from the same row
      let s = y * Wd + u32(sx);
      if (isSolid(s)) { v = fs[OPP[i] * N + c]; } else { v = fs[MIR[i] * N + s]; }
    } else {
      let s = u32(sy) * Wd + u32(sx);
      if (isSolid(s)) {
        let ib = OPP[i];
        let fb = fs[ib * N + c]; // f*_ī(x_f)
        if (sx == sxr) {
          // Bouzidi interpolated bounce-back on the wall link (x, ī)
          let q = qv[ib * N + c];
          if (q < 0.5) {
            let nx = i32(x) + CX[i];
            let ny = i32(y) + CY[i];
            if (nx < 0 || nx >= i32(Wd) || ny < 0 || ny >= i32(H) || isSolid(u32(ny) * Wd + u32(nx))) {
              v = fb;
            } else {
              v = 2.0 * q * fb + (1.0 - 2.0 * q) * fs[ib * N + u32(ny) * Wd + u32(nx)];
            }
          } else {
            v = fb / (2.0 * q) + ((2.0 * q - 1.0) / (2.0 * q)) * fs[i * N + c];
          }
        } else {
          v = fb; // clamped outlet source: halfway bounce-back (overwritten by the outlet)
        }
      } else {
        v = fs[i * N + s];
      }
    }
    f[i * N + c] = v;
  }
}

// ---- 3. outlet: fixed pressure (rho = 1) by non-equilibrium extrapolation from W-2 ----
@compute @workgroup_size(64)
fn outlet(@builtin(global_invocation_id) id: vec3<u32>) {
  let y = id.x;
  if (y >= P.H) { return; }
  let N = P.W * P.H;
  let c = y * P.W + P.W - 1u;
  let s = c - 1u;
  if (isSolid(c) || isSolid(s)) { return; }
  var g: array<f32, 9>;
  for (var i = 0u; i < 9u; i++) { g[i] = f[i * N + s]; }
  let r = g[0] + g[1] + g[2] + g[3] + g[4] + g[5] + g[6] + g[7] + g[8];
  let vx = (g[1] - g[3] + g[5] - g[6] - g[7] + g[8]) / r;
  let vy = (g[2] - g[4] + g[5] + g[6] - g[7] - g[8]) / r;
  for (var i = 0u; i < 9u; i++) {
    f[i * N + c] = feq(i, 1.0, vx, vy) + (g[i] - feq(i, r, vx, vy));
  }
}

// ---- 4. macroscopic fields from the new f ----
@compute @workgroup_size(8, 8)
fn macro_(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= P.W || id.y >= P.H) { return; }
  let N = P.W * P.H;
  let c = id.y * P.W + id.x;
  if (isSolid(c)) {
    mac[c] = 1.0;
    mac[N + c] = 0.0;
    mac[2u * N + c] = 0.0;
    return;
  }
  var fl: array<f32, 9>;
  for (var i = 0u; i < 9u; i++) { fl[i] = f[i * N + c]; }
  let rho = fl[0] + fl[1] + fl[2] + fl[3] + fl[4] + fl[5] + fl[6] + fl[7] + fl[8];
  mac[c] = rho;
  mac[N + c] = (fl[1] - fl[3] + fl[5] - fl[6] - fl[7] + fl[8]) / rho;
  mac[2u * N + c] = (fl[2] - fl[4] + fl[5] + fl[6] - fl[7] - fl[8]) / rho;
}

// ---- 5. momentum exchange per link: c_ī (f*_ī(x_f) + f_i(x_f)), inlet column excluded ----
@compute @workgroup_size(64)
fn force(@builtin(global_invocation_id) id: vec3<u32>) {
  let k = id.x;
  if (k >= P.nLinks) { return; }
  let N = P.W * P.H;
  let c = u32(links[2u * k]);
  let ib = u32(links[2u * k + 1u]);
  if (c % P.W == 0u) {
    forceOut[2u * k] = 0.0;
    forceOut[2u * k + 1u] = 0.0;
    return;
  }
  let m = fs[ib * N + c] + f[OPP[ib] * N + c];
  forceOut[2u * k] = f32(CX[ib]) * m;
  forceOut[2u * k + 1u] = f32(CY[ib]) * m;
}

// ---- utilities: mode 0 initUniform(a, b) ; 1 kick (rect x0..y1, dvy = a) ; 2 geometry change ----
@compute @workgroup_size(8, 8)
fn util(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= P.W || id.y >= P.H) { return; }
  let N = P.W * P.H;
  let c = id.y * P.W + id.x;
  if (P.mode == 0u) {
    if (isSolid(c)) { setCellEq(c, 1.0, 0.0, 0.0); } else { setCellEq(c, 1.0, P.a, P.b); }
  } else if (P.mode == 1u) {
    let x = i32(id.x);
    let y = i32(id.y);
    if (x < P.x0 || x > P.x1 || y < P.y0 || y > P.y1 || isSolid(c)) { return; }
    setCellEq(c, mac[c], mac[N + c], mac[2u * N + c] + P.a);
  } else {
    if (changed[c] != 0u) { setCellEq(c, 1.0, 0.0, 0.0); }
  }
}
