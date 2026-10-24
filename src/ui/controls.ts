import { COPY, type PresetId } from '../config';
import type { ObjectKind } from '../physics/units';
import type { SimController } from '../sim/controller';
import type { FieldName } from './colormaps';
import { OBJECTS, QUALITIES, type UiRefs } from './layout';

const U_RANGE: [number, number] = [0.001, 100];
const L_RANGE: [number, number] = [0.001, 2];
const SLIDER_MAX = 1000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Log slider position (0..SLIDER_MAX) → value. */
export function fromLogSlider(pos: number, [lo, hi]: [number, number]): number {
  const t = clamp(pos / SLIDER_MAX, 0, 1);
  return 10 ** (Math.log10(lo) + t * (Math.log10(hi) - Math.log10(lo)));
}

/** Value → log slider position (0..SLIDER_MAX). */
export function toLogSlider(v: number, [lo, hi]: [number, number]): number {
  const t = (Math.log10(clamp(v, lo, hi)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
  return Math.round(t * SLIDER_MAX);
}

/** 3 significant digits, as a plain number string for <input type="number">. */
const shown = (v: number) => String(Number(v.toPrecision(3)));
const fmtAngle = (a: number) => `${a.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°`;

export interface ControlOptions {
  backendKind: 'webgpu' | 'webgl2' | 'cpu';
  /** Preset chosen by the benchmark (gets the "(auto)" suffix); null when forced via ?preset=. */
  autoPreset: PresetId | null;
  onField(field: FieldName): void;
  onPreset(preset: PresetId): void;
}

/** Wires the sidebar inputs to the controller (which clamps and coalesces every change). */
export function wireControls(ui: UiRefs, controller: SimController, opts: ControlOptions): void {
  const p = controller.params;

  // object
  const sizeName = (k: ObjectKind) => OBJECTS.find((o) => o.kind === k)?.size ?? 'Tamanho';
  const syncSizeLabel = (k: ObjectKind) => {
    ui.sizeLabel.textContent = `${sizeName(k)} (m)`;
  };
  for (const r of ui.objects) {
    r.checked = r.value === p.kind;
    r.addEventListener('change', () => {
      if (!r.checked) return;
      const kind = r.value as ObjectKind;
      syncSizeLabel(kind);
      controller.setParams({ kind });
    });
  }
  syncSizeLabel(p.kind);

  // log slider + numeric input pairs
  const pair = (
    range: HTMLInputElement,
    num: HTMLInputElement,
    bounds: [number, number],
    initial: number,
    apply: (v: number) => void,
  ) => {
    range.value = String(toLogSlider(initial, bounds));
    num.value = shown(initial);
    range.addEventListener('input', () => {
      const v = fromLogSlider(Number(range.value), bounds);
      num.value = shown(v);
      apply(Number(num.value));
    });
    num.addEventListener('change', () => {
      const raw = Number(num.value.replace(',', '.'));
      if (!Number.isFinite(raw) || num.value.trim() === '') {
        num.value = shown(fromLogSlider(Number(range.value), bounds));
        return;
      }
      const v = clamp(raw, bounds[0], bounds[1]);
      if (v !== raw) num.value = shown(v);
      range.value = String(toLogSlider(v, bounds));
      apply(v);
    });
  };
  pair(ui.uRange, ui.uNum, U_RANGE, p.U, (U) => controller.setParams({ U }));
  pair(ui.lRange, ui.lNum, L_RANGE, p.L, (L) => controller.setParams({ L }));

  // angle
  ui.angle.value = String(p.alphaDeg);
  ui.angleOut.value = fmtAngle(p.alphaDeg);
  ui.angle.addEventListener('input', () => {
    const a = Number(ui.angle.value);
    ui.angleOut.value = fmtAngle(a);
    controller.setParams({ alphaDeg: a });
  });

  // field
  ui.field.addEventListener('change', () => opts.onField(ui.field.value as FieldName));

  // quality
  for (const o of ui.quality.options) {
    const q = QUALITIES.find((x) => x.id === o.value)!;
    o.textContent = q.id === opts.autoPreset ? `${q.label} (auto)` : q.label;
    if (q.id === 'alta' && opts.backendKind === 'webgl2') {
      o.disabled = true;
      o.title = COPY.altaDisabledTooltip;
    }
  }
  ui.quality.value = controller.preset;
  ui.quality.addEventListener('change', () => opts.onPreset(ui.quality.value as PresetId));

  // ⓘ 2D note
  ui.noteToggle.addEventListener('click', () => {
    const open = ui.note.hidden;
    ui.note.hidden = !open;
    ui.noteToggle.setAttribute('aria-expanded', String(open));
  });
}
