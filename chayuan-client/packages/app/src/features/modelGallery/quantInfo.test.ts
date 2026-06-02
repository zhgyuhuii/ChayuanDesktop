import { describe, expect, it } from 'vitest';
import { annotateQuants, PREFERRED_QUANT, quantInfo, RAM_OVERHEAD_FACTOR } from './quantInfo';

const GB = 1024 ** 3;

describe('quantInfo', () => {
  it('extracts common quant tags (case-insensitive, normalized upper)', () => {
    expect(quantInfo('qwen2.5-7b-instruct-q4_k_m.gguf', null).quant).toBe('Q4_K_M');
    expect(quantInfo('model.Q2_K.gguf', null).quant).toBe('Q2_K');
    expect(quantInfo('model.Q3_K_S.gguf', null).quant).toBe('Q3_K_S');
    expect(quantInfo('model.Q3_K_L.gguf', null).quant).toBe('Q3_K_L');
    expect(quantInfo('model.Q4_0.gguf', null).quant).toBe('Q4_0');
    expect(quantInfo('model.Q5_K_M.gguf', null).quant).toBe('Q5_K_M');
    expect(quantInfo('model.Q6_K.gguf', null).quant).toBe('Q6_K');
    expect(quantInfo('model.Q8_0.gguf', null).quant).toBe('Q8_0');
  });

  it('returns null quant when no quant token present', () => {
    expect(quantInfo('model.safetensors', 100).quant).toBeNull();
    expect(quantInfo('config.json', null).quant).toBeNull();
  });

  it('estimates ram as size * 1.2 (rounded), null when no size', () => {
    const r = quantInfo('m.Q4_K_M.gguf', 5 * GB);
    expect(r.approxRamBytes).toBe(Math.round(5 * GB * RAM_OVERHEAD_FACTOR));
    expect(quantInfo('m.Q4_K_M.gguf', null).approxRamBytes).toBeNull();
    expect(quantInfo('m.Q4_K_M.gguf', 0).approxRamBytes).toBeNull();
  });

  it('single-file quantInfo never flags recommended', () => {
    expect(quantInfo('m.Q4_K_M.gguf', GB).recommended).toBe(false);
  });
});

describe('annotateQuants', () => {
  const mk = (name: string, size: number | null) => ({ name, size });
  const ann = (files: { name: string; size: number | null }[]) =>
    annotateQuants(files, (f) => f.name, (f) => f.size);

  it('sorts by quant size from small to large, unknown last', () => {
    const out = ann([
      mk('m.Q8_0.gguf', 8 * GB),
      mk('m.Q2_K.gguf', 2 * GB),
      mk('readme.md', 1),
      mk('m.Q4_K_M.gguf', 4 * GB),
    ]);
    expect(out.map((o) => o.info.quant)).toEqual(['Q2_K', 'Q4_K_M', 'Q8_0', null]);
  });

  it('marks Q4_K_M as recommended when present (exact match)', () => {
    const out = ann([
      mk('m.Q2_K.gguf', 2 * GB),
      mk('m.Q4_K_M.gguf', 4 * GB),
      mk('m.Q8_0.gguf', 8 * GB),
    ]);
    const rec = out.filter((o) => o.info.recommended);
    expect(rec).toHaveLength(1);
    expect(rec[0]!.info.quant).toBe('Q4_K_M');
  });

  it('falls back to nearest-to-balanced quant when no Q4_K_M', () => {
    const out = ann([
      mk('m.Q2_K.gguf', 2 * GB),
      mk('m.Q5_K_M.gguf', 5 * GB),
      mk('m.Q8_0.gguf', 8 * GB),
    ]);
    const rec = out.filter((o) => o.info.recommended);
    expect(rec).toHaveLength(1);
    // Q5_K_M (rank ~5.2) is closest to Q4_K_M (rank 4.2).
    expect(rec[0]!.info.quant).toBe('Q5_K_M');
  });

  it('marks nothing recommended when no quant recognized', () => {
    const out = ann([mk('a.safetensors', GB), mk('b.bin', GB)]);
    expect(out.some((o) => o.info.recommended)).toBe(false);
  });

  it('PREFERRED_QUANT is Q4_K_M', () => {
    expect(PREFERRED_QUANT).toBe('Q4_K_M');
  });
});
