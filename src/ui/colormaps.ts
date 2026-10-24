/**
 * Colormaps and colour ranges for field rendering.
 *
 * Pressure convention (ONE, used by every backend): the shader computes the lattice pressure
 * p' = (rho - 1) / 3 (cs^2 = 1/3) and the colour range handed to `render` is expressed in the SAME
 * units. Cp = p' / (0.5 uLb^2), and Cp in [-3, 1] therefore corresponds to
 * p' in [-3 * 0.5 uLb^2, 1 * 0.5 uLb^2], which is what `fieldScale('pressure', ...)` returns.
 * `cpToLattice(cp, uLb)` converts a Cp value into those units.
 *
 * Vorticity is the central difference d(uy)/dx - d(ux)/dy (lattice units), speed is |u|.
 */
export type FieldName = 'vorticity' | 'speed' | 'pressure';
export type RGB = readonly [number, number, number];

/** Solid cells are drawn #9aa4b2. */
export const SOLID_RGB: RGB = [0x9a, 0xa4, 0xb2];

function lerp3(a: RGB, b: RGB, t: number): [number, number, number] {
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t)) as [number, number, number];
}

function build(stops: { at: number; c: RGB }[]): RGB[] {
  const out: RGB[] = [];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1].at) k++;
    const a = stops[k], b = stops[k + 1];
    out.push(lerp3(a.c, b.c, Math.min(1, Math.max(0, (t - a.at) / (b.at - a.at)))));
  }
  return out;
}

/** Blue (low) -> near-black (centre) -> red (high). */
export const DIVERGING: readonly RGB[] = (() => {
  const blue: RGB = [40, 120, 255], dark: RGB = [8, 8, 12], red: RGB = [255, 60, 40];
  const out: RGB[] = [];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const s = Math.abs(2 * t - 1); // symmetric about the centre, so entries 127 and 128 are the darkest
    out.push(lerp3(dark, t < 0.5 ? blue : red, s));
  }
  return out;
})();

/** Dark -> light (monotonic luminance), used for speed. */
export const SEQUENTIAL: readonly RGB[] = build([
  { at: 0, c: [6, 6, 24] },
  { at: 0.3, c: [50, 40, 130] },
  { at: 0.55, c: [150, 70, 150] },
  { at: 0.8, c: [240, 150, 90] },
  { at: 1, c: [255, 250, 215] },
]);

export function colormapFor(field: FieldName): readonly RGB[] {
  return field === 'speed' ? SEQUENTIAL : DIVERGING;
}

/** Flat RGBA8 (256 x 1) for texture upload. */
export function colormapRGBA8(map: readonly RGB[]): Uint8Array {
  const out = new Uint8Array(256 * 4);
  map.forEach((c, i) => out.set([c[0], c[1], c[2], 255], 4 * i));
  return out;
}

/** Flat RGBA float (0..1), 256 entries, for storage-buffer upload. */
export function colormapRGBAF32(map: readonly RGB[]): Float32Array {
  const out = new Float32Array(256 * 4);
  map.forEach((c, i) => out.set([c[0] / 255, c[1] / 255, c[2] / 255, 1], 4 * i));
  return out;
}

/** Colour range [min, max] of a field (pressure: in (rho-1)/3 units, see the header). */
export function fieldScale(field: FieldName, uLb: number, Lcells: number): [number, number] {
  switch (field) {
    case 'vorticity':
      return [(-4 * uLb) / Lcells, (4 * uLb) / Lcells];
    case 'speed':
      return [0, 1.6 * uLb];
    case 'pressure':
      return [-3 * 0.5 * uLb * uLb, 1 * 0.5 * uLb * uLb];
  }
}

/** Cp -> lattice pressure (rho-1)/3. */
export function cpToLattice(cp: number, uLb: number): number {
  return cp * 0.5 * uLb * uLb;
}

/** Colormap index (0..255) of a value in the given range, clamped. Mirrors the shaders. */
export function colorIndex(v: number, range: readonly [number, number]): number {
  const t = (v - range[0]) / (range[1] - range[0]);
  return Math.floor(Math.min(1, Math.max(0, t)) * 255 + 0.5);
}
