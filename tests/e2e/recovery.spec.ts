import { test, expect, type Page } from '@playwright/test';

const BACKEND_FAILURE =
  'Não foi possível iniciar a simulação na GPU deste navegador. Tente recarregar a página ou usar uma versão recente do Chrome, Edge ou Firefox.';

interface RecoverResult {
  lostForceFinite?: boolean;
  lostInitError?: string;
  maxAbsDiffU: number;
  forceRelDiff: number;
  error?: string;
}

async function webgpuStatus(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    if (!nav.gpu) return 'navigator.gpu is undefined';
    try {
      return (await nav.gpu.requestAdapter()) ? 'ok' : 'requestAdapter() returned null';
    } catch (e) {
      return `requestAdapter() threw: ${String(e)}`;
    }
  });
}

async function recoverResult(page: Page): Promise<RecoverResult> {
  await page.waitForFunction(() => (window as unknown as { recoverResult?: unknown }).recoverResult !== undefined, null, {
    timeout: 100_000,
  });
  return page.evaluate(() => (window as unknown as { recoverResult: RecoverResult }).recoverResult);
}

test('WebGPU device loss: the next init() requests a new device and matches the CPU again', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/tests/parity.html?backend=webgpu&recover=1');
  const gpu = await webgpuStatus(page);
  test.skip(gpu !== 'ok', `WebGPU unavailable in this runner (${gpu})`);
  const r = await recoverResult(page);
  expect(r.error).toBeUndefined();
  expect(r.maxAbsDiffU).toBeLessThan(1e-4);
  expect(r.forceRelDiff).toBeLessThan(1e-3);
});

test('WebGL2 context loss: fails cleanly while lost, rebuilds after webglcontextrestored', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/tests/parity.html?backend=webgl2&recover=1');
  const r = await recoverResult(page);
  expect(r.error).toBeUndefined();
  expect(r.lostForceFinite).toBe(false);
  expect(r.lostInitError).toContain('context lost');
  expect(r.lostInitError).not.toContain('EXT_color_buffer_float');
  expect(r.maxAbsDiffU).toBeLessThan(1e-4);
  expect(r.forceRelDiff).toBeLessThan(1e-3);
});

/** Makes WebGPU detectable but unable to build its pipelines (init() rejects). */
function breakWebGpuInit(): void {
  const D = (globalThis as unknown as { GPUDevice?: { prototype: Record<string, unknown> } }).GPUDevice;
  if (D) D.prototype.createComputePipelineAsync = () => Promise.reject(new Error('stub: pipeline creation fails'));
}

test('WebGPU that fails to initialise: the app falls back to WebGL2', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(breakWebGpuInit);
  await page.goto('/?preset=baixa');
  await page.waitForFunction(
    () => (window as unknown as { __aeroflow?: { getState(): unknown } }).__aeroflow?.getState() !== undefined,
    null,
    { timeout: 60_000 },
  );
  const backend = await page.evaluate(() => (window as unknown as { __aeroflow: { backend: string } }).__aeroflow.backend);
  expect(backend).toBe('webgl2');
  await expect(page.locator('#engine')).toHaveText('WebGL2');
  await expect(page.locator('#status')).toBeHidden();
});

test('no backend can initialise: "Iniciando…" is replaced by the backend-failure message', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(breakWebGpuInit);
  await page.addInitScript(() => {
    // detection probes on throwaway canvases still succeed; the display canvas refuses WebGL2
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2' && this.id === 'sim') return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/?preset=baixa');
  await expect(page.locator('#status')).toHaveText(BACKEND_FAILURE, { timeout: 60_000 });
  await expect(page.locator('#status')).toBeVisible();
  await expect(page.locator('#unsupported')).toHaveCount(0);
});
