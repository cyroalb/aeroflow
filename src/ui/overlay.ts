import type { SimState } from '../sim/controller';
import { colormapFor, type FieldName } from './colormaps';
import { formatOverlay, formatSimTime, formatSlowMotion } from './format';
import type { UiRefs } from './layout';

const setText = (el: HTMLElement, s: string) => {
  if (el.textContent !== s) el.textContent = s;
};
const setHidden = (el: HTMLElement, h: boolean) => {
  if (el.hidden !== h) el.hidden = h;
};

/** Per-frame update of the canvas overlay, warning box, message toast and footer. */
export function updateOverlay(ui: UiRefs, s: SimState): void {
  setText(ui.overlay, formatOverlay(s));
  setHidden(ui.warning, !s.fidelityWarning);
  setHidden(ui.toast, s.message === null);
  if (s.message !== null) setText(ui.toast, s.message);
  setText(ui.simTime, formatSimTime(s.simTimePhys));
  setText(ui.slowmo, formatSlowMotion(s.slowMotion));
}

const LEGEND_ENDS: Record<FieldName, [string, string]> = {
  vorticity: ['horário', 'anti-horário'],
  speed: ['0', '1,6 U'],
  pressure: ['Cp −3', 'Cp 1'],
};

/** Colour bar under the canvas for the current field. */
export function updateLegend(ui: UiRefs, field: FieldName): void {
  const map = colormapFor(field);
  const stops = Array.from({ length: 9 }, (_, i) => {
    const c = map[Math.round((i / 8) * 255)];
    return `rgb(${c[0]} ${c[1]} ${c[2]}) ${(i / 8) * 100}%`;
  });
  ui.legendBar.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
  const [lo, hi] = LEGEND_ENDS[field];
  ui.legendMin.textContent = lo;
  ui.legendMax.textContent = hi;
}
