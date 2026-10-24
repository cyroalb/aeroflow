export type PresetId = 'baixa' | 'media' | 'alta';

export const PRESETS: Record<PresetId, { W: number; H: number; Lblunt: number; Lchord: number }> = {
  baixa: { W: 240, H: 96, Lblunt: 16, Lchord: 32 },
  media: { W: 400, H: 160, Lblunt: 27, Lchord: 53 },
  alta: { W: 600, H: 240, Lblunt: 40, Lchord: 80 },
};

export const NU_AIR = 1.5e-5;
export const U_LB = 0.08;
export const CS_SMAG = 0.1;
export const FIDELITY_RE_CELL = 8;

export const COPY = {
  fidelityWarning: '⚠ Re alto: modelo de turbulência, valores aproximados',
  note2D:
    'Esta simulação é 2D. Acima de Re ≈ 190, o escoamento real ao redor de um cilindro é tridimensional; os valores aqui não capturam esses efeitos.',
  divergence: 'A simulação ficou instável e foi reiniciada.',
  unsupported:
    'Seu navegador não suporta WebGPU nem WebGL2 com texturas float. Use uma versão recente do Chrome, Edge ou Firefox.',
  altaDisabledTooltip: 'Disponível apenas com WebGPU',
} as const;
