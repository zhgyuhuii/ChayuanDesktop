/**
 * DefaultModelsPage —— 管理控制台「默认模型」域(#4 卡片化)。
 * 9 类 capability 卡片网格(一行 4 个,带图标/配色/状态);每卡内下拉切换默认模型。
 * 读 GET /admin/capability_defaults(后端已把每个 cap 第一个候选补成默认),切换即 POST。
 * 候选来源:已启用 model_platform + 本地 local_index;无候选 → 引导去模型平台。
 */
import * as React from 'react';
import {
  adminCapabilityDefaults,
  adminSetCapabilityDefaults,
  type CapabilityDefaults,
  type CapabilityCandidate,
} from '@chayuan/api';
import { Button, cn } from '@chayuan/ui';
import {
  RefreshCw, MessageSquare, Layers, Image as ImageIcon, ArrowUpDown,
  ImagePlus, Video, Volume2, Mic, ScanText, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { notifySuccess, reportError } from '../../../store/errorDialog';
import { useNavigate } from '@tanstack/react-router';
import { groupCandidatesByPlatform } from '../../aiPlatform/modelGrouping';

type CapMeta = { label: string; hint: string; icon: React.ComponentType<{ className?: string }>; accent: string; chip: string };
const CAP_META: Record<string, CapMeta> = {
  chat:      { label: '对话',       hint: '对话 / Agent 默认大模型',     icon: MessageSquare, accent: 'from-blue-500/15',    chip: 'text-blue-600' },
  embedding: { label: '文本嵌入',   hint: '知识库检索的文本向量模型',     icon: Layers,        accent: 'from-indigo-500/15',  chip: 'text-indigo-600' },
  clip:      { label: '图像嵌入',   hint: '以图搜图 / 多模态检索',        icon: ImageIcon,     accent: 'from-purple-500/15',  chip: 'text-purple-600' },
  rerank:    { label: '重排',       hint: '检索结果重排序',               icon: ArrowUpDown,   accent: 'from-teal-500/15',    chip: 'text-teal-600' },
  t2i:       { label: '文生图',     hint: '文生图默认模型',               icon: ImagePlus,     accent: 'from-pink-500/15',    chip: 'text-pink-600' },
  t2v:       { label: '文生视频',   hint: '文生 / 图生视频默认模型',      icon: Video,         accent: 'from-rose-500/15',    chip: 'text-rose-600' },
  tts:       { label: '语音合成',   hint: '语音合成默认音色模型',         icon: Volume2,       accent: 'from-amber-500/15',   chip: 'text-amber-600' },
  asr:       { label: '语音识别',   hint: '语音识别默认模型',             icon: Mic,           accent: 'from-green-500/15',   chip: 'text-green-600' },
  ocr:       { label: '图像识别文字', hint: '图片文字识别默认模型',        icon: ScanText,      accent: 'from-cyan-500/15',    chip: 'text-cyan-600' },
};
const CAP_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(CAP_META).map(([k, v]) => [k, v.label]),
);
// 展示顺序:对话→文本嵌入→重排 置顶,其余随后。显式定序,与服务端 capabilities 返回序/CAP_META 声明序无关。
const CAP_DISPLAY_ORDER = ['chat', 'embedding', 'rerank', 'clip', 't2i', 't2v', 'tts', 'asr', 'ocr'];
const capRank = (c: string): number => { const i = CAP_DISPLAY_ORDER.indexOf(c); return i < 0 ? CAP_DISPLAY_ORDER.length : i; };

export const DefaultModelsPage: React.FC = () => {
  const [data, setData] = React.useState<CapabilityDefaults | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [savingCap, setSavingCap] = React.useState<string | null>(null);
  const navigate = useNavigate();

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setData(await adminCapabilityDefaults());
    } catch (e) {
      reportError(e, '读取默认模型失败');
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const onPick = async (cap: string, modelId: string) => {
    if (!data) return;
    setSavingCap(cap);
    const prev = data.defaults[cap] ?? null;
    setData({ ...data, defaults: { ...data.defaults, [cap]: modelId || null } });
    try {
      // #5:必须检查 results[cap].ok,否则写盘失败会"假成功",刷新后无默认。
      const res = await adminSetCapabilityDefaults({ [cap]: modelId });
      const r = res?.results?.[cap];
      if (r && r.ok === false) throw new Error(r.error || '服务端未能保存默认模型');
      notifySuccess(`已设置「${CAP_LABELS[cap] ?? cap}」默认模型`);
      await load(); // 写后回读真值
    } catch (e) {
      setData((d) => (d ? { ...d, defaults: { ...d.defaults, [cap]: prev } } : d));
      reportError(e, '保存默认模型失败');
    } finally {
      setSavingCap(null);
    }
  };

  const caps = [...(data?.capabilities ?? CAP_DISPLAY_ORDER)].sort((a, b) => capRank(a) - capRank(b));

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">默认模型</h2>
          <p className="mt-1 text-xs opacity-60">为 9 类能力各指定默认模型。候选来自已配置的模型平台与本地模型。修改即时生效(部分能力需重启)。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </Button>
      </div>

      {loading && !data ? (
        <div className="py-12 text-center text-sm opacity-60">加载中…</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {caps.map((cap) => {
            const meta = CAP_META[cap] ?? { label: cap, hint: '', icon: MessageSquare, accent: 'from-zinc-500/10', chip: 'text-zinc-600' };
            const Icon = meta.icon;
            const list = data?.candidates[cap] ?? [];
            const groups = groupCandidatesByPlatform(list);
            const value = data?.defaults[cap] ?? '';
            const empty = list.length === 0;
            const saving = savingCap === cap;
            return (
              <div key={cap} className="overflow-hidden rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]">
                <div className={cn('flex items-center gap-2 bg-gradient-to-r to-transparent px-4 py-3', meta.accent)}>
                  <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cy-surface-base)]', meta.chip)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{meta.label}</div>
                    <div className="truncate text-[10px] opacity-50">{meta.hint}</div>
                  </div>
                </div>
                <div className="space-y-2 px-4 py-3">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    {empty ? (
                      <><AlertCircle className="h-3.5 w-3.5 text-amber-500" /><span className="text-amber-600">无可用模型</span></>
                    ) : value ? (
                      <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /><span className="text-emerald-600">已设置</span></>
                    ) : (
                      <><AlertCircle className="h-3.5 w-3.5 text-zinc-400" /><span className="opacity-50">未设置</span></>
                    )}
                    {saving && <span className="ml-auto opacity-40">保存中…</span>}
                  </div>
                  {empty ? (
                    <div className="space-y-1">
                      <p className="text-[11px] leading-snug opacity-50">该能力暂无候选,请先在「模型平台」配置并<b>启用</b>对应模型。</p>
                      <button className="text-[11px] text-[var(--cy-brand-600)] hover:underline" onClick={() => void navigate({ to: '/admin/$tab', params: { tab: 'platforms' } })}>去模型平台配置 →</button>
                    </div>
                  ) : (
                    <select
                      className="w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-2 text-xs outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)] disabled:opacity-50 dark:bg-zinc-800"
                      value={value}
                      disabled={saving}
                      onChange={(e) => void onPick(cap, e.target.value)}
                    >
                      <option value="">（未设置）</option>
                      {groups.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.items.map((c) => (
                            <option key={c.id} value={c.id}>{c.id}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
