// D2Q9 Lattice Boltzmann, WebGL2 (GLSL ES 3.00) port of src/physics/lbm-cpu.ts, mirroring
// src/backend/webgpu/lbm.wgsl pass by pass. One fragment = one cell (gl_FragCoord = (x, y)).
// The backend prepends "#version 300 es" and "#define PASS <n>":
//   1 collide  f  -> fs   (regularized BGK + Smagorinsky; solids copied unchanged)
//   2 stream   fs -> f'   (pull + inlet + free slip + Bouzidi; outlet column fixed by outlet.frag)
//   3 macro    f  -> mac  (rho, ux, uy)
//   4 util     f, mac -> f', mac'  (mode 0 initUniform, 1 kick, 2 geometry change)
// Populations: 3 RGBA32F textures per set: tex0 = f0..f3, tex1 = f4..f7, tex2.r = f8.
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uF0, uF1, uF2; // f (input set)
uniform sampler2D uS0, uS1, uS2; // fs = post-collision f*
uniform sampler2D uQ0, uQ1, uQ2; // Bouzidi q, same packing as f
uniform sampler2D uSolid;        // R8: 1 = solid
uniform sampler2D uMac;          // RGBA32F: (rho, ux, uy, 0)
uniform sampler2D uChanged;      // R8: 1 = solid flag changed (util mode 2)
uniform ivec2 uSize;             // (W, H)
uniform float uTau0;
uniform float uSmagK;
uniform vec2 uIn;                // inlet velocity
uniform int uMode;               // util mode
uniform ivec4 uRect;             // kick rect x0, y0, x1, y1 (inclusive)
uniform vec2 uAB;                // util parameters a, b

// Order: 0 rest, 1 E, 2 N, 3 W, 4 S, 5 NE, 6 NW, 7 SW, 8 SE
const int CX[9] = int[9](0, 1, 0, -1, 0, 1, -1, -1, 1);
const int CY[9] = int[9](0, 0, 1, 0, -1, 1, 1, -1, -1);
const float WT[9] = float[9](4.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0,
                             1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0);
const int OPP[9] = int[9](0, 3, 4, 1, 2, 7, 8, 5, 6);
const int MIR[9] = int[9](0, 1, 4, 3, 2, 8, 7, 6, 5);

#if PASS == 3
layout(location = 0) out vec4 oMac;
#else
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
#endif
#if PASS == 4
layout(location = 3) out vec4 oMac;
#endif

float feq(int i, float rho, float ux, float uy) {
  float cu = float(CX[i]) * ux + float(CY[i]) * uy;
  return WT[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * (ux * ux + uy * uy));
}

bool isSolid(ivec2 p) {
  return texelFetch(uSolid, p, 0).r > 0.5;
}

void loadF(ivec2 p, out float v[9]) {
  vec4 a = texelFetch(uF0, p, 0);
  vec4 b = texelFetch(uF1, p, 0);
  float c = texelFetch(uF2, p, 0).r;
  v[0] = a.x; v[1] = a.y; v[2] = a.z; v[3] = a.w;
  v[4] = b.x; v[5] = b.y; v[6] = b.z; v[7] = b.w;
  v[8] = c;
}

void loadS(ivec2 p, out float v[9]) {
  vec4 a = texelFetch(uS0, p, 0);
  vec4 b = texelFetch(uS1, p, 0);
  float c = texelFetch(uS2, p, 0).r;
  v[0] = a.x; v[1] = a.y; v[2] = a.z; v[3] = a.w;
  v[4] = b.x; v[5] = b.y; v[6] = b.z; v[7] = b.w;
  v[8] = c;
}

float fsAt(int i, ivec2 p) {
  if (i < 4) return texelFetch(uS0, p, 0)[i];
  if (i < 8) return texelFetch(uS1, p, 0)[i - 4];
  return texelFetch(uS2, p, 0).r;
}

float qAt(int i, ivec2 p) {
  if (i < 4) return texelFetch(uQ0, p, 0)[i];
  if (i < 8) return texelFetch(uQ1, p, 0)[i - 4];
  return texelFetch(uQ2, p, 0).r;
}

#if PASS != 3
void storeF(float v[9]) {
  o0 = vec4(v[0], v[1], v[2], v[3]);
  o1 = vec4(v[4], v[5], v[6], v[7]);
  o2 = vec4(v[8], 0.0, 0.0, 0.0);
}

void storeEq(float rho, float ux, float uy) {
  float v[9];
  for (int i = 0; i < 9; i++) v[i] = feq(i, rho, ux, uy);
  storeF(v);
}
#endif

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int Wd = uSize.x;
  int H = uSize.y;

#if PASS == 1
  // ---- collision: regularized BGK + Smagorinsky ----
  float fl[9];
  loadF(p, fl);
  if (isSolid(p)) {
    storeF(fl);
    return;
  }
  float rho = fl[0] + fl[1] + fl[2] + fl[3] + fl[4] + fl[5] + fl[6] + fl[7] + fl[8];
  float ux = (fl[1] - fl[3] + fl[5] - fl[6] - fl[7] + fl[8]) / rho;
  float uy = (fl[2] - fl[4] + fl[5] + fl[6] - fl[7] - fl[8]) / rho;
  float usq = 1.5 * (ux * ux + uy * uy);
  float pxx = 0.0;
  float pxy = 0.0;
  float pyy = 0.0;
  for (int i = 0; i < 9; i++) {
    float cx = float(CX[i]);
    float cy = float(CY[i]);
    float cu = cx * ux + cy * uy;
    float fq = WT[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - usq);
    float fnq = fl[i] - fq;
    pxx += cx * cx * fnq;
    pxy += cx * cy * fnq;
    pyy += cy * cy * fnq;
  }
  float pmag = sqrt(pxx * pxx + pyy * pyy + 2.0 * pxy * pxy);
  float tau = 0.5 * (uTau0 + sqrt(uTau0 * uTau0 + (uSmagK * pmag) / rho));
  float omega = 1.0 - 1.0 / tau;
  float o[9];
  for (int i = 0; i < 9; i++) {
    float cx = float(CX[i]);
    float cy = float(CY[i]);
    float cu = cx * ux + cy * uy;
    float fq = WT[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - usq);
    float qxx = cx * cx - 1.0 / 3.0;
    float qyy = cy * cy - 1.0 / 3.0;
    float qxy = cx * cy;
    float fneq = 4.5 * WT[i] * (qxx * pxx + 2.0 * qxy * pxy + qyy * pyy);
    o[i] = fq + omega * fneq;
  }
  storeF(o);

#elif PASS == 2
  // ---- pull streaming with boundaries, fs -> f ----
  // Wall links (source x - c_i solid and inside the grid) use Bouzidi with ib = OPP[i],
  // q = q_ib(x); the inlet column is handled first, so its links never reach Bouzidi.
  if (isSolid(p)) {
    storeEq(1.0, 0.0, 0.0);
    return;
  }
  int x = p.x;
  int y = p.y;
  if (x == 0) {
    // inlet: density of (1, y) from the previous step's macroscopic values
    float r = texelFetch(uMac, ivec2(1, y), 0).r;
    storeEq(r, uIn.x, uIn.y);
    return;
  }
  float fc[9];
  loadS(p, fc); // f*(x)
  float o[9];
  o[0] = fc[0];
  for (int i = 1; i < 9; i++) {
    int sy = y - CY[i];
    int sxr = x - CX[i];
    int sx = clamp(sxr, 0, Wd - 1); // only clamps at x = W-1 (outlet)
    float v;
    if (sy < 0 || sy >= H) {
      // free slip: mirrored population from the same row (mirror source solid: bounce-back)
      ivec2 s = ivec2(sx, y);
      if (isSolid(s)) { v = fc[OPP[i]]; } else { v = fsAt(MIR[i], s); }
    } else {
      ivec2 s = ivec2(sx, sy);
      if (isSolid(s)) {
        int ib = OPP[i];
        float fb = fc[ib]; // f*_ib(x_f)
        if (sx == sxr) {
          // Bouzidi interpolated bounce-back on the wall link (x, ib)
          float q = qAt(ib, p);
          if (q < 0.5) {
            int nx = x + CX[i];
            int ny = y + CY[i];
            if (nx < 0 || nx >= Wd || ny < 0 || ny >= H || isSolid(ivec2(nx, ny))) {
              v = fb;
            } else {
              v = 2.0 * q * fb + (1.0 - 2.0 * q) * fsAt(ib, ivec2(nx, ny));
            }
          } else {
            v = fb / (2.0 * q) + ((2.0 * q - 1.0) / (2.0 * q)) * fc[i];
          }
        } else {
          v = fb; // clamped outlet source: halfway bounce-back (overwritten by the outlet)
        }
      } else {
        v = fsAt(i, s);
      }
    }
    o[i] = v;
  }
  storeF(o);

#elif PASS == 3
  // ---- macroscopic fields from the new f ----
  if (isSolid(p)) {
    oMac = vec4(1.0, 0.0, 0.0, 0.0);
    return;
  }
  float fl[9];
  loadF(p, fl);
  float rho = fl[0] + fl[1] + fl[2] + fl[3] + fl[4] + fl[5] + fl[6] + fl[7] + fl[8];
  oMac = vec4(rho, (fl[1] - fl[3] + fl[5] - fl[6] - fl[7] + fl[8]) / rho,
              (fl[2] - fl[4] + fl[5] + fl[6] - fl[7] - fl[8]) / rho, 0.0);

#elif PASS == 4
  // ---- utilities: mode 0 initUniform(a, b) ; 1 kick (rect, dvy = a) ; 2 geometry change ----
  vec4 m = texelFetch(uMac, p, 0);
  bool solid = isSolid(p);
  bool eq = false;
  vec3 e = vec3(1.0, 0.0, 0.0);
  if (uMode == 0) {
    eq = true;
    if (!solid) e = vec3(1.0, uAB.x, uAB.y);
  } else if (uMode == 1) {
    if (p.x >= uRect.x && p.x <= uRect.z && p.y >= uRect.y && p.y <= uRect.w && !solid) {
      eq = true;
      e = vec3(m.x, m.y, m.z + uAB.x);
    }
  } else {
    eq = texelFetch(uChanged, p, 0).r > 0.5;
  }
  if (eq) {
    storeEq(e.x, e.y, e.z);
    oMac = vec4(e, 0.0);
  } else {
    float fl[9];
    loadF(p, fl);
    storeF(fl);
    oMac = m;
  }
#endif
}
