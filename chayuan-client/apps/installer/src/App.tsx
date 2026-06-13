import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  resolveComponents, mirrorCandidates, DEFAULT_MIRROR_RULES, decideUpdate, validateManifest,
  type InstallerManifest, type Tier, type Selection, type ResolvedComponent, type VersionResponse,
} from '@chayuan/installer-core';

const FALLBACK_VERSION = '3.0.0';

const TIERS: { id: Tier; label: string }[] = [
  { id: 'lite', label: '轻量版(纯云)' },
  { id: 'standard', label: '集成版' },
  { id: 'pro', label: '全量版' },
];
const OSES = ['linux', 'mac', 'win'] as const;
const ARCHES = ['x86_64', 'arm64'] as const;

interface ProgressEvt { dest: string; received: number; total: number | null }

export const App: React.FC = () => {
  const [tier, setTier] = React.useState<Tier>('lite');
  const [os, setOs] = React.useState<Selection['os']>('win');
  const [arch, setArch] = React.useState<Selection['arch']>('x86_64');
  const [manifest, setManifest] = React.useState<InstallerManifest | null>(null);
  const [version, setVersion] = React.useState<string>(FALLBACK_VERSION);
  const [progress, setProgress] = React.useState<Record<string, { pct: number; recv: number; total: number | null }>>({});
  const [installing, setInstalling] = React.useState(false);
  const [log, setLog] = React.useState<string[]>([]);
  const append = (s: string) => setLog((l) => [...l, s]);

  // 启动:读已装版本(读不到回落默认)
  React.useEffect(() => {
    void invoke<string>('read_installed_version')
      .then((v) => { if (v) setVersion(v); })
      .catch(() => { /* 无已装版本,用默认 */ });
  }, []);

  // 监听下载进度事件(download_file 每 ~1MB emit 一次)
  React.useEffect(() => {
    const un = listen<ProgressEvt>('download-progress', (e) => {
      const { dest, received, total } = e.payload;
      const pct = total && total > 0 ? Math.min(100, Math.round((received / total) * 100)) : -1;
      setProgress((p) => ({ ...p, [dest]: { pct, recv: received, total } }));
    });
    return () => { void un.then((f) => f()); };
  }, []);

  const loadManifest = async () => {
    try {
      const raw = await invoke<unknown>('fetch_manifest');
      const v = validateManifest(raw);
      if (!v.ok) { append(`清单校验失败,已拒绝:${v.errors.slice(0, 3).join('；')}`); return; }
      const m = raw as InstallerManifest;
      setManifest(m);
      append(`清单 v${m.version},组件 ${m.components.length}`);
    } catch (e) {
      append(`拉清单失败: ${String(e)}`);
    }
  };

  const plan: ResolvedComponent[] = manifest ? resolveComponents(manifest, { tier, os, arch }) : [];

  const startInstall = async () => {
    setInstalling(true);
    setProgress({});
    try {
      for (const c of plan) {
        const candidates = mirrorCandidates(c.url, DEFAULT_MIRROR_RULES);
        const needUnpack = !!c.unpack && c.unpack !== 'none';
        const dlTarget = needUnpack ? `${c.dest}.download` : c.dest;
        append(`下载 ${c.name}(${candidates.length} 候选源)…`);
        try {
          await invoke('download_file', { candidates, dest: dlTarget, sha256: c.sha256 ?? null });
          if (needUnpack) {
            append(`解包 ${c.name}(${c.unpack})…`);
            await invoke('unpack_archive', { archive: dlTarget, dest: c.dest, kind: c.unpack });
          }
          append(`✓ ${c.name}`);
        } catch (e) {
          append(`✗ ${c.name}: ${String(e)}`);
        }
      }
      append('安装流程结束(真下载/解包需 Tauri Rust 环境)');
    } finally {
      setInstalling(false);
    }
  };

  const checkUpdate = async () => {
    try {
      const resp = await invoke<VersionResponse>('fetch_version', { product: 'desktop' });
      const d = decideUpdate(resp, { currentVersion: version, os, arch, preferVariant: undefined });
      if (d.available) append(`发现新版 ${d.latestVersion}(${d.variant}) → ${d.downloadUrl}`);
      else append(`已是最新(当前 ${version})`);
    } catch (e) {
      append(`检查更新失败: ${String(e)}`);
    }
  };

  const fmtMB = (n: number) => (n / 1048576).toFixed(1);

  return (
    <div style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 760 }}>
      <h1>察元下载构建器 <small style={{ fontSize: 13, color: '#888' }}>当前版本 {version}</small></h1>
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
      <button onClick={() => void startInstall()} disabled={plan.length === 0 || installing}>
        {installing ? '安装中…' : `② 安装到本机(${plan.length} 组件)`}
      </button>{' '}
      <button onClick={() => void checkUpdate()}>检查更新</button>
      <ul>
        {plan.map((c) => {
          const pr = progress[c.unpack && c.unpack !== 'none' ? `${c.dest}.download` : c.dest];
          return (
            <li key={c.name} style={{ margin: '4px 0' }}>
              {c.name} → {c.dest}
              {pr ? (
                <span style={{ marginLeft: 8, color: '#06c' }}>
                  {pr.pct >= 0 ? `${pr.pct}%` : `${fmtMB(pr.recv)}MB`}
                  {pr.total ? ` / ${fmtMB(pr.total)}MB` : ''}
                  <span style={{ display: 'inline-block', width: 120, height: 6, background: '#eee', borderRadius: 3, marginLeft: 6, verticalAlign: 'middle' }}>
                    <span style={{ display: 'block', width: `${pr.pct >= 0 ? pr.pct : 100}%`, height: '100%', background: '#06c', borderRadius: 3 }} />
                  </span>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <pre style={{ background: '#111', color: '#0f0', padding: 12, minHeight: 80 }}>{log.join('\n')}</pre>
    </div>
  );
};
