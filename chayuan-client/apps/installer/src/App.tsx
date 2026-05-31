import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  resolveComponents, mirrorCandidates, DEFAULT_MIRROR_RULES,
  type InstallerManifest, type Tier, type Selection, type ResolvedComponent,
} from '@chayuan/installer-core';

const TIERS: { id: Tier; label: string }[] = [
  { id: 'lite', label: '轻量版' },
  { id: 'standard', label: '集成版' },
  { id: 'pro', label: '全量版' },
];
const OSES = ['linux', 'mac', 'win'] as const;
const ARCHES = ['x86_64', 'arm64'] as const;

export const App: React.FC = () => {
  const [tier, setTier] = React.useState<Tier>('lite');
  const [os, setOs] = React.useState<Selection['os']>('win');
  const [arch, setArch] = React.useState<Selection['arch']>('x86_64');
  const [manifest, setManifest] = React.useState<InstallerManifest | null>(null);
  const [log, setLog] = React.useState<string[]>([]);
  const append = (s: string) => setLog((l) => [...l, s]);

  // 拉清单([BUILD-VERIFY] 真实地址走 website;此处先留按钮)
  const loadManifest = async () => {
    try {
      const m = await invoke<InstallerManifest>('fetch_manifest');
      setManifest(m);
      append(`清单 v${m.version},组件 ${m.components.length}`);
    } catch (e) {
      append(`拉清单失败: ${String(e)}`);
    }
  };

  const plan: ResolvedComponent[] = manifest
    ? resolveComponents(manifest, { tier, os, arch })
    : [];

  const startInstall = async () => {
    for (const c of plan) {
      const candidates = mirrorCandidates(c.url, DEFAULT_MIRROR_RULES);
      append(`下载 ${c.name}(${candidates.length} 候选源)…`);
      try {
        // [BUILD-VERIFY] Rust download_file:续传 + sha 校验 + 落 dest
        await invoke('download_file', { candidates, dest: c.dest, sha256: c.sha256 ?? null });
        append(`✓ ${c.name}`);
      } catch (e) {
        append(`✗ ${c.name}: ${String(e)}`);
      }
    }
    append('完成(真下载需 Tauri Rust 环境)');
  };

  return (
    <div style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 720 }}>
      <h1>察元下载构建器</h1>
      <section style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '16px 0' }}>
        <label>档位{' '}
          <select value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
            {TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label>系统{' '}
          <select value={os} onChange={(e) => setOs(e.target.value as Selection['os'])}>
            {OSES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label>架构{' '}
          <select value={arch} onChange={(e) => setArch(e.target.value as Selection['arch'])}>
            {ARCHES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </section>
      <button onClick={() => void loadManifest()}>① 拉取清单</button>{' '}
      <button onClick={() => void startInstall()} disabled={plan.length === 0}>② 安装到本机({plan.length} 组件)</button>
      <ul>{plan.map((c) => <li key={c.name}>{c.name} → {c.dest}</li>)}</ul>
      <pre style={{ background: '#111', color: '#0f0', padding: 12, minHeight: 80 }}>{log.join('\n')}</pre>
    </div>
  );
};
