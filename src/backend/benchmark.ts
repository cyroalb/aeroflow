import { PRESETS, type PresetId } from '../config';
import { toLattice } from '../physics/units';
import { makeShape } from '../geometry/shapes';
import { rasterize, objectCenter } from '../geometry/rasterize';
import type { SimBackend } from './types';

/** Highest preset with W·H·1200 ≤ 0.8·lups; never 'alta' on webgl2; at least 'baixa'. */
export function choosePreset(lupsMeasured: number, backendKind: SimBackend['kind']): PresetId {
  const order: PresetId[] = backendKind === 'webgpu' ? ['alta', 'media'] : ['media'];
  for (const id of order) {
    if (PRESETS[id].W * PRESETS[id].H * 1200 <= 0.8 * lupsMeasured) return id;
  }
  return 'baixa';
}

/**
 * Measures cell-updates per second on the Média grid (cylinder, L=0.01 m, U=0.15 m/s),
 * using readForce as the GPU sync point. The backend is left in an arbitrary running
 * state: the caller must re-init it with the chosen preset.
 */
export async function measureLups(backend: SimBackend, ms = 1500): Promise<number> {
  const { W, H } = PRESETS.media;
  const lat = toLattice({ U: 0.15, L: 0.01, alphaDeg: 0, kind: 'cylinder' }, 'media');
  const { cx, cy } = objectCenter('cylinder', 'media');
  const geom = rasterize(makeShape('cylinder', lat.Lcells, 0), W, H, cx, cy);
  await backend.init(geom, lat.tau0, lat.uLb);
  backend.initUniform(lat.uLb, 0);
  backend.step(5); // warm-up, not counted
  await backend.readForce();
  const n = 10;
  let steps = 0;
  const t0 = performance.now();
  let t = t0;
  while (t - t0 < ms) {
    backend.step(n);
    await backend.readForce();
    steps += n;
    t = performance.now();
  }
  return (W * H * steps) / ((t - t0) / 1000);
}
