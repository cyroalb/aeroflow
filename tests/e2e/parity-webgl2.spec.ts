import { test, expect } from '@playwright/test';

test('WebGL2 backend matches the CPU reference (square, Baixa, Re=100, setGeometry α=10°)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/tests/parity.html?backend=webgl2');

  const gl = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('webgl2');
    if (!ctx) return { ok: false, renderer: 'no WebGL2 context' };
    const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER));
    return { ok: ctx.getExtension('EXT_color_buffer_float') !== null, renderer };
  });
  console.log('WebGL2 renderer', gl.renderer);
  expect(gl.ok, `WebGL2 + EXT_color_buffer_float required (${gl.renderer})`).toBe(true);

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
