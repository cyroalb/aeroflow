import { test, expect, type Page } from '@playwright/test';
import { COPY } from '../../src/config';

// Spec §7 acceptance on the real app, Alta preset (WebGPU). Run with:
//   npm run e2e:acceptance        (GPU_RUNNER=1 also asserts fps ≥ 30)
//   npm run e2e:soak              (10-minute @soak)

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const GPU_RUNNER = env.GPU_RUNNER === '1';

interface Sample { w: number; t: number; cdInst: number; clInst: number }
interface Frame { w: number; st: number | null }
interface Acc {
  t0: number | null;
  keep: boolean;
  samples: Sample[];
  frames: Frame[];
  messages: string[];
  clMin: number;
  clMax: number;
  wakeAt: number | null;
  stAt: number | null;
}
interface AeroWindow {
  __acc: Acc;
  __aeroflow?: {
    getState(): { st: number | null; cd: number; cl: number; fps: number; re: number; message: string | null; step: number };
    controller: {
      setParams(p: object): void;
      onState(cb: (s: { st: number | null; message: string | null; samples: { t: number; cdInst: number; clInst: number }[] }) => void): void;
      preset: string;
    };
    backend: string;
  };
}

/** In-page collector: subscribes to every controller frame as soon as the app exposes itself. */
async function installCollector(page: Page, keep: boolean): Promise<void> {
  await page.addInitScript((keepSamples: boolean) => {
    const acc = {
      t0: null as number | null,
      keep: keepSamples,
      samples: [] as unknown[],
      frames: [] as unknown[],
      messages: [] as string[],
      clMin: Infinity,
      clMax: -Infinity,
      wakeAt: null as number | null,
      stAt: null as number | null,
    };
    (window as unknown as { __acc: typeof acc }).__acc = acc;
    const iv = setInterval(() => {
      const a = (window as unknown as AeroWindow).__aeroflow;
      if (!a) return;
      clearInterval(iv);
      acc.t0 = performance.now();
      a.controller.onState((s) => {
        const w = performance.now() - (acc.t0 as number);
        if (s.message !== null) acc.messages.push(s.message);
        if (!acc.keep) return;
        acc.frames.push({ w, st: s.st });
        if (s.st !== null && acc.stAt === null) acc.stAt = w;
        for (const x of s.samples) {
          acc.samples.push({ w, t: x.t, cdInst: x.cdInst, clInst: x.clInst });
          acc.clMin = Math.min(acc.clMin, x.clInst);
          acc.clMax = Math.max(acc.clMax, x.clInst);
        }
        if (acc.wakeAt === null && acc.clMax - acc.clMin > 0.1) acc.wakeAt = w;
      });
    }, 10);
  }, keep);
}

async function start(page: Page, keep = true): Promise<void> {
  await installCollector(page, keep);
  await page.goto('/?preset=alta');
  await page.waitForFunction(() => (window as unknown as AeroWindow).__acc.t0 !== null, null, { timeout: 60_000 });
  const info = await page.evaluate(() => {
    const a = (window as unknown as AeroWindow).__aeroflow!;
    return { backend: a.backend, preset: a.controller.preset };
  });
  expect(info).toEqual({ backend: 'webgpu', preset: 'alta' });
}

/** Wall ms since the collector attached. */
const elapsed = (page: Page) => page.evaluate(() => performance.now() - (window as unknown as AeroWindow).__acc.t0!);

async function waitUntil(page: Page, wallMs: number): Promise<void> {
  const left = wallMs - (await elapsed(page));
  if (left > 0) await page.waitForTimeout(left);
}

/** Drops everything collected so far (e.g. right after a parameter change). */
const clearSamples = (page: Page) =>
  page.evaluate(() => {
    const acc = (window as unknown as AeroWindow).__acc;
    acc.samples = [];
    acc.frames = [];
  });

const dump = (page: Page) =>
  page.evaluate(() => {
    const acc = (window as unknown as AeroWindow).__acc;
    return { samples: acc.samples, frames: acc.frames, messages: acc.messages, wakeAt: acc.wakeAt, stAt: acc.stAt };
  });

/** Trapezoidal time average of f over samples[i0..i1]. */
function trapMean(s: Sample[], i0: number, i1: number, f: (x: Sample) => number): number {
  let area = 0;
  for (let i = i0 + 1; i <= i1; i++) area += 0.5 * (f(s[i]!) + f(s[i - 1]!)) * (s[i]!.t - s[i - 1]!.t);
  return area / (s[i1]!.t - s[i0]!.t);
}

/** Cd averaged over the last `periods` full shedding periods (upward zero crossings of Cl − mean Cl). */
function cdOverPeriods(s: Sample[], periods: number): { cd: number; periods: number; span: number; clMean: number } {
  const half = Math.floor(s.length / 2);
  const clMean = trapMean(s, half, s.length - 1, (x) => x.clInst);
  const up: number[] = [];
  for (let i = 1; i < s.length; i++) if (s[i - 1]!.clInst - clMean < 0 && s[i]!.clInst - clMean >= 0) up.push(i);
  expect(up.length, 'upward Cl crossings').toBeGreaterThanOrEqual(periods + 1);
  const i0 = up[up.length - 1 - periods]!;
  const i1 = up[up.length - 1]!;
  return { cd: trapMean(s, i0, i1, (x) => x.cdInst), periods, span: s[i1]!.t - s[i0]!.t, clMean };
}

/** Median fps over the frames of the last `ms` wall milliseconds. */
function medianFps(frames: Frame[], ms: number): number {
  const end = frames[frames.length - 1]!.w;
  const f = frames.filter((x) => x.w >= end - ms);
  const dts = f.slice(1).map((x, i) => x.w - f[i]!.w).sort((a, b) => a - b);
  return 1000 / dts[Math.floor(dts.length / 2)]!;
}

function report(name: string, values: Record<string, unknown>): void {
  test.info().annotations.push({ type: 'measured', description: JSON.stringify(values) });
  console.log(`[acceptance] ${name}: ${JSON.stringify(values)}`);
}

test('default cylinder, Re = 100: wake ≤ 10 s, Cd ∈ [1.2, 1.55], St ∈ [0.14, 0.19], fps ≥ 30', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  expect(await page.evaluate(() => (window as unknown as AeroWindow).__aeroflow!.getState().re)).toBeCloseTo(100, 6);

  // von Kármán wake visible within 10 s of the app running: Cl peak-to-peak > 0.1
  await page.waitForFunction(() => (window as unknown as AeroWindow).__acc.wakeAt !== null, null, { timeout: 12_000 });
  const wakeAt = await page.evaluate(() => (window as unknown as AeroWindow).__acc.wakeAt!);
  expect(wakeAt).toBeLessThanOrEqual(10_000);
  // …and it is a sustained oscillation, not just the start-up kick: at 10 s, Cl still swings > 0.1
  // over the trailing nominal shedding period D/(U·0.2).
  await waitUntil(page, 10_000);
  const trailingP2p = await page.evaluate(() => {
    const s = (window as unknown as AeroWindow).__acc.samples;
    const period = 0.01 / (0.15 * 0.2);
    const tEnd = s[s.length - 1]!.t;
    const cl = s.filter((x) => x.t >= tEnd - period).map((x) => x.clInst);
    return Math.max(...cl) - Math.min(...cl);
  });
  expect(trailingP2p).toBeGreaterThan(0.1);

  await page.waitForFunction(() => (window as unknown as AeroWindow).__acc.stAt !== null, null, { timeout: 30_000 });

  await waitUntil(page, 60_000);
  const d = await dump(page);
  const state = await page.evaluate(() => (window as unknown as AeroWindow).__aeroflow!.getState());
  const avg = cdOverPeriods(d.samples, 10);
  const fps = medianFps(d.frames, 5000);
  report('Re=100', {
    wakeAtMs: Math.round(wakeAt), clP2pAt10s: trailingP2p, stAtMs: Math.round(d.stAt!), cd10: avg.cd, periodsSpanS: avg.span, clMean: avg.clMean,
    st: state.st, stateCd: state.cd, medianFps5s: fps, stateFps: state.fps, steps: state.step, samples: d.samples.length,
  });

  expect(d.messages).toEqual([]);
  expect.soft(avg.cd).toBeGreaterThanOrEqual(1.2);
  // Spec §7: Cd ∈ [1.2, 1.55]. Measured 1.502 (converged, ±0.001) at D = 24 cells with D/H = 1/12
  // blockage; GPU and CPU agree on Média (1.494), so this is the confinement effect, not a solver bug.
  expect.soft(avg.cd).toBeLessThanOrEqual(1.55);
  expect(state.st).not.toBeNull();
  expect.soft(state.st!).toBeGreaterThanOrEqual(0.14);
  expect.soft(state.st!).toBeLessThanOrEqual(0.19);
  if (GPU_RUNNER) {
    expect.soft(fps, "median fps over the last 5 s").toBeGreaterThanOrEqual(30);
  } else {
    test.info().annotations.push({
      type: 'skip',
      description: `fps ≥ 30 not asserted: GPU_RUNNER !== '1' (no hardware GPU assumed); measured median ${fps.toFixed(1)} fps`,
    });
  }
});

test('Re = 40 (U = 0.06 m/s): steady, St null, |mean Cl| < 0.02', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  await page.evaluate(() => (window as unknown as AeroWindow).__aeroflow!.controller.setParams({ U: 0.06 }));
  await clearSamples(page);
  const t0 = await elapsed(page);
  await waitUntil(page, t0 + 60_000);
  const d = await dump(page);
  const state = await page.evaluate(() => (window as unknown as AeroWindow).__aeroflow!.getState());
  const s = d.samples;
  const clMean = trapMean(s, Math.floor(s.length / 2), s.length - 1, (x) => x.clInst);
  report('Re=40', { re: state.re, st: state.st, clMeanLastHalf: clMean, stateCl: state.cl, stateCd: state.cd, samples: s.length });

  expect(state.re).toBeCloseTo(40, 6);
  expect(d.messages).toEqual([]);
  expect(state.st).toBeNull();
  expect(Math.abs(clMean)).toBeLessThan(0.02);
});

test('NACA 0012 at α = 0: |mean Cl| < 0.03', async ({ page }) => {
  test.setTimeout(180_000);
  await start(page);
  await page.evaluate(() => (window as unknown as AeroWindow).__aeroflow!.controller.setParams({ kind: 'naca0012', alphaDeg: 0 }));
  await clearSamples(page);
  const t0 = await elapsed(page);
  await waitUntil(page, t0 + 60_000);
  const d = await dump(page);
  const state = await page.evaluate(() => (window as unknown as AeroWindow).__aeroflow!.getState());
  const s = d.samples;
  const clMean = trapMean(s, Math.floor(s.length / 2), s.length - 1, (x) => x.clInst);
  report('NACA0012', { re: state.re, st: state.st, clMeanLastHalf: clMean, stateCl: state.cl, stateCd: state.cd, samples: s.length });

  expect(d.messages).toEqual([]);
  expect(Math.abs(clMean)).toBeLessThan(0.03);
});

test('10-minute soak never shows the divergence message @soak', async ({ page }) => {
  test.setTimeout(12 * 60_000);
  await start(page, false);
  await waitUntil(page, 10 * 60_000);
  const d = await dump(page);
  const state = await page.evaluate(() => (window as unknown as AeroWindow).__aeroflow!.getState());
  report('soak', { steps: state.step, messages: d.messages.length, cd: state.cd, st: state.st });
  expect(d.messages.filter((m) => m === COPY.divergence)).toEqual([]);
  expect(state.message).toBeNull();
});
