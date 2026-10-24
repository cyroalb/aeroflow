// Momentum exchange per wall link (port of `force` in lbm.wgsl): one fragment per link k,
// k = y * linkW + x. Link texel = (fluid cell index, ib) with ib pointing into the solid.
// Output (c_ib.x * m, c_ib.y * m), m = f*_ib(x_f) + f_OPP(ib)(x_f); inlet column excluded.
// The backend prepends "#version 300 es".
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uF0, uF1, uF2; // f after streaming + outlet
uniform sampler2D uS0, uS1, uS2; // fs = post-collision f*
uniform sampler2D uLinks;        // RG32F
uniform ivec2 uSize;             // (W, H)
uniform int uLinkW;
uniform int uNLinks;

layout(location = 0) out vec4 oForce;

const int CX[9] = int[9](0, 1, 0, -1, 0, 1, -1, -1, 1);
const int CY[9] = int[9](0, 0, 1, 0, -1, 1, 1, -1, -1);
const int OPP[9] = int[9](0, 3, 4, 1, 2, 7, 8, 5, 6);

float fAt(int i, ivec2 p) {
  if (i < 4) return texelFetch(uF0, p, 0)[i];
  if (i < 8) return texelFetch(uF1, p, 0)[i - 4];
  return texelFetch(uF2, p, 0).r;
}

float fsAt(int i, ivec2 p) {
  if (i < 4) return texelFetch(uS0, p, 0)[i];
  if (i < 8) return texelFetch(uS1, p, 0)[i - 4];
  return texelFetch(uS2, p, 0).r;
}

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  int k = t.y * uLinkW + t.x;
  oForce = vec4(0.0);
  if (k >= uNLinks) return;
  vec2 l = texelFetch(uLinks, t, 0).xy;
  int c = int(l.x + 0.5);
  int ib = int(l.y + 0.5);
  int x = c % uSize.x;
  int y = c / uSize.x;
  if (x == 0) return;
  ivec2 p = ivec2(x, y);
  float m = fsAt(ib, p) + fAt(OPP[ib], p);
  oForce = vec4(float(CX[ib]) * m, float(CY[ib]) * m, 0.0, 0.0);
}
