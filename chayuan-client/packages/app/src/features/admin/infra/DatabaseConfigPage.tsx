/**
 * DatabaseConfigPage —— 管理控制台「数据库」域(P5,敏感)。
 * DB 类型下拉(sqlite/pg/mysql) + 动态字段 + 测试连接 + 建库(DDL,二次确认) + 保存(需重启)。
 * 复用后端 /api/v1/admin/db/{status,validate,create,save}。
 */
import * as React from 'react';
import { dbConfig, servicesConfig, BizError, type DbForm, type DbType, type DbValidateResult } from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw, Wifi, Save, DatabaseZap, RotateCcw, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { notifySuccess, notifyInfo, reportError } from '../../../store/errorDialog';
import { isDesktop, getPlatform } from '@chayuan/platform-shared';
import { confirmDialog } from '../../../store/confirmDialog';

const FIELD =
  'mt-1 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)] dark:bg-zinc-800';

const EMPTY: DbForm = {
  db_type: 'sqlite', sqlite_path: '', host: '', port: '', database: '', schema: '', username: '', password: '', charset: '',
};

type RestartPhase = 'idle' | 'banner' | 'restarting' | 'success' | 'timeout';

export const DatabaseConfigPage: React.FC = () => {
  const [form, setForm] = React.useState<DbForm>(EMPTY);
  const [types, setTypes] = React.useState<DbType[]>([]);
  const [summary, setSummary] = React.useState('');
  const [val, setVal] = React.useState<DbValidateResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  // Restart banner state
  const [restartPhase, setRestartPhase] = React.useState<RestartPhase>('idle');
  const [profileWarning, setProfileWarning] = React.useState(false);
  // Ref to cancel the polling loop on unmount
  const pollingAbortRef = React.useRef<{ cancelled: boolean }>({ cancelled: false });

  // Cancel any in-flight poll on unmount.
  // Mutate the LIVE ref in cleanup (not a captured object) so we always cancel the
  // currently-active polling session even if the ref object was swapped by doRestart.
  React.useEffect(() => {
    return () => { if (pollingAbortRef.current) pollingAbortRef.current.cancelled = true; };
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const s = await dbConfig.status();
      setForm(s.form || EMPTY);
      setTypes(s.db_types || []);
      setSummary(s.summary || '');
    } catch (e) {
      reportError(e, '读取数据库配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const curType = types.find((t) => t.key === form.db_type);
  const set = (k: keyof DbForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onType = (key: string) => {
    const t = types.find((x) => x.key === key);
    setForm((f) => ({
      ...f,
      db_type: key,
      port: f.port || (t?.default_port ? String(t.default_port) : ''),
      database: f.database || (t?.default_db ?? ''),
      schema: f.schema || (t?.default_schema ?? ''),
      charset: f.charset || (t?.default_charset ?? ''),
    }));
    setVal(null);
  };

  const doValidate = async () => {
    setBusy(true);
    setVal(null);
    try {
      setVal(await dbConfig.validate(form));
    } catch (e) {
      reportError(e, '测试失败');
    } finally {
      setBusy(false);
    }
  };

  const doCreate = async () => {
    if (
      !(await confirmDialog('将在目标服务器上执行 CREATE DATABASE。请确认连接信息正确,且你有权限。', {
        title: '创建数据库？',
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      const r = await dbConfig.create(form);
      if (r.ok) {
        notifySuccess('数据库已创建');
        await doValidate();
      } else {
        reportError(new Error(r.message || r.detail), '创建失败');
      }
    } catch (e) {
      reportError(e, '创建失败');
    } finally {
      setBusy(false);
    }
  };

  const doSave = async () => {
    if (
      !(await confirmDialog('保存后将热切换数据库连接,立即生效、无需重启。建议先「测试连接」。', {
        title: '保存数据库配置？',
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      const result = await dbConfig.save(form);
      if (result.restart_required) {
        // Show persistent banner — do NOT dismiss with a toast
        setProfileWarning(result.profile_warning ?? false);
        setRestartPhase('banner');
        await load();
      } else {
        // 热切换成功:已立即生效,无需重启。
        notifySuccess('已保存,数据库已热切换,立即生效');
        if (result.profile_warning) {
          // 单机版 + 非 sqlite:本次已生效,但下次重启 CHAYUAN_PROFILE 会把库改回 SQLite。
          notifyInfo(
            '注意:单机版下次重启会按 CHAYUAN_PROFILE 把数据库改回 SQLite',
            '如需长期使用外部数据库,请在部署配置中固化连接。',
          );
        }
        await load();
      }
    } catch (e) {
      reportError(e, '保存失败');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Poll dbConfig.status() every 2s until the server has demonstrably restarted, then timeout.
   *
   * IMPORTANT: DbStatus.configured is already `true` immediately after save — it only means
   * "a DB URI is configured", NOT "the server restarted". A naive `configured === true` check
   * would declare success on the very first poll, before the server has actually gone down →
   * false positive. So success requires `seenDown` first: we must observe the server go away
   * (a thrown status() = network error during restart) BEFORE a later successful status() return.
   * - seenDown && configured  → success (went away, came back)
   * - elapsed >= 60s          → timeout (manual-restart message; covers "bad new config never came back")
   * Thrown errors during the window are swallowed (server is still restarting).
   */
  const pollUntilHealthy = React.useCallback(async (guard: { cancelled: boolean }) => {
    let seenDown = false;
    const DEADLINE = Date.now() + 60_000;
    const INTERVAL = 2_000;

    while (Date.now() < DEADLINE) {
      if (guard.cancelled) return;
      await new Promise<void>((r) => setTimeout(r, INTERVAL));
      if (guard.cancelled) return;
      try {
        const s = await dbConfig.status();
        if (seenDown && s.configured) {
          // Only after the server demonstrably went down and came back.
          if (!guard.cancelled) {
            setRestartPhase('success');
            setSummary(s.summary || '');
          }
          return;
        }
        // Not yet seen down → this is the pre-restart server still up; keep waiting.
      } catch {
        // Server is down → restart in progress; keep polling.
        seenDown = true;
      }
    }
    // Deadline expired
    if (!guard.cancelled) {
      setRestartPhase('timeout');
    }
  }, []);

  const doRestart = async () => {
    setRestartPhase('restarting');
    // Create a fresh guard for this poll session; cancel any previous one
    pollingAbortRef.current.cancelled = true;
    const guard = { cancelled: false };
    pollingAbortRef.current = guard;

    try {
      if (isDesktop()) {
        // 单机版:后端拒绝远程重启,改由桌面端真重启本地 sidecar。
        const sc = getPlatform().sidecar;
        if (!sc?.restart) throw new Error('当前环境不支持本地重启');
        await sc.restart();
      } else {
        await servicesConfig.restart();
      }
    } catch (e) {
      // Two very different failure modes:
      //  (a) DEFINITIVE HTTP REJECTION — the server answered and refused (e.g. single-machine
      //      backend returns code:1, or a 4xx/5xx). The server is still UP; restarting won't
      //      happen. Surface the error, revert to the banner, and DO NOT poll (else the spinner
      //      would strand until the 60s timeout for no reason).
      //  (b) CONNECTION DROP / timeout — no HTTP response because the server is going/already
      //      down (the expected graceful-shutdown race). Fall through to polling: seenDown +
      //      deadline correctly resolve "came back" vs "never came back".
      const isDefinitiveRejection =
        e instanceof BizError &&
        (e.kind === 'biz' ||
          e.kind === 'forbidden' ||
          e.kind === 'auth' ||
          (e.kind === 'http' && typeof e.status === 'number' && e.status >= 400));
      if (isDefinitiveRejection) {
        reportError(e, '重启失败');
        setRestartPhase('banner');
        return;
      }
      // else: connection drop / timeout → server is shutting down, proceed to poll.
    }
    void pollUntilHealthy(guard);
  };

  const dismissBanner = () => {
    pollingAbortRef.current.cancelled = true;
    setRestartPhase('idle');
    setProfileWarning(false);
  };

  const isSqlite = curType ? !curType.has_host : form.db_type === 'sqlite';
  const isRestarting = restartPhase === 'restarting';

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">数据库配置</h2>
          <p className="mt-1 text-xs opacity-60">主业务数据库。改动热切换、立即生效(无需重启)。SQLite 仅适合单机/开发,生产建议 PostgreSQL。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </Button>
      </div>

      {summary && <div className="rounded-md bg-[var(--cy-surface-2)] px-3 py-2 text-xs">当前：{summary}</div>}

      {/* ── Restart Banner ── */}
      {restartPhase !== 'idle' && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-700 dark:bg-amber-950">
          {restartPhase === 'banner' && (
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="font-medium text-amber-800 dark:text-amber-200">
                  数据库配置已保存，需重启服务后生效
                </span>
              </div>
              {profileWarning && (
                <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300">
                  当前部署 profile（CHAYUAN_PROFILE）会在重启后把数据库覆盖回 sqlite，请检查 profile 配置后再重启。
                </div>
              )}
              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" onClick={() => void doRestart()} disabled={isRestarting}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> 立即重启
                </Button>
                <button
                  type="button"
                  className="text-xs text-amber-700 underline hover:no-underline dark:text-amber-400"
                  onClick={dismissBanner}
                >
                  稍后手动重启
                </button>
              </div>
            </div>
          )}

          {restartPhase === 'restarting' && (
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <span>正在重启，等待服务恢复…</span>
            </div>
          )}

          {restartPhase === 'success' && (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="text-emerald-800 dark:text-emerald-200">服务已恢复，新数据库配置已生效</span>
              <button
                type="button"
                className="ml-auto text-xs opacity-60 hover:opacity-100"
                onClick={dismissBanner}
              >
                关闭
              </button>
            </div>
          )}

          {restartPhase === 'timeout' && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>自动重启未完成，请手动重启 chayuan-server 容器后刷新页面。</span>
              </div>
              <button
                type="button"
                className="text-xs text-amber-700 underline hover:no-underline dark:text-amber-400"
                onClick={dismissBanner}
              >
                关闭
              </button>
            </div>
          )}
        </div>
      )}

      <label className="block text-xs">
        <span className="opacity-60">数据库类型</span>
        <select className={FIELD} value={form.db_type} onChange={(e) => onType(e.target.value)}>
          {types.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </label>

      {isSqlite ? (
        <label className="block text-xs">
          <span className="opacity-60">SQLite 文件路径（留空=默认 $CHAYUAN_ROOT/data/knowledge_base/info.db）</span>
          <input className={FIELD} value={form.sqlite_path} onChange={(e) => set('sqlite_path', e.target.value)} />
        </label>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs"><span className="opacity-60">主机 host <button type="button" className="ml-1 text-[var(--cy-brand-600)] hover:underline" onClick={() => set('host', form.db_type === 'mysql' ? 'mysql' : 'postgres')}>容器服务名</button></span>
            <input className={FIELD} value={form.host} onChange={(e) => set('host', e.target.value)} /></label>
          <label className="text-xs"><span className="opacity-60">端口 port</span>
            <input className={FIELD} value={form.port} onChange={(e) => set('port', e.target.value)} /></label>
          <label className="text-xs"><span className="opacity-60">数据库名 database</span>
            <input className={FIELD} value={form.database} onChange={(e) => set('database', e.target.value)} /></label>
          {curType?.has_schema && (
            <label className="text-xs"><span className="opacity-60">模式 schema</span>
              <input className={FIELD} value={form.schema} onChange={(e) => set('schema', e.target.value)} /></label>
          )}
          <label className="text-xs"><span className="opacity-60">用户名 username</span>
            <input className={FIELD} value={form.username} onChange={(e) => set('username', e.target.value)} /></label>
          <label className="text-xs"><span className="opacity-60">密码 password</span>
            <input type="password" className={FIELD} value={form.password} onChange={(e) => set('password', e.target.value)} /></label>
          {curType?.has_charset && (
            <label className="text-xs"><span className="opacity-60">字符集 charset</span>
              <input className={FIELD} value={form.charset} onChange={(e) => set('charset', e.target.value)} /></label>
          )}
        </div>
      )}

      {curType?.install_hint && <div className="text-[11px] opacity-50">{curType.install_hint}</div>}

      {val && (
        <div className={`rounded-md px-3 py-2 text-xs ${val.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
          {val.ok ? `连接成功。${val.uri_masked || ''}` : `失败：${val.message}`}
          {val.detail ? ` (${val.detail})` : ''}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button onClick={() => void doSave()} disabled={busy || isRestarting}>
          <Save className="mr-1.5 h-4 w-4" /> 保存
        </Button>
        <Button variant="outline" onClick={() => void doValidate()} disabled={busy || isRestarting}>
          <Wifi className="mr-1.5 h-4 w-4" /> 测试连接
        </Button>
        {val?.db_missing && (
          <Button variant="outline" onClick={() => void doCreate()} disabled={busy || isRestarting}>
            <DatabaseZap className="mr-1.5 h-4 w-4 text-amber-500" /> 立即创建数据库
          </Button>
        )}
      </div>
    </div>
  );
};
