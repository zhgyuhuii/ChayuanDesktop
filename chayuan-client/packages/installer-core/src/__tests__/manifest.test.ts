import { describe, it, expect } from 'vitest';
import { resolveComponents } from '../manifest';
import type { InstallerManifest } from '../types';

const M: InstallerManifest = {
  version: '3.0.0',
  components: [
    {
      name: 'qwen3-4b', tiers: ['lite', 'standard', 'pro'], dest: 'models/chat/qwen3',
      platforms: {
        'linux-x86_64': { url: 'https://x/qwen.gguf', sha256: 'aa', unpack: 'none', sizeBytes: 100 },
        'mac-arm64': { url: 'https://x/qwen.gguf', sha256: 'aa', unpack: 'none' },
      },
    },
    {
      name: 'milvus', tiers: ['pro'], dest: 'vendor/services/milvus', optional: true,
      platforms: { 'linux-x86_64': { url: 'https://x/milvus.tgz', unpack: 'tar.gz' } },
    },
    {
      name: 'win-only', tiers: ['standard', 'pro'], dest: 'vendor/x',
      platforms: { 'win-x86_64': { url: 'https://x/w.zip', unpack: 'zip' } },
    },
  ],
};

describe('resolveComponents', () => {
  it('lite + linux-x86_64 → 只含该档且该平台有资产的组件', () => {
    const out = resolveComponents(M, { tier: 'lite', os: 'linux', arch: 'x86_64' });
    expect(out.map((c) => c.name)).toEqual(['qwen3-4b']);
    expect(out[0].url).toBe('https://x/qwen.gguf');
    expect(out[0].dest).toBe('models/chat/qwen3');
  });

  it('pro + linux-x86_64 → 含 pro 档全部该平台组件(qwen + milvus)', () => {
    const out = resolveComponents(M, { tier: 'pro', os: 'linux', arch: 'x86_64' });
    expect(out.map((c) => c.name).sort()).toEqual(['milvus', 'qwen3-4b']);
  });

  it('该平台无资产的组件被跳过(standard + linux 不含 win-only)', () => {
    const out = resolveComponents(M, { tier: 'standard', os: 'linux', arch: 'x86_64' });
    expect(out.map((c) => c.name)).toEqual(['qwen3-4b']);
  });

  it('mac-arm64 资产无 sizeBytes 也能解析', () => {
    const out = resolveComponents(M, { tier: 'lite', os: 'mac', arch: 'arm64' });
    expect(out).toHaveLength(1);
    expect(out[0].sizeBytes).toBeUndefined();
  });
});
