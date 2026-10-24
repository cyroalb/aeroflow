// Outlet pass (port of `outlet` in lbm.wgsl): copies the streamed set f' -> f and, on column
// W-1, imposes fixed pressure (rho = 1) by non-equilibrium extrapolation from W-2. Skipped
// where W-1 or W-2 is solid. A full-grid copy because WebGL2 cannot read and write one texture.
// The backend prepends "#version 300 es".
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uF0, uF1, uF2; // streamed populations
uniform sampler2D uSolid;
uniform ivec2 uSize;

layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;

const int CX[9] = int[9](0, 1, 0, -1, 0, 1, -1, -1, 1);
const int CY[9] = int[9](0, 0, 1, 0, -1, 1, 1, -1, -1);
const float WT[9] = float[9](4.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0,
                             1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0);

float feq(int i, float rho, float ux, float uy) {
  float cu = float(CX[i]) * ux + float(CY[i]) * uy;
  return WT[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * (ux * ux + uy * uy));
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uF0, p, 0);
  vec4 b = texelFetch(uF1, p, 0);
  vec4 c = texelFetch(uF2, p, 0);
  ivec2 s = ivec2(p.x - 1, p.y);
  if (p.x != uSize.x - 1 || texelFetch(uSolid, p, 0).r > 0.5 || texelFetch(uSolid, s, 0).r > 0.5) {
    o0 = a;
    o1 = b;
    o2 = c;
    return;
  }
  vec4 sa = texelFetch(uF0, s, 0);
  vec4 sb = texelFetch(uF1, s, 0);
  float g[9];
  g[0] = sa.x; g[1] = sa.y; g[2] = sa.z; g[3] = sa.w;
  g[4] = sb.x; g[5] = sb.y; g[6] = sb.z; g[7] = sb.w;
  g[8] = texelFetch(uF2, s, 0).r;
  float r = g[0] + g[1] + g[2] + g[3] + g[4] + g[5] + g[6] + g[7] + g[8];
  float vx = (g[1] - g[3] + g[5] - g[6] - g[7] + g[8]) / r;
  float vy = (g[2] - g[4] + g[5] + g[6] - g[7] - g[8]) / r;
  float o[9];
  for (int i = 0; i < 9; i++) o[i] = feq(i, 1.0, vx, vy) + (g[i] - feq(i, r, vx, vy));
  o0 = vec4(o[0], o[1], o[2], o[3]);
  o1 = vec4(o[4], o[5], o[6], o[7]);
  o2 = vec4(o[8], 0.0, 0.0, 0.0);
}
