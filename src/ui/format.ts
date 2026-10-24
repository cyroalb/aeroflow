/** Pure pt-BR number formatting for the overlay and the sidebar footer. */

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};
const MINUS = '−';
const DASH = '—';

function superscript(n: number): string {
  return String(n)
    .split('')
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join('');
}

/** Reynolds number, always scientific with 2 significant digits: 100 → "1,0×10²". */
export function formatRe(re: number): string {
  if (!Number.isFinite(re) || re <= 0) return DASH;
  let e = Math.floor(Math.log10(re));
  let m = Math.round((re / 10 ** e) * 10) / 10;
  if (m >= 10) {
    m /= 10;
    e += 1;
  } else if (m < 1) {
    m *= 10;
    e -= 1;
  }
  return `${m.toFixed(1).replace('.', ',')}×10${superscript(e)}`;
}

/** Fixed decimals, comma decimal, U+2212 minus (never "−0,00"), no plus sign, no grouping. */
export function formatSigned(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return DASH;
  const abs = Math.abs(v).toFixed(decimals);
  const sign = v < 0 && Number(abs) !== 0 ? MINUS : '';
  return sign + abs.replace('.', ',');
}

/** "Re 1,0×10² · Cd 1,33 · Cl −0,05 · St 0,165" (St omitted when null). */
export function formatOverlay(s: { re: number; cd: number; cl: number; st: number | null }): string {
  const parts = [`Re ${formatRe(s.re)}`, `Cd ${formatSigned(s.cd, 2)}`, `Cl ${formatSigned(s.cl, 2)}`];
  if (s.st !== null) parts.push(`St ${formatSigned(s.st, 3)}`);
  return parts.join(' · ');
}

function ptBR(v: number, maxFrac: number, minFrac = maxFrac): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac }).format(v);
}

/** Physical simulated time: "t = 1,23 s". */
export function formatSimTime(t: number): string {
  if (!Number.isFinite(t)) return `t = ${DASH} s`;
  const d = t < 1 ? 3 : t < 100 ? 2 : 0;
  return `t = ${ptBR(t, d)} s`;
}

/** Wall seconds per physical second → "câmera lenta ×14", or "acelerado ×10" when below 1. */
export function formatSlowMotion(factor: number): string {
  if (!Number.isFinite(factor) || factor <= 0) return '';
  const slow = factor >= 1;
  const n = slow ? factor : 1 / factor;
  return `${slow ? 'câmera lenta' : 'acelerado'} ×${ptBR(n, n < 10 ? 1 : 0, 0)}`;
}
