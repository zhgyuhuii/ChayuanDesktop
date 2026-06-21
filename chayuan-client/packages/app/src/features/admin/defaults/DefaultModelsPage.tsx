/**
 * DefaultModelsPage —— 管理控制台「默认模型」域(P1)。
 *
 * 9 类 capability 的默认模型选择。读 GET /admin/capability_defaults(后端已自动把每个
 * cap 的第一个候选补成默认),下拉按 platform_name 分组(云厂商 / 本地)。切换即 POST 保存。
 * 候选来源:已启用的 model_platform + 本地 local_index。无候选 → 提示去模型平台配置。
 */
import * as React from 'react';
import {
  adminCapabilityDefaults,
  adminSetCapabilityDefaults,
  type CapabilityDefaults,
  type CapabilityCandidate,
} from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw } from 'lucide-react';
import { notifySuccess } from '../../../store/errorDialog';
import { reportError } from '../../../store/errorDialog';

const CAP_LABELS: Record<string, string> = {
  chat: '对话',
  embedding: '文本嵌入',
  clip: '图像嵌入',
  rerank: '重排',
  t2i: '文生图',
  t2v: '文生视频',
  tts: '语音合成',
  asr: '语音识别',
  ocr: '图像识别文字',
};

const CAP_HINT: Record<string, string> = {
  chat: '对话 / Agent 默认使用的大模型',
  embedding: '知识库检索的文本向量模型',
  clip: '图像向量化(以图搜图 / 多模态检索)',
  rerank: '检索结果重排序',
  t2i: '文生图默认模型',
  t2v: '文生 / 图生视频默认模型',
  tts: '语音合成默认音色模型',
  asr: '语音识别默认模型',
  ocr: '图片文字识别默认模型',
};

// 按 platform_name 分组候选,云厂商在前、本地(local-*)在后。
function groupByPlatform(
  list: CapabilityCandidate[],
): { platform: string; items: CapabilityCandidate[] }[] {
  const map = new Map<string, CapabilityCandidate[]>();
  for (const c of list) {
    const key = c.platform_name || c.runtime || '其它';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  const groups = Array.from(map.entries()).map(([platform, items]) => ({ platform, items }));
  groups.sort((a, b) => {
    const al = a.platform.startsWith('local') ? 1 : 0;
    const bl = b.platform.startsWith('local') ? 1 : 0;
    return al - bl || a.platform.localeCompare(b.platform);
  });
  return groups;
}

export const DefaultModelsPage: React.FC = () => {
  const [data, setData] = React.useState<CapabilityDefaults | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [savingCap, setSavingCap] = React.useState<string | null>(null);

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

  React.useEffect(() => {
    void load();
  }, [load]);

  const onPick = async (cap: string, modelId: string) => {
    if (!data) return;
    setSavingCap(cap);
    // 乐观更新
    const prev = data.defaults[cap] ?? null;
    setData({ ...data, defaults: { ...data.defaults, [cap]: modelId || null } });
    try {
      // 后端按 cap 逐条写盘并在 results[cap] 里回报成败;旧实现只要 HTTP 200 就当成功,
      // 一旦写盘失败(unknown cap / yaml 写盘异常)会"假装已设置",刷新后默认却是空的
      // —— 正是「设置之后没有默认」。这里必须检查 results[cap].ok。
      const res = await adminSetCapabilityDefaults({ [cap]: modelId });
      const r = res?.results?.[cap];
      if (r && r.ok === false) {
        throw new Error(r.error || '服务端未能保存默认模型');
      }
      notifySuccess(`已设置「${CAP_LABELS[cap] ?? cap}」默认模型`);
      // 写后回读服务端真值,确认确实落盘(杜绝"看似成功实际没默认")。
      await load();
    } catch (e) {
      // 回滚
      setData((d) => (d ? { ...d, defaults: { ...d.defaults, [cap]: prev } } : d));
      reportError(e, '保存默认模型失败');
    } finally {
      setSavingCap(null);
    }
  };

  const caps = data?.capabilities ?? Object.keys(CAP_LABELS);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">默认模型</h2>
          <p className="mt-1 text-xs opacity-60">
            为 9 类能力各指定一个默认模型。候选来自已配置的模型平台与本地模型;
            下拉按厂商 / 本地分组。修改即时生效(部分能力可能需重启服务)。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {loading && !data ? (
        <div className="py-12 text-center text-sm opacity-60">加载中…</div>
      ) : (
        <div className="space-y-3">
          {caps.map((cap) => {
            const list = data?.candidates[cap] ?? [];
            const groups = groupByPlatform(list);
            const value = data?.defaults[cap] ?? '';
            const empty = list.length === 0;
            return (
              <div
                key={cap}
                className="flex items-center gap-4 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-4 py-3"
              >
                <div className="w-28 shrink-0">
                  <div className="text-sm font-medium">{CAP_LABELS[cap] ?? cap}</div>
                  <div className="mt-0.5 text-[11px] leading-tight opacity-50">{CAP_HINT[cap] ?? ''}</div>
                </div>
                <div className="min-w-0 flex-1">
                  {empty ? (
                    <div className="text-xs opacity-50">
                      无可用模型 —— 请先在「模型平台」配置并启用对应能力的模型。
                    </div>
                  ) : (
                    <select
                      className="w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)] disabled:opacity-50 dark:bg-zinc-800"
                      value={value}
                      disabled={savingCap === cap}
                      onChange={(e) => void onPick(cap, e.target.value)}
                    >
                      <option value="">（未设置）</option>
                      {groups.map((g) => (
                        <optgroup key={g.platform} label={g.platform}>
                          {g.items.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.id}
                            </option>
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
