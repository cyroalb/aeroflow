import { test, expect } from '@playwright/test';

test('WebGPU backend matches the CPU reference (square, Baixa, Re=100, setGeometry α=10°)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/tests/parity.html?backend=webgpu');

  const gpu = await page.evaluate(async () => {
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    if (!nav.gpu) return 'navigator.gpu is undefined';
    try {
      const adapter = await nav.gpu.requestAdapter();
      return adapter ? 'ok' : 'navigator.gpu.requestAdapter() returned null';
    } catch (e) {
      return `requestAdapter() threw: ${String(e)}`;
    }
  });
  test.skip(gpu !== 'ok', `WebGPU unavailable in this runner (${gpu}); run with --headed on a WebGPU machine`);

  await page.waitForFunction(() => (window as unknown as { parityResult?: unknown }).parityResult !== undefined, null, {
    timeout: 100_000,
  });
  const r = await page.evaluate(
    () =>
      (window as unknown as { parityResult: { maxAbsDiffU: number; forceRelDiff: number; error?: string } })
        .parityResult,
  );
  console.log('parityResult', JSON.stringify(r));
  expect(r.error).toBeUndefined();
  expect(r.maxAbsDiffU).toBeLessThan(1e-4);
  expect(r.forceRelDiff).toBeLessThan(1e-3);
});
