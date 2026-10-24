import { COPY } from '../config';
import type { ObjectKind } from '../physics/units';

export const OBJECTS: { kind: ObjectKind; label: string; size: string; icon: string }[] = [
  { kind: 'cylinder', label: 'Cilindro', size: 'Diâmetro', icon: '<circle cx="12" cy="12" r="6"/>' },
  { kind: 'square', label: 'Quadrado', size: 'Lado', icon: '<rect x="6.5" y="6.5" width="11" height="11"/>' },
  { kind: 'plate', label: 'Placa plana', size: 'Comprimento', icon: '<rect x="11" y="4" width="2" height="16"/>' },
  {
    kind: 'naca0012',
    label: 'NACA 0012',
    size: 'Corda',
    icon: '<path d="M3 12c2-3.2 6-4 10-3.4 3.2.5 6 1.8 8 3.4-2 1.6-4.8 2.9-8 3.4-4 .6-8-.2-10-3.4z"/>',
  },
  {
    kind: 'naca2412',
    label: 'NACA 2412',
    size: 'Corda',
    icon: '<path d="M3 13c2-4 6-5.4 10-5 3.2.4 6 2 8 4.4-2 .8-4.8 1.6-8 1.8-4 .3-8-.1-10-1.2z"/>',
  },
];

export const FIELDS: { id: 'vorticity' | 'speed' | 'pressure'; label: string }[] = [
  { id: 'vorticity', label: 'Vorticidade' },
  { id: 'speed', label: 'Velocidade' },
  { id: 'pressure', label: 'Pressão (Cp)' },
];

export const QUALITIES: { id: 'baixa' | 'media' | 'alta'; label: string }[] = [
  { id: 'baixa', label: 'Baixa' },
  { id: 'media', label: 'Média' },
  { id: 'alta', label: 'Alta' },
];

export interface UiRefs {
  root: HTMLElement;
  canvasWrap: HTMLElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  status: HTMLElement;
  toast: HTMLElement;
  legend: HTMLElement;
  legendBar: HTMLElement;
  legendMin: HTMLElement;
  legendMax: HTMLElement;
  objects: HTMLInputElement[];
  uRange: HTMLInputElement;
  uNum: HTMLInputElement;
  lRange: HTMLInputElement;
  lNum: HTMLInputElement;
  sizeLabel: HTMLElement;
  angle: HTMLInputElement;
  angleOut: HTMLOutputElement;
  field: HTMLSelectElement;
  quality: HTMLSelectElement;
  warning: HTMLElement;
  noteToggle: HTMLButtonElement;
  note: HTMLElement;
  simTime: HTMLElement;
  slowmo: HTMLElement;
  engine: HTMLElement;
  chartTime: HTMLElement;
  chartSweep: HTMLElement;
}

const icon = (path: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" class="af-chip-icon">${path}</svg>`;

/** Builds the lab-panel layout (canvas + overlay, right sidebar, bottom chart strip) inside `app`. */
export function buildLayout(app: HTMLElement): UiRefs {
  app.innerHTML = `
  <div class="af">
    <main class="af-stage">
      <div class="af-canvas-wrap" id="canvas-wrap">
        <canvas id="sim" width="288" height="144" aria-label="Campo do escoamento"></canvas>
        <div id="overlay" class="af-overlay"></div>
        <div id="status" class="af-status" role="status"></div>
        <div id="message" class="af-toast" role="alert" hidden></div>
        <div class="af-legend" id="legend" aria-hidden="true">
          <span id="legend-min"></span><span class="af-legend-bar" id="legend-bar"></span><span id="legend-max"></span>
        </div>
      </div>
    </main>

    <aside class="af-side" aria-label="Controles">
      <header class="af-brand">
        <span class="af-logo">AeroFlow</span>
        <span class="af-tag">túnel de vento 2D · ar</span>
      </header>

      <fieldset class="af-group">
        <legend class="af-label">Objeto</legend>
        <div class="af-chips">
          ${OBJECTS.map(
            (o, i) => `
          <label class="af-chip">
            <input type="radio" name="object" value="${o.kind}"${i === 0 ? ' checked' : ''} />
            ${icon(o.icon)}<span>${o.label}</span>
          </label>`,
          ).join('')}
        </div>
      </fieldset>

      <div class="af-group">
        <label class="af-label" for="u-num">Velocidade (m/s)</label>
        <div class="af-pair">
          <input type="range" id="u-range" min="0" max="1000" step="1" aria-label="Velocidade (escala logarítmica)" />
          <input type="number" id="u-num" min="0.001" max="100" step="any" inputmode="decimal" />
        </div>
      </div>

      <div class="af-group">
        <label class="af-label" for="l-num"><span class="af-kicker">Tamanho</span> <span id="size-label">Diâmetro (m)</span></label>
        <div class="af-pair">
          <input type="range" id="l-range" min="0" max="1000" step="1" aria-label="Tamanho (escala logarítmica)" />
          <input type="number" id="l-num" min="0.001" max="2" step="any" inputmode="decimal" />
        </div>
      </div>

      <div class="af-group">
        <label class="af-label" for="angle">Ângulo (°)</label>
        <div class="af-pair">
          <input type="range" id="angle" min="-20" max="90" step="0.5" value="0" />
          <output id="angle-out" for="angle" class="af-readout">0,0°</output>
        </div>
      </div>

      <div class="af-row">
        <div class="af-group">
          <label class="af-label" for="field">Campo</label>
          <select id="field">${FIELDS.map((f) => `<option value="${f.id}">${f.label}</option>`).join('')}</select>
        </div>
        <div class="af-group">
          <label class="af-label" for="quality">Qualidade</label>
          <select id="quality">${QUALITIES.map((q) => `<option value="${q.id}">${q.label}</option>`).join('')}</select>
        </div>
      </div>

      <div id="warning" class="af-warning" role="status" hidden>${COPY.fidelityWarning}</div>

      <div class="af-note">
        <button type="button" id="note-toggle" class="af-note-toggle" aria-expanded="false" aria-controls="note-2d">
          <span aria-hidden="true">ⓘ</span> Sobre a simulação 2D
        </button>
        <p id="note-2d" hidden>${COPY.note2D}</p>
      </div>

      <footer class="af-foot">
        <span id="sim-time" class="af-num">t = 0,000 s</span>
        <span id="slowmo" class="af-num"></span>
        <span id="engine" class="af-engine"></span>
      </footer>
    </aside>

    <section class="af-charts" aria-label="Gráficos">
      <div id="chart-time" class="af-chart" data-placeholder="Cd e Cl ao longo do tempo"></div>
      <div id="chart-sweep" class="af-chart" data-placeholder="Varredura de parâmetros"></div>
    </section>
  </div>`;

  const $ = <T extends HTMLElement>(id: string) => app.querySelector<T>(`#${id}`)!;
  return {
    root: app,
    canvasWrap: $('canvas-wrap'),
    canvas: $<HTMLCanvasElement>('sim'),
    overlay: $('overlay'),
    status: $('status'),
    toast: $('message'),
    legend: $('legend'),
    legendBar: $('legend-bar'),
    legendMin: $('legend-min'),
    legendMax: $('legend-max'),
    objects: [...app.querySelectorAll<HTMLInputElement>('input[name="object"]')],
    uRange: $<HTMLInputElement>('u-range'),
    uNum: $<HTMLInputElement>('u-num'),
    lRange: $<HTMLInputElement>('l-range'),
    lNum: $<HTMLInputElement>('l-num'),
    sizeLabel: $('size-label'),
    angle: $<HTMLInputElement>('angle'),
    angleOut: $<HTMLOutputElement>('angle-out'),
    field: $<HTMLSelectElement>('field'),
    quality: $<HTMLSelectElement>('quality'),
    warning: $('warning'),
    noteToggle: $<HTMLButtonElement>('note-toggle'),
    note: $('note-2d'),
    simTime: $('sim-time'),
    slowmo: $('slowmo'),
    engine: $('engine'),
    chartTime: $('chart-time'),
    chartSweep: $('chart-sweep'),
  };
}

/** Replaces the whole app with the full-width unsupported-browser message. */
export function showUnsupported(app: HTMLElement): void {
  app.innerHTML = `<div class="af-unsupported-wrap"><p id="unsupported" class="af-unsupported" role="alert">${COPY.unsupported}</p></div>`;
}
