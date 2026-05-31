import { describe, it, expect } from 'vitest';
import { mirrorCandidates, DEFAULT_MIRROR_RULES } from '../mirrors';

describe('mirrorCandidates', () => {
  it('hf.co / huggingface.co 域名追加 hf-mirror 候选,原始在前', () => {
    const out = mirrorCandidates('https://huggingface.co/org/repo/file.gguf', DEFAULT_MIRROR_RULES);
    expect(out[0]).toBe('https://huggingface.co/org/repo/file.gguf');
    expect(out).toContain('https://hf-mirror.com/org/repo/file.gguf');
  });

  it('无匹配规则的 URL 只返回自身', () => {
    const out = mirrorCandidates('https://example.com/a.bin', DEFAULT_MIRROR_RULES);
    expect(out).toEqual(['https://example.com/a.bin']);
  });

  it('去重:原始与重写相同的不重复', () => {
    const out = mirrorCandidates('https://hf-mirror.com/x/y.gguf', DEFAULT_MIRROR_RULES);
    expect(out).toEqual(['https://hf-mirror.com/x/y.gguf']);
  });

  it('自定义规则按声明顺序产出候选', () => {
    const rules = [{ match: 'a.com', replace: 'b.com' }, { match: 'a.com', replace: 'c.com' }];
    const out = mirrorCandidates('https://a.com/f', rules);
    expect(out).toEqual(['https://a.com/f', 'https://b.com/f', 'https://c.com/f']);
  });
});
