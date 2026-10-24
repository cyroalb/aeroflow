import { test, expect, type Page } from '@playwright/test';

interface W {
  __aeroflow?: {
    getState(): { steady: boolean };
    controller: { setParams(p: object): void };
    timeChart: { size(): number };
    sweep: { points(k: string): [number, number][] };
  };
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as W).__aeroflow?.getState() !== undefined, null, { timeout: 60_000 });
}

test('time chart renders a canvas and its data grows', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?preset=baixa');
  await ready(page);
  await expect(page.locator('#chart-time canvas').first()).toBeVisible();
  await expect(page.locator('#chart-sweep canvas').first()).toBeVisible();
  await expect(page.locator('#chart-sweep')).toContainText('Cd × Re');
  const n0 = await page.evaluate(() => (window as unknown as W).__aeroflow!.timeChart.size());
  await page.waitForTimeout(2500);
  const n1 = await page.evaluate(() => (window as unknown as W).__aeroflow!.timeChart.size());
  expect(n1).toBeGreaterThan(n0);
  expect(errors).toEqual([]);
});

test('sweep adds a point for a settled low-Re NACA 0012', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?preset=baixa');
  await ready(page);
  // Re = U*L/nu = 0.3*0.01/1.5e-5 = 200
  await page.evaluate(() =>
    (window as unknown as W).__aeroflow!.controller.setParams({ kind: 'naca0012', U: 0.3, L: 0.01, alphaDeg: 4 }),
  );
  await page.waitForFunction(
    () => (window as unknown as W).__aeroflow!.sweep.points('naca0012').length > 0,
    null,
    { timeout: 60_000 },
  );
  await expect(page.locator('#chart-sweep')).toContainText('Cl × α (°)');
});
