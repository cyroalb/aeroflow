import { NU_AIR, PRESETS, U_LB, FIDELITY_RE_CELL, type PresetId } from '../config';

export type ObjectKind = 'cylinder' | 'square' | 'plate' | 'naca0012' | 'naca2412';

export interface PhysParams {
  U: number;
  L: number;
  alphaDeg: number;
  kind: ObjectKind;
}

export interface LatticeParams {
  Lcells: number;
  uLb: number;
  nuLb: number;
  tau0: number;
  re: number;
  dtPhys: number;
  showFidelityWarning: boolean;
}

export function reynolds(U: number, L: number): number {
  return (U * L) / NU_AIR;
}

export function toLattice(p: PhysParams, preset: PresetId): LatticeParams {
  const cfg = PRESETS[preset];
  const isAirfoil = p.kind === 'naca0012' || p.kind === 'naca2412';
  const Lcells = isAirfoil ? cfg.Lchord : cfg.Lblunt;
  const re = reynolds(p.U, p.L);
  const nuLb = (U_LB * Lcells) / re;
  return {
    Lcells,
    uLb: U_LB,
    nuLb,
    tau0: 0.5 + 3 * nuLb,
    re,
    dtPhys: ((p.L / Lcells) * U_LB) / p.U,
    showFidelityWarning: re / Lcells > FIDELITY_RE_CELL,
  };
}
