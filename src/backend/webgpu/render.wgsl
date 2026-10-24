// Field rendering: full-screen triangle + fragment shader reading mac/solid (read-only storage)
// and a 256-entry colormap. Field math mirrors CpuBackend.render. Row 0 (y = 0) is the image bottom.

struct RP {
  W: u32, H: u32, field: u32, pad: u32,   // field: 0 vorticity, 1 speed, 2 pressure
  lo: f32, hi: f32, pad1: f32, pad2: f32,
};

@group(0) @binding(0) var<uniform> P: RP;
@group(0) @binding(1) var<storage, read> mac: array<f32>;   // rho | ux | uy planes
@group(0) @binding(2) var<storage, read> solid: array<u32>;
@group(0) @binding(3) var<storage, read> cmap: array<vec4<f32>>;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

fn vel(x: i32, y: i32) -> vec2<f32> {
  let N = P.W * P.H;
  let c = u32(y) * P.W + u32(x);
  if (solid[c] != 0u) { return vec2<f32>(0.0); }
  return vec2<f32>(mac[N + c], mac[2u * N + c]);
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let x = i32(floor(pos.x));
  let y = i32(P.H) - 1 - i32(floor(pos.y));
  if (x < 0 || y < 0 || x >= i32(P.W) || y >= i32(P.H)) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  let N = P.W * P.H;
  let c = u32(y) * P.W + u32(x);
  if (solid[c] != 0u) { return vec4<f32>(154.0 / 255.0, 164.0 / 255.0, 178.0 / 255.0, 1.0); }
  var v: f32;
  if (P.field == 2u) {
    v = (mac[c] - 1.0) / 3.0;
  } else if (P.field == 1u) {
    v = length(vec2<f32>(mac[N + c], mac[2u * N + c]));
  } else {
    let xl = max(x - 1, 0);
    let xr = min(x + 1, i32(P.W) - 1);
    let yl = max(y - 1, 0);
    let yr = min(y + 1, i32(P.H) - 1);
    v = (vel(xr, y).y - vel(xl, y).y) / f32(xr - xl) - (vel(x, yr).x - vel(x, yl).x) / f32(yr - yl);
  }
  let t = clamp((v - P.lo) / (P.hi - P.lo), 0.0, 1.0);
  let idx = u32(floor(t * 255.0 + 0.5));
  return vec4<f32>(cmap[idx].rgb, 1.0);
}
