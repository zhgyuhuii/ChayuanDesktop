import * as React from 'react';
import { Button, Dialog, DialogContent } from '@chayuan/ui';
import { adminUserPersona, type AdminUserRow, type PersonaResult } from '@chayuan/api';
import { AdminChart } from './AdminChart';

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const HOURS = Array.from({ length: 24 }, (_, i) => String(i));

const usageBar = (rec: Record<string, number> | undefined) => {
  const rows = Object.entries(rec ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 90, right: 16, top: 10, bottom: 20 },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: rows.map((r) => r[0]).reverse() },
    series: [{ type: 'bar', data: rows.map((r) => r[1]).reverse() }],
  };
};

const heatOption = (matrix: number[][] | undefined) => {
  const m = matrix ?? [];
  const data: Array<[number, number, number]> = [];
  let mx = 0;
  m.forEach((row, d) => row.forEach((v, h) => { data.push([h, d, v]); if (v > mx) mx = v; }));
  return {
    tooltip: { position: 'top' },
    grid: { left: 50, right: 16, top: 10, bottom: 24 },
    xAxis: { type: 'category', data: HOURS },
    yAxis: { type: 'category', data: DAYS },
    visualMap: { min: 0, max: Math.max(1, mx), calculable: true, orient: 'horizontal', left: 'center', bottom: 0 },
    series: [{ type: 'heatmap', data }],
  };
};

const Kpi: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border p-3">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="mt-1 text-lg font-semibold">{value}</div>
  </div>
);

export const UserPersonaDialog: React.FC<{ user: AdminUserRow; onClose(): void }> = ({ user, onClose }) => {
  const [persona, setPersona] = React.useState<PersonaResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const gen = async () => {
    setBusy(true);
    setErr(null);
    try {
      setPersona(await adminUserPersona(user.id));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] w-full max-w-3xl overflow-auto sm:max-w-3xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{user.username} · 用户画像</h2>
        </div>
        <div className="text-xs text-muted-foreground">#{user.id} · {user.role} · {user.is_active ? '启用' : '停用'} · {user.email}</div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="消息数" value={String(user.msg_count)} />
          <Kpi label="估算 tokens" value={String(user.est_tokens)} />
          <Kpi label="反馈均分" value={user.avg_feedback != null ? user.avg_feedback.toFixed(1) : '—'} />
          <Kpi label="最近活跃" value={user.last_active ? new Date(user.last_active).toLocaleDateString() : '—'} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-xl border p-2"><div className="px-2 py-1 text-sm font-medium">模型使用</div><AdminChart option={usageBar(user.model_usage)} height={200} /></div>
          <div className="rounded-xl border p-2"><div className="px-2 py-1 text-sm font-medium">工具使用</div><AdminChart option={usageBar(user.tool_usage)} height={200} /></div>
          <div className="rounded-xl border p-2"><div className="px-2 py-1 text-sm font-medium">知识库使用</div><AdminChart option={usageBar(user.kb_usage)} height={200} /></div>
          <div className="rounded-xl border p-2"><div className="px-2 py-1 text-sm font-medium">对话类型</div><AdminChart option={usageBar(user.chat_type_usage)} height={200} /></div>
        </div>

        <div className="mt-3 rounded-xl border p-2">
          <div className="px-2 py-1 text-sm font-medium">个人活跃热力(7×24)</div>
          <AdminChart option={heatOption(user.heatmap)} height={220} />
        </div>

        <div className="mt-3 rounded-xl border p-2">
          <div className="px-2 py-1 text-sm font-medium">最近提问</div>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="p-1">时间</th><th className="p-1">类型</th><th className="p-1">模型</th><th className="p-1">提问</th></tr></thead>
            <tbody>
              {(user.recent_queries ?? []).map((rq, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1">{rq.time?.slice(0, 16)}</td>
                  <td className="p-1">{rq.chat_type}</td>
                  <td className="p-1">{rq.model}</td>
                  <td className="p-1">{rq.query}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 rounded-xl border bg-slate-900 p-4 text-slate-100">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">AI 画像分析</span>
            <Button disabled={busy} onClick={() => void gen()}>{busy ? '生成中…' : persona ? '重新生成' : '生成画像'}</Button>
          </div>
          {err ? <p className="text-sm text-red-300">{err}</p> : null}
          {persona ? (
            <>
              <div className="mb-2 text-xs text-sky-300">模型：{persona.model}</div>
              <pre className="whitespace-pre-wrap break-words text-sm text-slate-100">{persona.analysis}</pre>
            </>
          ) : (
            !err && <p className="text-sm text-slate-400">点「生成画像」让大模型分析该用户。</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
