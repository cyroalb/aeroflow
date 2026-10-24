import './ui/styles.css';
import { PRESETS, type PresetId } from './config';
import { detectBackend } from './backend/detect';
import { measureLups, choosePreset } from './backend/benchmark';
import type { SimBackend } from './backend/types';
import { SimController, type SimState } from './sim/controller';
import { fieldScale, type FieldName } from './ui/colormaps';
import { buildLayout, showUnsupported, type UiRefs } from './ui/layout';
import { wireControls } from './ui/controls';
import { updateLegend, updateOverlay } from './ui/overlay';
import { TimeChart, SweepChart, SweepStore } from './ui/charts';

declare global {
  interface Window {
    __aeroflow?: { getState(): SimState; controller: SimController; backend: 'webgpu' | 'webgl2'; timeChart: TimeChart; sweep: SweepStore };
  }
}

const WINDOW_CONVECTIVE = 20;
const DEFAULTS = { U: 0.15, L: 0.01, alphaDeg: 0, kind: 'cylinder' } as const;

function presetOverride(): PresetId | null {
  const q = new URLSearchParams(location.search).get('preset');
  return q !== null && q in PRESETS ? (q as PresetId) : null;
}

function setAspect(ui: UiRefs, controller: SimController): void {
  const { W, H } = controller.grid;
  ui.canvasWrap.style.setProperty('--ar', `${W} / ${H}`);
  ui.canvasWrap.style.setProperty('--arn', String(W / H));
}

async function choose(backend: SimBackend, ui: UiRefs): Promise<{ preset: PresetId; auto: PresetId | null }> {
  const forced = presetOverride();
  if (forced) {
    const preset = backend.kind === 'webgl2' && forced === 'alta' ? 'media' : forced;
    return { preset, auto: null };
  }
  ui.status.textContent = 'Medindo desempenho…';
  ui.status.hidden = false;
  let preset: PresetId = 'baixa';
  try {
    preset = choosePreset(await measureLups(backend), backend.kind);
  } catch (e) {
    console.error(e);
  }
  return { preset, auto: preset };
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  const ui = buildLayout(app);
  ui.status.textContent = 'Iniciando…';

  const backend = await detectBackend(ui.canvas);
  if (!backend || backend.kind === 'cpu') {
    showUnsupported(app);
    return;
  }
  const kind = backend.kind;
  ui.engine.textContent = kind === 'webgpu' ? 'WebGPU' : 'WebGL2';

  const { preset, auto } = await choose(backend, ui);
  const controller = new SimController(backend, preset, { ...DEFAULTS });
  let state = await controller.frame(performance.now()); // applies the initial reset
  controller.onState((s) => {
    state = s;
  });

  let field: FieldName = 'vorticity';
  setAspect(ui, controller);
  updateLegend(ui, field);
  wireControls(ui, controller, {
    backendKind: kind,
    autoPreset: auto,
    onField: (f) => {
      field = f;
      updateLegend(ui, f);
    },
    onPreset: (p) => {
      void controller.setPreset(p).then(() => setAspect(ui, controller));
    },
  });

  const timeChart = new TimeChart(ui.chartTime, () => {
    const p = controller.params;
    return (WINDOW_CONVECTIVE * p.L) / p.U;
  });
  const sweep = new SweepStore();
  const sweepChart = new SweepChart(ui.chartSweep, sweep);
  window.__aeroflow = { getState: () => state, controller, backend: kind, timeChart, sweep };
  ui.status.hidden = true;

  let logged = false;
  const tick = async (now: number) => {
    try {
      await controller.frame(now);
      const lat = controller.lattice;
      backend.render(field, ui.canvas, fieldScale(field, lat.uLb, lat.Lcells));
      updateOverlay(ui, state);
      timeChart.push(state);
      const prm = controller.params;
      sweepChart.update(prm.kind, state, prm);
    } catch (e) {
      if (!logged) {
        logged = true;
        console.error(e);
      }
    } finally {
      requestAnimationFrame(tick);
    }
  };
  updateOverlay(ui, state);
  requestAnimationFrame(tick);
}

void main();
