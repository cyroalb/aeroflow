import { describe, it, expect } from 'vitest';
import { choosePreset } from '../../src/backend/benchmark';
import { PRESETS } from '../../src/config';

const cells = (p: 'baixa' | 'media' | 'alta') => PRESETS[p].W * PRESETS[p].H;

describe('choosePreset', () => {
  it('webgpu with huge throughput gives alta', () => expect(choosePreset(1e9, 'webgpu')).toBe('alta'));
  it('webgl2 never gets alta', () => expect(choosePreset(1e9, 'webgl2')).toBe('media'));
  it('media boundary', () => {
    const edge = (cells('media') * 1200) / 0.8;
    expect(choosePreset(edge + 1, 'webgpu')).toBe('media');
    expect(choosePreset(edge - 1000, 'webgpu')).toBe('baixa');
  });
  it('low throughput gives baixa', () => expect(choosePreset(1e6, 'webgl2')).toBe('baixa'));
});
