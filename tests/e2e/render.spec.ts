import { test, expect } from '@playwright/test';

interface RenderResult {
  backend: string;
  redPct: number;
  bluePct: number;
  centreRGB: number[];
  error?: string;
}

const OUT = 'D:/Dropbox/codes/aeroflow/.superpowers/sdd/2026-10-23-aeroflow-v1';

for (const backend of ['webgpu', 'webgl2'] as const) {
  test(`${backend}: vorticity render of the Re=100 cylinder has red/blue wake and grey body`, async ({ page }) => {
    test.setTimeout(120_000);
    if (backend === 'webgpu') {
      await page.goto('/tests/parity.html?backend=webgpu&render=1');
      const gpu = await page.evaluate(async () => {
        const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
        if (!nav.gpu) return 'navigator.gpu is undefined';
        try {
          return (await nav.gpu.requestAdapter()) ? 'ok' : 'requestAdapter() returned null';
        } catch (e) {
          return `requestAdapter() threw: ${String(e)}`;
        }
      });
      test.skip(gpu !== 'ok', `WebGPU unavailable in this runner (${gpu})`);
    } else {
      await page.goto('/tests/parity.html?backend=webgl2&render=1');
    }
    await page.waitForFunction(() => (window as unknown as { renderResult?: unknown }).renderResult !== undefined, null, {
      timeout: 100_000,
    });
    const r = await page.evaluate(() => (window as unknown as { renderResult: RenderResult }).renderResult);
    expect(r.error).toBeUndefined();
    await page.locator('#field').screenshot({ path: `${OUT}/render-${backend}.png` });
    console.log(`render ${backend}`, JSON.stringify(r));
    expect(r.redPct).toBeGreaterThanOrEqual(5);
    expect(r.bluePct).toBeGreaterThanOrEqual(5);
    const [R, G, B] = r.centreRGB;
    expect(Math.abs(R - 0x9a)).toBeLessThanOrEqual(6);
    expect(Math.abs(G - 0xa4)).toBeLessThanOrEqual(6);
    expect(Math.abs(B - 0xb2)).toBeLessThanOrEqual(6);
  });
}
