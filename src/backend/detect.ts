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
  try {
    if (WebGL2Backend.isSupported(canvas.getContext('webgl2') as WebGL2RenderingContext | null)) {
      return new WebGL2Backend(canvas);
    }
  } catch {
    /* unsupported */
  }
  return null;
}
