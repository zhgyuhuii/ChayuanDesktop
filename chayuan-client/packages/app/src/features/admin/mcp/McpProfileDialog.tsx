/**
 * McpProfileDialog —— MCP「通用配置 Profile」弹窗(#6)。
 * 原常驻展开面板改为弹窗:由连接列表工具栏「通用配置」按钮触发。
 * window.confirm 改用项目 confirmDialog(桌面版铁律)。
 */
import * as React from 'react';
import { Button } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import { mcp, type McpProfile } from '@chayuan/api';
import { KvEditor } from './KvEditor';
import { confirmDialog } from '../../../store/confirmDialog';
import { notifySuccess, reportError } from '../../../store/errorDialog';
import { X } from 'lucide-react';

export const McpProfileDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const q = useQuery<McpProfile>({ queryKey: ['admin', 'mcp', 'profile'], queryFn: () => mcp.profile.get(), staleTime: 30_000 });
  const [timeout, setTimeout_] = React.useState(30);
  const [workingDir, setWorkingDir] = React.useState('/tmp');
  const [envVars, setEnvVars] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (q.data) { setTimeout_(q.data.timeout); setWorkingDir(q.data.working_dir); setEnvVars(q.data.env_vars ?? {}); }
  }, [q.data]);

  const save = async () => {
    setBusy(true);
    try {
      await mcp.profile.save({ timeout, working_dir: workingDir, env_vars: envVars });
      notifySuccess('已保存通用配置');
      void q.refetch();
      onClose();
    } catch (e) { reportError(e, '保存失败'); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!(await confirmDialog('重置通用配置为默认值？', { title: '重置通用配置', danger: true }))) return;
    setBusy(true);
    try {
      await mcp.profile.reset();
      notifySuccess('已重置');
      void q.refetch();
    } catch (e) { reportError(e, '重置失败'); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--cy-border-subtle)] px-5 py-3">
          <h3 className="text-sm font-semibold">MCP 通用配置</h3>
          <button onClick={onClose} className="opacity-50 hover:opacity-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-xs text-muted-foreground">所有 MCP 连接共用的默认超时 / 工作目录 / 环境变量;单个连接可在其编辑窗里覆盖。</p>
          <div className="flex gap-2 text-sm">
            <label className="w-32">超时(s)<input type="number" className="mt-1 w-full rounded border p-2" value={timeout} onChange={(e) => setTimeout_(Number(e.target.value))} /></label>
            <label className="flex-1">工作目录<input className="mt-1 w-full rounded border p-2" value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} /></label>
          </div>
          <div className="text-sm">默认环境变量<KvEditor value={envVars} onChange={setEnvVars} /></div>
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--cy-border-subtle)] px-5 py-3">
          <Button onClick={() => void save()} disabled={busy}>保存</Button>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <span className="flex-1" />
          <Button variant="ghost" onClick={() => void reset()} disabled={busy}>重置为默认</Button>
        </div>
      </div>
    </div>
  );
};
