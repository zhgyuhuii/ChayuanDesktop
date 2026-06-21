/**
 * DataDirPage —— 管理控制台「数据目录」域(P7)。
 * 展示当前 CHAYUAN_ROOT + 派生路径 + 来源诊断;支持写 shell rc(export CHAYUAN_ROOT)。
 * ⚠️ 容器内 CHAYUAN_ROOT 由 compose/env 决定,写 rc 对运行中的容器无效(会标注)。
 */
import * as React from 'react';
import { dataDirConfig, type DataDirInfo } from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw, Save } from 'lucide-react';
import { notifySuccess, reportError } from '../../../store/errorDialog';

const FIELD =
  'mt-1 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)] dark:bg-zinc-800';

export const DataDirPage: React.FC = () => {
  const [info, setInfo] = React.useState<DataDirInfo | null>(null);
  const [newRoot, setNewRoot] = React.useState('');
  const [shell, setShell] = React.useState('bash');
  const [rcPath, setRcPath] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const i = await dataDirConfig.info();
      setInfo(i);
      setNewRoot((r) => r || i.current_root);
      setRcPath((p) => p || i.default_rc[shell] || '');
    } catch (e) {
      reportError(e, '读取数据目录失败');
    } finally {
      setLoading(false);
    }
  }, [shell]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const onShell = (v: string) => {
    setShell(v);
    if (info) setRcPath(info.default_rc[v] || '');
  };

  const writeRc = async () => {
    if (!newRoot.trim()) return;
    setBusy(true);
    try {
      const r = await dataDirConfig.writeRc({ new_root: newRoot.trim(), shell, rc_path: rcPath.trim() || undefined });
      notifySuccess(`已${r.action === 'noop' ? '确认(无改动)' : '写入'} ${r.rc_path} — ${r.note}`);
    } catch (e) {
      reportError(e, '写入失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">数据目录</h2>
          <p className="mt-1 text-xs opacity-60">CHAYUAN_ROOT —— 所有数据 / 日志 / 知识库 / 模型的根目录。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </Button>
      </div>

      {info?.in_container && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          检测到容器环境：CHAYUAN_ROOT 由 docker compose 的 env 决定。下面「写入 rc」对运行中的容器**无效**,
          如需更改请改 compose 的 <code>CHAYUAN_ROOT</code> 环境变量并重建。
        </div>
      )}

      {info && (
        <div className="space-y-2 rounded-lg border border-[var(--cy-border-subtle)] p-4 text-xs">
          <div className="flex justify-between"><span className="opacity-60">当前根目录</span><b className="font-mono">{info.current_root}</b></div>
          <div className="flex justify-between"><span className="opacity-60">来源</span><span>{info.source} · {info.reason}</span></div>
          <div className="flex justify-between"><span className="opacity-60">$CHAYUAN_ROOT 环境变量</span><span className="font-mono">{info.env_value || '(未设置)'}</span></div>
          <div className="pt-1 opacity-60">派生路径：</div>
          {Object.entries(info.derived).map(([k, v]) => (
            <div key={k} className="flex justify-between pl-3"><span className="opacity-50">{k}</span><span className="font-mono">{v}</span></div>
          ))}
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-[var(--cy-border-subtle)] p-4">
        <div className="text-sm font-medium">切换数据目录（写 shell rc）</div>
        <label className="block text-xs">
          <span className="opacity-60">新的 CHAYUAN_ROOT</span>
          <input className={FIELD} value={newRoot} onChange={(e) => setNewRoot(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs">
            <span className="opacity-60">shell</span>
            <select className={FIELD} value={shell} onChange={(e) => onShell(e.target.value)}>
              {['bash', 'zsh', 'fish', 'sh'].map((sh) => (
                <option key={sh} value={sh}>{sh}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="opacity-60">rc 文件路径</span>
            <input className={FIELD} value={rcPath} onChange={(e) => setRcPath(e.target.value)} />
          </label>
        </div>
        <Button onClick={() => void writeRc()} disabled={busy}>
          <Save className="mr-1.5 h-4 w-4" /> 写入 rc
        </Button>
        <p className="text-[11px] opacity-50">写入后需新开终端 / source rc / 重启进程才生效;运行中的服务不会自动跟随。</p>
      </div>
    </div>
  );
};
