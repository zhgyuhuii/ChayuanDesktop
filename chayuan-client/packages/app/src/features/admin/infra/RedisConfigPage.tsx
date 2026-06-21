/**
 * RedisConfigPage —— 管理控制台「Redis」域(P3)。
 * 复用后端 /api/v1/admin/redis/{status,test,save,clear}。改 REDIS_URL 需重启生效。
 */
import * as React from 'react';
import { redisConfig, type RedisForm, type ConnResult } from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw, Wifi, Save, Trash2 } from 'lucide-react';
import { notifySuccess, reportError } from '../../../store/errorDialog';
import { confirmDialog } from '../../../store/confirmDialog';

const FIELD =
  'mt-1 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)] dark:bg-zinc-800';

const EMPTY: RedisForm = { scheme: 'redis', host: '127.0.0.1', port: '6379', db: '0', username: '', password: '' };

export const RedisConfigPage: React.FC = () => {
  const [form, setForm] = React.useState<RedisForm>(EMPTY);
  const [probe, setProbe] = React.useState<{ ok: boolean; reason: string } | null>(null);
  const [test, setTest] = React.useState<ConnResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const s = await redisConfig.status();
      setForm(s.form || EMPTY);
      setProbe(s.probe);
    } catch (e) {
      reportError(e, '读取 Redis 配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const set = (k: keyof RedisForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const doTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      setTest(await redisConfig.test(form));
    } catch (e) {
      reportError(e, '测试失败');
    } finally {
      setBusy(false);
    }
  };

  const doSave = async () => {
    setBusy(true);
    try {
      await redisConfig.save(form);
      notifySuccess('已保存 — 重启服务后生效');
      await load();
    } catch (e) {
      reportError(e, '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const doClear = async () => {
    if (!(await confirmDialog('清空后限流/缓存/队列将退化为单机内存模式,重启生效。', { title: '清空 REDIS_URL？', danger: true })))
      return;
    setBusy(true);
    try {
      await redisConfig.clear();
      notifySuccess('已清空 — 重启后生效');
      setForm(EMPTY);
      await load();
    } catch (e) {
      reportError(e, '清空失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Redis 配置</h2>
          <p className="mt-1 text-xs opacity-60">用于限流 / 缓存 / 任务队列。公网跨主机建议 rediss(TLS)。改动需重启服务。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </Button>
      </div>

      {probe && (
        <div className={`rounded-md px-3 py-2 text-xs ${probe.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          当前状态：{probe.ok ? '已连通' : `未连通(${probe.reason})`}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs">
          <span className="opacity-60">协议</span>
          <select className={FIELD} value={form.scheme} onChange={(e) => set('scheme', e.target.value)}>
            <option value="redis">redis（明文）</option>
            <option value="rediss">rediss（TLS）</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="opacity-60">DB 编号</span>
          <input className={FIELD} value={form.db} onChange={(e) => set('db', e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="opacity-60">主机 host</span>
          <input className={FIELD} value={form.host} onChange={(e) => set('host', e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="opacity-60">端口 port</span>
          <input className={FIELD} value={form.port} onChange={(e) => set('port', e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="opacity-60">用户名（ACL,可选）</span>
          <input className={FIELD} value={form.username} onChange={(e) => set('username', e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="opacity-60">密码（可选）</span>
          <input type="password" className={FIELD} value={form.password} onChange={(e) => set('password', e.target.value)} />
        </label>
      </div>

      {test && (
        <div className={`rounded-md px-3 py-2 text-xs ${test.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
          {test.ok ? `连通成功。${test.detail || ''}` : `失败：${test.message}`}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button onClick={() => void doSave()} disabled={busy}>
          <Save className="mr-1.5 h-4 w-4" /> 保存
        </Button>
        <Button variant="outline" onClick={() => void doTest()} disabled={busy}>
          <Wifi className="mr-1.5 h-4 w-4" /> 测试连通
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" onClick={() => void doClear()} disabled={busy}>
          <Trash2 className="mr-1.5 h-4 w-4 text-rose-500" /> 清空
        </Button>
      </div>
    </div>
  );
};
