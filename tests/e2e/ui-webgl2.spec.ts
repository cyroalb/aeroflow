import { test, expect } from '@playwright/test';

// Runs in the "no-webgpu" Playwright project (Chromium launched with --disable-features=WebGPU).
// Recent Chromium builds ship WebGPU enabled regardless of that flag, so navigator.gpu is also removed.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (Navigator.prototype as unknown as { gpu?: unknown }).gpu;
  });
});

test('WebGPU disabled: the app falls back to WebGL2 and disables Alta', async ({ page }) => {
  await page.goto('/?preset=baixa');
  await page.waitForFunction(
    () => (window as unknown as { __aeroflow?: { getState(): unknown } }).__aeroflow?.getState() !== undefined,
    null,
    { timeout: 60_000 },
  );
  const backend = await page.evaluate(() => (window as unknown as { __aeroflow: { backend: string } }).__aeroflow.backend);
  expect(backend).toBe('webgl2');
  const alta = page.locator('#quality option[value="alta"]');
  await expect(alta).toBeDisabled();
  await expect(alta).toHaveAttribute('title', 'Disponível apenas com WebGPU');
});
