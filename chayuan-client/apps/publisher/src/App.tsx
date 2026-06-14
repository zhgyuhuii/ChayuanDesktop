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
const STEP_LABELS = ['登录', '检测', '上传', '发布', '清单'] as const;

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
  // 更新升级内容(自动取自 git changelog,可编辑;取不到则手动填)。版本级,所有上传项共用。
  const [notes, setNotes] = React.useState('');
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

  // 「浏览…」选目录,选中则写入对应输入框(取消选择返回 null,不动)。
  async function pickInto(setter: (v: string) => void) {
    try {
      const dir = await api.pickFolder();
      if (dir) setter(dir);
    } catch (e) { setErr(String(e)); }
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
      // 自动填充更新内容(取自 git 提交)。取不到为空 → 用户手动填。已手改过的不覆盖。
      setNotes((prev) => (prev.trim() ? prev : (git.changelog || '')));
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
    const notesTrimmed = notes.trim();
    for (const it of selected) {
      try {
        const variant = TIER_VARIANT[it.tier!];
        const sha = await api.hashFile(it.path);
        const init = await io.initUpload({ product: 'chayuan', version, platform: it.platform!, filename: it.filename, size: it.sizeBytes, sha256: sha });
        const received = await io.getReceived(init.uploadId);
        const missing = Array.from({ length: init.totalChunks }, (_, i) => i).filter((i) => !received.includes(i));
        // 批量上传缺失块(Rust 端 emit 进度)
        await io._runUpload(init.uploadId, it.filename, init.chunkSize, init.totalChunks, missing);
        const fin = await io.finalize(init.uploadId, { variant, primary: it.onlineState === 'new', notes: notesTrimmed });
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

  return (
    <div className="app">
      <h1 className="app-title">察元发布客户端</h1>

      <div className="steps">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const cls = step === n ? 'step active' : step > n ? 'step done' : 'step';
          return (
            <React.Fragment key={label}>
              {i > 0 && <span className="step-line" />}
              <span className={cls}><span className="step-num">{n}</span>{label}</span>
            </React.Fragment>
          );
        })}
      </div>

      {err && <pre className="err">{err}</pre>}

      {step === 1 && (
        <div className="card narrow">
          <h2 className="card-title">登录</h2>
          <div className="field">
            <label>用户名</label>
            <input className="input" placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="field">
            <label>密码</label>
            <input className="input" placeholder="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="field">
            <label>验证码</label>
            <div className="row">
              <input className="input" placeholder="验证码" value={captchaCode} onChange={(e) => setCaptchaCode(e.target.value)} />
              <span className="captcha-svg" onClick={refreshCaptcha} title="点击刷新" dangerouslySetInnerHTML={{ __html: captcha?.svg ?? '' }} />
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-primary" onClick={doLogin}>登录</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <>
          <div className="card">
            <h2 className="card-title">源配置</h2>
            <div className="field">
              <label>git 仓路径(取版本 / 更新内容)</label>
              <div className="row">
                <input className="input" placeholder="例:/path/to/chayuan-desktop" value={repo} onChange={(e) => setRepo(e.target.value)} />
                <button className="btn btn-secondary" type="button" onClick={() => pickInto(setRepo)}>浏览…</button>
              </div>
            </div>
            <div className="field">
              <label>构建产物目录</label>
              <div className="row">
                <input className="input" placeholder="例:release/2.0.11/offline" value={buildDir} onChange={(e) => setBuildDir(e.target.value)} />
                <button className="btn btn-secondary" type="button" onClick={() => pickInto(setBuildDir)}>浏览…</button>
              </div>
            </div>
            <div className="actions">
              <button className="btn btn-primary" onClick={doDetect} disabled={busy || !buildDir}>{busy ? '检测中…' : '检测'}</button>
            </div>
          </div>

          {plan && (
            <>
              <div className="card">
                <h2 className="card-title">检测结果</h2>
                <p className="summary">
                  本地 <b>{plan.buildVersion ?? '?'}</b> ↔ 线上 <b>{plan.onlineVersion ?? '无'}</b>（{plan.status}）
                </p>
                {plan.diagnostics.map((d, i) => <p key={i} className="diag">⚠ {d}</p>)}
                <div className="table-wrap">
                  <table className="tbl">
                    <thead><tr><th></th><th>文件</th><th>平台</th><th>档位</th><th>线上</th></tr></thead>
                    <tbody>
                      {plan.items.map((it, i) => (
                        <tr key={it.filename}>
                          <td><input type="checkbox" checked={it.selected} onChange={() => toggle(i)} /></td>
                          <td className="fname">{it.filename}</td>
                          <td>{it.platform ?? <input className="input" placeholder="平台" onBlur={(e) => setManual(i, { platform: e.target.value as DetectItem['platform'] })} />}</td>
                          <td>{it.tier ?? (
                            <select className="select" onChange={(e) => setManual(i, { tier: e.target.value as DetectItem['tier'] })}>
                              <option value="">选档</option><option value="lite">轻量版</option><option value="standard">集成版</option><option value="pro">全量版</option>
                            </select>
                          )}</td>
                          <td><span className={it.onlineState === 'new' ? 'tag new' : 'tag'}>{it.onlineState}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <h2 className="card-title">更新升级内容<span className="sub">自动取自 git 提交,可编辑;取不到请手动填写</span></h2>
                <textarea
                  className="textarea"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="本次更新升级内容(每行一条)。检测时若读到 git 仓会自动填充,可在此增删修改;读不到则手动填写。"
                />
              </div>

              <div className="actions">
                <button className="btn btn-primary" onClick={doUploadPublish} disabled={busy}>上传并发布勾选项</button>
              </div>
            </>
          )}
        </>
      )}

      {step === 3 && (
        <div className="card">
          <h2 className="card-title">上传中…</h2>
          {Object.entries(progress).map(([fn, p]) => (
            <div key={fn} className="prog-row">
              <span className="name">{fn}: {p.received}/{p.total}</span>
              <progress value={p.received} max={p.total} />
            </div>
          ))}
        </div>
      )}

      {step === 4 && (
        <div className="card">
          <h2 className="card-title">已发布 {published.length} 个离线包</h2>
          <ul className="result-list">
            {published.map((p) => <li key={p.platform + p.tier}>{p.platform} / {TIER_VARIANT[p.tier]} → <code>{p.url}</code></li>)}
          </ul>
          <div className="actions">
            <button className="btn btn-primary" onClick={doManifest} disabled={busy}>{busy ? '生成中…' : '生成并发布在线安装器清单'}</button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="card">
          <h2 className="card-title">完成</h2>
          <p className="summary">本次离线包已发布,在线安装器清单已更新。</p>
          <ul className="result-list">
            {published.map((p) => <li key={p.platform + p.tier}><code>{p.url}</code></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
