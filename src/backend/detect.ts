import type { SimBackend } from './types';
import { WebGpuBackend } from './webgpu/backend';
import { WebGL2Backend } from './webgl2/backend';

/** WebGPU (adapter + device) first, then WebGL2 with float render targets; null if neither. Never throws. */
export async function detectBackend(canvas: HTMLCanvasElement): Promise<SimBackend | null> {
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter) {
      const probe = await adapter.requestDevice();
      probe.destroy();
      return new WebGpuBackend();
    }
  } catch {
    /* fall through to WebGL2 */
  }
  return detectWebGL2(canvas);
}

/** WebGL2 with float render targets on `canvas`, or null. Never throws. */
export function detectWebGL2(canvas: HTMLCanvasElement): SimBackend | null {
  try {
    // Probe on a throwaway canvas so the display canvas gets the backend's own context attributes.
    const gl = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null;
    const ok = WebGL2Backend.isSupported(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    if (ok) return new WebGL2Backend(canvas);
  } catch {
    /* unsupported */
  }
  return null;
}
