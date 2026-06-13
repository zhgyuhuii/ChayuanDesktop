// apps/publisher/src/App.tsx
import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  planDetection, buildInstallerManifest, parsePackageName, unpackForExt, TIER_VARIANT,
  type DetectionPlan, type DetectItem, type PublishedAsset, type ManifestAsset,
} from '@chayuan/publisher-core';
import * as api from './api';
import { makePublishIO } from './tauriIO';

type Step = 1 | 2 | 3 | 4 | 5;

export function App() {
  const [step, setStep] = React.useState<Step>(1);
  // 登录
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [captcha, setCaptcha] = React.useState<{ captchaId: string; svg: string } | null>(null);
  const [captchaCode, setCaptchaCode] = React.useState('');
  const [err, setErr] = React.useState('');
  // 检测
  const [repo, setRepo] = React.useState(() => localStorage.getItem('cy.pub.repo') ?? '');
  const [buildDir, setBuildDir] = React.useState(() => localStorage.getItem('cy.pub.dir') ?? '');
  const [plan, setPlan] = React.useState<DetectionPlan | null>(null);
  // 上传/发布
  const [progress, setProgress] = React.useState<Record<string, { received: number; total: number }>>({});
  const [published, setPublished] = React.useState<PublishedAsset[]>([]);
  const [busy, setBusy] = React.useState(false);

  const refreshCaptcha = React.useCallback(async () => {
    try { setCaptcha(await api.getCaptcha()); } catch (e) { setErr(String(e)); }
  }, []);
  React.useEffect(() => { void refreshCaptcha(); }, [refreshCaptcha]);

  async function doLogin() {
    setErr('');
    try {
      await api.login(username, password, captcha?.captchaId ?? '', captchaCode);
      setStep(2);
    } catch (e) {
      const msg = String(e);
      if (msg.startsWith('429')) setErr('登录过于频繁,请稍后再试');
      else if (msg.includes('captcha')) setErr('验证码错误');
      else setErr('用户名或密码错误');
      void refreshCaptcha();
    }
  }

  async function doDetect() {
    setErr(''); setBusy(true);
    try {
      localStorage.setItem('cy.pub.repo', repo); localStorage.setItem('cy.pub.dir', buildDir);
      const [git, scanned, online, adminReleases] = await Promise.all([
        repo ? api.readGitVersion(repo).catch(() => ({ version: '', changelog: '' })) : Promise.resolve({ version: '', changelog: '' }),
        api.scanBuildDir(buildDir),
        api.fetchOnlineVersion().catch(() => undefined),
        api.fetchAdminReleases().catch(() => undefined),
      ]);
      setPlan(planDetection({ scanned, gitVersion: git.version || undefined, online, adminReleases }));
      setStep(2);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  function toggle(idx: number) {
    if (!plan) return;
    const items = plan.items.map((it, i) => i === idx ? { ...it, selected: !it.selected } : it);
    setPlan({ ...plan, items });
  }
  function setManual(idx: number, patch: Partial<DetectItem>) {
    if (!plan) return;
    const items = plan.items.map((it, i) => i === idx ? { ...it, ...patch, parsed: 'ok' as const } : it);
    setPlan({ ...plan, items });
  }

  async function doUploadPublish() {
    if (!plan || !plan.buildVersion) { setErr('缺少构建版本'); return; }
    setBusy(true); setErr(''); setStep(3);
    const selected = plan.items.filter((it) => it.selected && it.parsed === 'ok' && it.platform && it.tier);
    const filePathByName: Record<string, string> = {};
    for (const it of selected) filePathByName[it.filename] = it.path;
    const io = makePublishIO(filePathByName, (ev) =>
      setProgress((p) => ({ ...p, [ev.filename]: { received: ev.received, total: ev.total } })));
    const out: PublishedAsset[] = [];
    const version = plan.buildVersion;
    for (const it of selected) {
      try {
        const variant = TIER_VARIANT[it.tier!];
        const sha = await api.hashFile(it.path);
        const init = await io.initUpload({ product: 'chayuan', version, platform: it.platform!, filename: it.filename, size: it.sizeBytes, sha256: sha });
        const received = await io.getReceived(init.uploadId);
        const missing = Array.from({ length: init.totalChunks }, (_, i) => i).filter((i) => !received.includes(i));
        // 批量上传缺失块(Rust 端 emit 进度)
        await io._runUpload(init.uploadId, it.filename, init.chunkSize, init.totalChunks, missing);
        const fin = await io.finalize(init.uploadId, { variant, primary: it.onlineState === 'new', notes: '' });
        await io.publish('chayuan', version, it.platform!, variant);
        const ext = parsePackageName(it.filename)?.ext ?? '';
        out.push({ platform: it.platform!, tier: it.tier!, url: fin.url, sha256: fin.sha256, sizeBytes: fin.sizeBytes, unpack: unpackForExt(ext) });
      } catch (e) { setErr((prev) => prev + `\n${it.filename}: ${String(e)}`); }
    }
    setPublished(out); setBusy(false); setStep(4);
  }

  async function doManifest() {
    if (!plan?.buildVersion || published.length === 0) return;
    setBusy(true);
    try {
      const assets: ManifestAsset[] = published.map((p) => ({ ...p }));
      const manifest = buildInstallerManifest({ product: 'chayuan', version: plan.buildVersion, assets });
      const json = JSON.stringify(manifest, null, 2);
      const bytes = new TextEncoder().encode(json);
      // 经上传通道把 installer-manifest.json 放到 public/downloads
      const init = await invoke<{ uploadId: string; chunkSize: number; totalChunks: number }>('http_json', {
        method: 'POST', path: '/api/admin/uploads/init',
        body: { product: 'chayuan', version: plan.buildVersion, platform: '_meta', filename: 'installer-manifest.json', size: bytes.length },
      });
      const tmpPath = await invoke<string>('write_temp', { filename: 'installer-manifest.json', contents: Array.from(bytes) });
      await invoke('upload_chunks', { uploadId: init.uploadId, uploadPath: '/api/admin/uploads', filePath: tmpPath,
        chunkSize: init.chunkSize, totalChunks: init.totalChunks, indices: Array.from({ length: init.totalChunks }, (_, i) => i) });
      await invoke('http_json', { method: 'POST', path: `/api/admin/uploads/${init.uploadId}/finalize`,
        body: { variant: 'manifest', primary: true, notes: '' } });
      setStep(5);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  // ---- 渲染(精简,核心结构;样式可后续打磨)----
  return (
    <div style={{ fontFamily: 'system-ui', padding: 20, maxWidth: 920, margin: '0 auto' }}>
      <h2>察元发布客户端</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['登录', '检测', '上传', '发布', '清单'] as const).map((label, i) => (
          <span key={label} style={{ fontWeight: step === i + 1 ? 700 : 400, color: step >= i + 1 ? '#2563eb' : '#999' }}>
            {i + 1}.{label}
          </span>
        ))}
      </div>
      {err && <pre style={{ color: '#dc2626', whiteSpace: 'pre-wrap' }}>{err}</pre>}

      {step === 1 && (
        <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
          <input placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input placeholder="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input placeholder="验证码" value={captchaCode} onChange={(e) => setCaptchaCode(e.target.value)} />
            <span onClick={refreshCaptcha} style={{ cursor: 'pointer' }} dangerouslySetInnerHTML={{ __html: captcha?.svg ?? '' }} />
          </div>
          <button onClick={doLogin}>登录</button>
        </div>
      )}

      {step === 2 && (
        <div>
          <div style={{ display: 'grid', gap: 8, maxWidth: 560, marginBottom: 12 }}>
            <input placeholder="git 仓路径(取版本/changelog)" value={repo} onChange={(e) => setRepo(e.target.value)} />
            <input placeholder="构建产物目录" value={buildDir} onChange={(e) => setBuildDir(e.target.value)} />
            <button onClick={doDetect} disabled={busy || !buildDir}>检测</button>
          </div>
          {plan && (
            <>
              <p>本地 {plan.buildVersion ?? '?'} ↔ 线上 {plan.onlineVersion ?? '无'}（{plan.status}）</p>
              {plan.diagnostics.map((d, i) => <p key={i} style={{ color: '#d97706' }}>⚠ {d}</p>)}
              <table style={{ width: '100%', fontSize: 13 }}>
                <thead><tr><th></th><th>文件</th><th>平台</th><th>档位</th><th>线上</th></tr></thead>
                <tbody>
                  {plan.items.map((it, i) => (
                    <tr key={it.filename}>
                      <td><input type="checkbox" checked={it.selected} onChange={() => toggle(i)} /></td>
                      <td>{it.filename}</td>
                      <td>{it.platform ?? <input placeholder="平台" onBlur={(e) => setManual(i, { platform: e.target.value as DetectItem['platform'] })} />}</td>
                      <td>{it.tier ?? <select onChange={(e) => setManual(i, { tier: e.target.value as DetectItem['tier'] })}>
                        <option value="">选档</option><option value="lite">轻量版</option><option value="standard">集成版</option><option value="pro">全量版</option></select>}</td>
                      <td>{it.onlineState}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={doUploadPublish} disabled={busy}>上传并发布勾选项</button>
            </>
          )}
        </div>
      )}

      {step === 3 && (
        <div>
          <h3>上传中…</h3>
          {Object.entries(progress).map(([fn, p]) => (
            <div key={fn}>{fn}: {p.received}/{p.total}
              <progress value={p.received} max={p.total} style={{ width: '100%' }} /></div>
          ))}
        </div>
      )}

      {step === 4 && (
        <div>
          <h3>已发布 {published.length} 个离线包</h3>
          <ul>{published.map((p) => <li key={p.platform + p.tier}>{p.platform} / {TIER_VARIANT[p.tier]} → {p.url}</li>)}</ul>
          <button onClick={doManifest} disabled={busy}>生成并发布在线安装器清单</button>
        </div>
      )}

      {step === 5 && (
        <div>
          <h3>完成</h3>
          <p>本次离线包已发布,在线安装器清单已更新。</p>
          <ul>{published.map((p) => <li key={p.platform + p.tier}>{p.url}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
