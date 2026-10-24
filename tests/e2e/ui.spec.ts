import { test, expect, type Page } from '@playwright/test';

const WARNING = '⚠ Re alto: modelo de turbulência, valores aproximados';
const NOTE_2D =
  'Esta simulação é 2D. Acima de Re ≈ 190, o escoamento real ao redor de um cilindro é tridimensional; os valores aqui não capturam esses efeitos.';
const QUALITY_HINT = 'Afeta a precisão de Cd, Cl e St, não só a imagem.';
const UNSUPPORTED =
  'Seu navegador não suporta WebGPU nem WebGL2 com texturas float. Use uma versão recente do Chrome, Edge ou Firefox.';

interface AeroWindow {
  __aeroflow?: {
    getState(): { re: number; fidelityWarning: boolean };
    backend: string;
    controller: { grid: { W: number; H: number } };
  };
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as AeroWindow).__aeroflow?.getState() !== undefined, null, {
    timeout: 60_000,
  });
}

test('default state: Re ≈ 100 and overlay shows Re 1,0×10²', async ({ page }) => {
  await page.goto('/?preset=baixa');
  await ready(page);
  const re = await page.evaluate(() => (window as unknown as AeroWindow).__aeroflow!.getState().re);
  expect(re).toBeCloseTo(100, 6);
  await expect(page.locator('#overlay')).toContainText('Re 1,0×10²');
  await expect(page.locator('#warning')).toBeHidden();
});

test('NACA 0012 at U = 30 m/s, L = 1 m shows the fidelity warning', async ({ page }) => {
  await page.goto('/?preset=baixa');
  await ready(page);
  await page.getByLabel('NACA 0012').check();
  await expect(page.locator('#size-label')).toHaveText('Corda (m)');
  await page.locator('#u-num').fill('30');
  await page.locator('#u-num').press('Enter');
  await page.locator('#l-num').fill('1');
  await page.locator('#l-num').press('Enter');
  await expect(page.locator('#warning')).toBeVisible();
  await expect(page.locator('#warning')).toHaveText(WARNING);
  await expect(page.locator('#overlay')).toContainText('Re 2,0×10⁶');
});

test('375 px: no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/?preset=baixa');
  await ready(page);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw).toBeLessThanOrEqual(375);
});

test('1920 px: canvas keeps the grid aspect ratio', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?preset=baixa');
  await ready(page);
  const r = await page.evaluate(() => {
    const c = document.querySelector('#sim') as HTMLCanvasElement;
    const b = c.getBoundingClientRect();
    const g = (window as unknown as AeroWindow).__aeroflow!.controller.grid;
    return { w: b.width, h: b.height, W: g.W, H: g.H, cw: c.width, ch: c.height };
  });
  expect(r.cw).toBe(r.W);
  expect(r.ch).toBe(r.H);
  expect(Math.abs(r.w / r.h - r.W / r.H) / (r.W / r.H)).toBeLessThan(0.01);
});

test('quality hint: precision of Cd, Cl and St, visible and as the select title', async ({ page }) => {
  await page.goto('/?preset=baixa');
  await ready(page);
  await expect(page.locator('#quality-hint')).toBeVisible();
  await expect(page.locator('#quality-hint')).toHaveText(QUALITY_HINT);
  await expect(page.locator('#quality')).toHaveAttribute('title', QUALITY_HINT);
});

test('ⓘ toggles the 2D note', async ({ page }) => {
  await page.goto('/?preset=baixa');
  await ready(page);
  await expect(page.locator('#note-2d')).toBeHidden();
  await page.locator('#note-toggle').click();
  await expect(page.locator('#note-2d')).toBeVisible();
  await expect(page.locator('#note-2d')).toHaveText(NOTE_2D);
  await page.locator('#note-toggle').click();
  await expect(page.locator('#note-2d')).toBeHidden();
});

test('no WebGPU and no WebGL2: unsupported message', async ({ page }) => {
  await page.addInitScript(() => {
    delete (Navigator.prototype as unknown as { gpu?: unknown }).gpu;
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/');
  await expect(page.locator('#unsupported')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#unsupported')).toHaveText(UNSUPPORTED);
});
