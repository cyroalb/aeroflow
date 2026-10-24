// Field rendering (mirrors render.wgsl / CpuBackend.render). Drawn to the default framebuffer;
// gl_FragCoord.y = 0 is the bottom row, which is y = 0 of the simulation (no flip needed).
// The backend prepends "#version 300 es".
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uMac;   // RGBA32F: rho, ux, uy
uniform sampler2D uSolid; // R8
uniform sampler2D uCmap;  // RGBA8 256x1
uniform ivec2 uSize;
uniform vec2 uRange;
uniform int uField;       // 0 vorticity, 1 speed, 2 pressure

out vec4 o;

bool isSolid(ivec2 p) { return texelFetch(uSolid, p, 0).r > 0.5; }

vec2 vel(ivec2 p) {
  if (isSolid(p)) return vec2(0.0);
  return texelFetch(uMac, p, 0).yz;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (isSolid(p)) { o = vec4(154.0 / 255.0, 164.0 / 255.0, 178.0 / 255.0, 1.0); return; }
  vec4 m = texelFetch(uMac, p, 0);
  float v;
  if (uField == 2) {
    v = (m.x - 1.0) / 3.0;
  } else if (uField == 1) {
    v = length(m.yz);
  } else {
    int xl = max(p.x - 1, 0), xr = min(p.x + 1, uSize.x - 1);
    int yl = max(p.y - 1, 0), yr = min(p.y + 1, uSize.y - 1);
    v = (vel(ivec2(xr, p.y)).y - vel(ivec2(xl, p.y)).y) / float(xr - xl)
      - (vel(ivec2(p.x, yr)).x - vel(ivec2(p.x, yl)).x) / float(yr - yl);
  }
  float t = clamp((v - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
  int idx = int(floor(t * 255.0 + 0.5));
  o = vec4(texelFetch(uCmap, ivec2(idx, 0), 0).rgb, 1.0);
}
