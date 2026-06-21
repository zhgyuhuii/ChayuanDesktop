/**
 * ModelPlatformsPage —— 管理控制台「模型平台」域(P2,替代旧 PlatformAdmin 薄壳)。
 *
 * 左:厂商目录(catalog,~60 家,按标签分组 + 搜索),卡片显示配置/启用态。
 * 右:选中厂商的完整编辑面板 —— api_base_url / api_key / 并发 / auto_detect /
 *     8 类模型清单(增删 + 启停)/ 测试连通+拉模型 / 保存 / 删除(自定义) / 申请Key链接。
 * 顶:新增自定义 OpenAI 兼容平台。
 *
 * 复用既有后端: GET catalog · PATCH(upsert) · POST(create) · DELETE · POST test。
 */
import * as React from 'react';
import {
  modelPlatform,
  type ProviderCatalogEntry,
  type PlatformPatch,
  type PlatformTestResult,
} from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw, Plus, Trash2, Wifi, Save, X, ExternalLink } from 'lucide-react';
import { notifySuccess, reportError } from '../../../store/errorDialog';
import { promptDialog } from '../../../store/promptDialog';
import { confirmDialog } from '../../../store/confirmDialog';

const MODEL_FIELDS: { key: keyof ProviderCatalogEntry; label: string }[] = [
  { key: 'llm_models', label: '对话' },
  { key: 'embed_models', label: '嵌入' },
  { key: 'rerank_models', label: '重排' },
  { key: 'text2image_models', label: '文生图' },
  { key: 'text2video_models', label: '文生视频' },
  { key: 'image2text_models', label: '图生文/视觉' },
  { key: 'speech2text_models', label: '语音识别' },
  { key: 'text2speech_models', label: '语音合成' },
];

const TAG_ORDER = ['推荐', '国内', '国外', '本地', '聚合', '自定义'];

type Draft = {
  api_base_url: string;
  api_key: string;
  api_concurrencies: number;
  auto_detect_model: boolean;
  enabled: boolean;
  platform_type: string;
  models: Record<string, string[]>;
  disabled: Set<string>;
};

function entryToDraft(e: ProviderCatalogEntry): Draft {
  const models: Record<string, string[]> = {};
  for (const f of MODEL_FIELDS) models[f.key as string] = [...((e[f.key] as string[]) ?? [])];
  return {
    api_base_url: e.api_base_url || e.default_api_base || '',
    api_key: '',
    api_concurrencies: e.api_concurrencies || 5,
    auto_detect_model: !!e.auto_detect_model,
    enabled: !!e.enabled,
    platform_type: e.platform_type || 'openai',
    models,
    disabled: new Set(e.disabled_models ?? []),
  };
}

function Avatar({ e }: { e: ProviderCatalogEntry }) {
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
      style={{ background: e.color || '#6b7280' }}
    >
      {(e.display_name || e.pid).slice(0, 1).toUpperCase()}
    </div>
  );
}

export const ModelPlatformsPage: React.FC = () => {
  const [catalog, setCatalog] = React.useState<ProviderCatalogEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [tag, setTag] = React.useState<string>('全部');
  const [q, setQ] = React.useState('');
  const [selPid, setSelPid] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [test, setTest] = React.useState<PlatformTestResult | null>(null);

  const load = React.useCallback(async (keepSel?: string) => {
    setLoading(true);
    try {
      const list = await modelPlatform.catalog();
      setCatalog(list);
      if (keepSel) {
        const e = list.find((x) => x.pid === keepSel);
        if (e) setDraft(entryToDraft(e));
      }
    } catch (e) {
      reportError(e, '加载厂商目录失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const selected = catalog.find((e) => e.pid === selPid) || null;

  const openEdit = (e: ProviderCatalogEntry) => {
    setSelPid(e.pid);
    setDraft(entryToDraft(e));
    setTest(null);
  };

  const tags = React.useMemo(() => {
    const s = new Set<string>();
    catalog.forEach((e) => e.tags.forEach((t) => s.add(t)));
    return ['全部', ...TAG_ORDER.filter((t) => s.has(t)), ...Array.from(s).filter((t) => !TAG_ORDER.includes(t))];
  }, [catalog]);

  const visible = catalog.filter((e) => {
    if (tag !== '全部' && !e.tags.includes(tag)) return false;
    if (q && !`${e.display_name} ${e.pid}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const patchFromDraft = (d: Draft): PlatformPatch => {
    const p: PlatformPatch = {
      api_base_url: d.api_base_url.trim(),
      api_concurrencies: d.api_concurrencies,
      auto_detect_model: d.auto_detect_model,
      enabled: d.enabled,
      platform_type: d.platform_type,
      disabled_models: Array.from(d.disabled),
    };
    if (d.api_key.trim()) p.api_key = d.api_key.trim();
    for (const f of MODEL_FIELDS) {
      (p as Record<string, unknown>)[f.key as string] = d.models[f.key as string] ?? [];
    }
    return p;
  };

  const save = async () => {
    if (!selected || !draft) return;
    setBusy(true);
    try {
      await modelPlatform.update(selected.pid, patchFromDraft(draft));
      notifySuccess('已保存');
      await load(selected.pid);
    } catch (e) {
      reportError(e, '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const quickToggleEnabled = async (e: ProviderCatalogEntry) => {
    try {
      await modelPlatform.update(e.pid, { enabled: !e.enabled });
      await load(selPid ?? undefined);
    } catch (err) {
      reportError(err, '切换启用失败');
    }
  };

  const runTest = async () => {
    if (!selected) return;
    setBusy(true);
    setTest(null);
    try {
      // 先存当前 base_url/key 再测(测试读 DB 配置)
      if (draft) await modelPlatform.update(selected.pid, patchFromDraft(draft));
      const r = await modelPlatform.test(selected.pid);
      setTest(r);
      if (r.reachable) notifySuccess('连通成功');
    } catch (e) {
      reportError(e, '测试失败');
    } finally {
      setBusy(false);
    }
  };

  const addDetected = () => {
    if (!test || !draft) return;
    const next = { ...draft, models: { ...draft.models } };
    for (const f of MODEL_FIELDS) {
      const ids = test.detected[f.key as string] ?? [];
      if (ids.length) {
        const set = new Set([...(next.models[f.key as string] ?? []), ...ids]);
        next.models[f.key as string] = Array.from(set);
      }
    }
    setDraft(next);
  };

  const removeModel = (field: string, id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      models: { ...draft.models, [field]: (draft.models[field] ?? []).filter((m) => m !== id) },
    });
  };

  const addModel = async (field: string) => {
    if (!draft) return;
    const id = (await promptDialog('输入 model id', { title: '添加模型' }))?.trim();
    if (!id) return;
    setDraft({
      ...draft,
      models: { ...draft.models, [field]: Array.from(new Set([...(draft.models[field] ?? []), id])) },
    });
  };

  const toggleModel = (id: string) => {
    if (!draft) return;
    const dis = new Set(draft.disabled);
    if (dis.has(id)) dis.delete(id);
    else dis.add(id);
    setDraft({ ...draft, disabled: dis });
  };

  const del = async () => {
    if (!selected) return;
    if (
      !(await confirmDialog('将删除该平台的 DB 配置（内置 seed 仍可兜底）。', {
        title: `删除平台「${selected.display_name}」？`,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await modelPlatform.delete(selected.pid);
      notifySuccess('已删除');
      setSelPid(null);
      setDraft(null);
      await load();
    } catch (e) {
      reportError(e, '删除失败');
    } finally {
      setBusy(false);
    }
  };

  const addCustom = async () => {
    const name = (
      await promptDialog('平台名(英文/唯一,如 my-openai)', { title: '新增自定义平台' })
    )?.trim();
    if (!name) return;
    setBusy(true);
    try {
      await modelPlatform.create({ platform_name: name, platform_type: 'openai', enabled: true });
      notifySuccess('已创建');
      await load(name);
      setSelPid(name);
    } catch (e) {
      reportError(e, '创建失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      {/* 左:厂商目录 */}
      <div className="flex w-80 shrink-0 flex-col border-r border-[var(--cy-border-subtle)]">
        <div className="flex items-center gap-2 p-3">
          <input
            className="min-w-0 flex-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2.5 py-1.5 text-sm outline-none dark:bg-zinc-800"
            placeholder="搜索厂商…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button variant="ghost" size="icon" onClick={() => void load(selPid ?? undefined)} title="刷新">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {tags.map((t) => (
            <button
              key={t}
              onClick={() => setTag(t)}
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                tag === t ? 'bg-[var(--cy-brand-500)] text-white' : 'bg-[var(--cy-surface-2)] opacity-70'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
          {visible.map((e) => (
            <button
              key={e.pid}
              onClick={() => openEdit(e)}
              className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${
                selPid === e.pid ? 'bg-[var(--cy-brand-500)]/12' : 'hover:bg-[var(--cy-surface-2)]'
              }`}
            >
              <Avatar e={e} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{e.display_name}</div>
                <div className="flex items-center gap-1 text-[10px] opacity-60">
                  {e.configured ? <span className="text-emerald-600">已配置</span> : <span>未配置</span>}
                  {e._custom && <span>· 自定义</span>}
                </div>
              </div>
              <span
                className={`h-2 w-2 rounded-full ${e.enabled ? 'bg-emerald-500' : 'bg-zinc-300'}`}
                title={e.enabled ? '已启用' : '未启用'}
              />
            </button>
          ))}
          <button
            onClick={() => void addCustom()}
            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--cy-border-subtle)] py-2 text-xs opacity-70 hover:opacity-100"
          >
            <Plus className="h-3.5 w-3.5" /> 新增自定义平台
          </button>
        </div>
      </div>

      {/* 右:编辑面板 */}
      <div className="min-w-0 flex-1 overflow-auto">
        {!selected || !draft ? (
          <div className="flex h-full items-center justify-center text-sm opacity-50">
            从左侧选择一个厂商进行配置
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4 p-6">
            <div className="flex items-center gap-3">
              <Avatar e={selected} />
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold">{selected.display_name}</div>
                <div className="text-xs opacity-50">
                  {selected.pid} · {draft.platform_type}
                </div>
              </div>
              {selected.apply_key_url && (
                <a
                  href={selected.apply_key_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[var(--cy-brand-500)] hover:underline"
                >
                  申请 API Key <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 text-xs">
                <span className="opacity-60">API Base URL</span>
                <input
                  className="mt-1 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm outline-none dark:bg-zinc-800"
                  placeholder={selected.default_api_base}
                  value={draft.api_base_url}
                  onChange={(e) => setDraft({ ...draft, api_base_url: e.target.value })}
                />
              </label>
              <label className="col-span-2 text-xs">
                <span className="opacity-60">API Key（留空=不修改已存的）</span>
                <input
                  type="password"
                  className="mt-1 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm outline-none dark:bg-zinc-800"
                  placeholder={selected.configured ? '已配置（••••）' : '未配置'}
                  value={draft.api_key}
                  onChange={(e) => setDraft({ ...draft, api_key: e.target.value })}
                />
              </label>
              <label className="text-xs">
                <span className="opacity-60">并发数</span>
                <input
                  type="number"
                  min={1}
                  className="mt-1 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm outline-none dark:bg-zinc-800"
                  value={draft.api_concurrencies}
                  onChange={(e) => setDraft({ ...draft, api_concurrencies: Number(e.target.value) || 1 })}
                />
              </label>
              {selected._custom && (
                <label className="text-xs">
                  <span className="opacity-60">平台类型</span>
                  <input
                    className="mt-1 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm outline-none dark:bg-zinc-800"
                    value={draft.platform_type}
                    onChange={(e) => setDraft({ ...draft, platform_type: e.target.value })}
                  />
                </label>
              )}
              <label className="col-span-2 flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                  />
                  启用平台
                </span>
                <span className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.auto_detect_model}
                    onChange={(e) => setDraft({ ...draft, auto_detect_model: e.target.checked })}
                  />
                  自动探测模型
                </span>
              </label>
            </div>

            {/* 8 类模型 */}
            <div className="space-y-2">
              {MODEL_FIELDS.map((f) => {
                const ids = draft.models[f.key as string] ?? [];
                return (
                  <div key={f.key as string} className="rounded-lg border border-[var(--cy-border-subtle)] p-2.5">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-medium opacity-70">{f.label}</span>
                      <button
                        className="text-[11px] text-[var(--cy-brand-500)] hover:underline"
                        onClick={() => void addModel(f.key as string)}
                      >
                        + 添加
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {ids.length === 0 && <span className="text-[11px] opacity-40">无</span>}
                      {ids.map((id) => {
                        const off = draft.disabled.has(id);
                        return (
                          <span
                            key={id}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                              off ? 'opacity-40 line-through' : 'border-[var(--cy-border-subtle)]'
                            }`}
                          >
                            <button onClick={() => toggleModel(id)} title={off ? '点击启用' : '点击禁用'}>
                              {id}
                            </button>
                            <button onClick={() => removeModel(f.key as string, id)} title="移除">
                              <X className="h-3 w-3 opacity-50 hover:opacity-100" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 测试结果 */}
            {test && (
              <div
                className={`rounded-md px-3 py-2 text-xs ${
                  test.reachable ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                }`}
              >
                {test.reachable ? '连通成功。' : `失败：${test.error}`}
                {test.reachable && Object.values(test.detected).some((a) => a.length) && (
                  <button className="ml-2 underline" onClick={addDetected}>
                    把探测到的模型加入清单
                  </button>
                )}
              </div>
            )}

            {/* 操作 */}
            <div className="flex items-center gap-2 pt-1">
              <Button onClick={() => void save()} disabled={busy}>
                <Save className="mr-1.5 h-4 w-4" /> 保存
              </Button>
              <Button variant="outline" onClick={() => void runTest()} disabled={busy}>
                <Wifi className="mr-1.5 h-4 w-4" /> 测试连通
              </Button>
              <Button variant="outline" onClick={() => void quickToggleEnabled(selected)} disabled={busy}>
                {selected.enabled ? '停用' : '启用'}
              </Button>
              <div className="flex-1" />
              {selected._custom && (
                <Button variant="ghost" onClick={() => void del()} disabled={busy}>
                  <Trash2 className="mr-1.5 h-4 w-4 text-rose-500" /> 删除
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
