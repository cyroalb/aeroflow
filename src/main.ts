import './ui/styles.css';
import { PRESETS, type PresetId } from './config';
import { detectBackend, detectWebGL2 } from './backend/detect';
import { measureLups, choosePreset } from './backend/benchmark';
import type { SimBackend } from './backend/types';
import { SimController, type SimState } from './sim/controller';
import { fieldScale, type FieldName } from './ui/colormaps';
import { buildLayout, showBackendFailure, showUnsupported, type UiRefs } from './ui/layout';
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

interface Started {
  backend: SimBackend;
  controller: SimController;
  state: SimState;
  auto: PresetId | null;
}

/** Chooses the preset and runs the first frame (initial reset); null if the backend cannot initialise. */
async function start(backend: SimBackend, ui: UiRefs): Promise<Started | null> {
  ui.engine.textContent = backend.kind === 'webgpu' ? 'WebGPU' : 'WebGL2';
  const { preset, auto } = await choose(backend, ui);
  const controller = new SimController(backend, preset, { ...DEFAULTS });
  const state = await controller.frame(performance.now()); // applies the initial reset
  if (state.backendFailed) {
    backend.destroy();
    return null;
  }
  return { backend, controller, state, auto };
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  const ui = buildLayout(app);
  ui.status.textContent = 'Iniciando…';

  const detected = await detectBackend(ui.canvas);
  if (!detected || detected.kind === 'cpu') {
    showUnsupported(app);
    return;
  }
  let started = await start(detected, ui);
  if (!started && detected.kind === 'webgpu') {
    // WebGPU was detected but cannot run the simulation: fall back to WebGL2
    // (the display canvas has no context yet: WebGPU only configures it on the first render)
    const gl = detectWebGL2(ui.canvas);
    if (gl) started = await start(gl, ui);
  }
  if (!started) {
    showBackendFailure(app);
    return;
  }
  const { backend, controller, auto } = started;
  const kind = backend.kind as 'webgpu' | 'webgl2';
  let state = started.state;
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
      if (state.backendFailed) {
        // the controller gave up after repeated failed resets: stop the loop and say so
        ui.toast.hidden = true;
        showBackendFailure(app);
        return;
      }
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
    }
    requestAnimationFrame(tick);
  };
  updateOverlay(ui, state);
  requestAnimationFrame(tick);
}

main().catch((e) => {
  console.error(e);
  const app = document.getElementById('app');
  if (app) showBackendFailure(app);
});
