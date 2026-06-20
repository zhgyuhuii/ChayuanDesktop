import * as React from 'react';
import { Button } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import { mcp, type McpProfile } from '@chayuan/api';
import { KvEditor } from './KvEditor';

export const McpProfilePanel: React.FC = () => {
  const q = useQuery<McpProfile>({ queryKey: ['admin', 'mcp', 'profile'], queryFn: () => mcp.profile.get(), staleTime: 30_000 });
  const [timeout, setTimeout_] = React.useState(30);
  const [workingDir, setWorkingDir] = React.useState('/tmp');
  const [envVars, setEnvVars] = React.useState<Record<string, string>>({});
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (q.data) { setTimeout_(q.data.timeout); setWorkingDir(q.data.working_dir); setEnvVars(q.data.env_vars ?? {}); }
  }, [q.data]);

  const save = async () => { await mcp.profile.save({ timeout, working_dir: workingDir, env_vars: envVars }); setMsg('已保存'); void q.refetch(); };
  const reset = async () => { if (window.confirm('重置通用配置为默认值?')) { await mcp.profile.reset(); setMsg('已重置'); void q.refetch(); } };

  return (
    <div className="rounded-xl border p-4 space-y-2">
      <h3 className="text-sm font-semibold">通用配置 Profile</h3>
      <div className="flex gap-2 text-sm">
        <label className="w-32">超时(s)<input type="number" className="mt-1 w-full rounded border p-2" value={timeout} onChange={(e) => setTimeout_(Number(e.target.value))} /></label>
        <label className="flex-1">工作目录<input className="mt-1 w-full rounded border p-2" value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} /></label>
      </div>
      <div className="text-sm">默认环境变量<KvEditor value={envVars} onChange={setEnvVars} /></div>
      {msg ? <p className="text-xs text-emerald-600">{msg}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => void reset()}>重置</Button>
        <Button onClick={() => void save()}>保存</Button>
      </div>
    </div>
  );
};
