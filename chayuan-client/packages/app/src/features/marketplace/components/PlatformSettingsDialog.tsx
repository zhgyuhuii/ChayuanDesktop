/**
 * 平台配置弹窗。
 *
 * 功能:
 *   - 表单字段:platform_type / api_base_url / api_key (mask) / api_proxy /
 *     api_concurrencies / enabled / auto_detect_model
 *   - 模型清单:llm_models 文本(每行一个);disabled_models(黑名单)
 *   - 「连通测试」:调 modelPlatform.test → 显示 reachable + detected 模型数;
 *     成功后可一键「填入检测到的模型」
 *   - 「保存」:PATCH 后**无需重启**,卡片立即转彩
 *   - 「删除」:DELETE 后,DB 行移除,yaml seed 仍可作为兜底
 */

import type {
  PlatformConfig,
  PlatformCreate,
  PlatformPatch,
  PlatformTestResult,
} from '@chayuan/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Switch,
  Textarea,
  cn,
} from '@chayuan/ui';
import { Eye, EyeOff, Save, Sparkles, Trash2, Wand2, Wifi } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from '../../../i18n';
import { notifyInfo, notifySuccess, reportError } from '../../../store/errorDialog';
import {
  useCreatePlatform,
  useDeletePlatform,
  useEnrichPlatform,
  useTestPlatform,
  useUpdatePlatform,
} from '../../../store/modelPlatform';
import { MODEL_TYPES, type ModelType } from '../lib/modelTypes';
import { EMPTY_MODELS_BY_TYPE, ModelTypeAccordion, type ModelsByType } from './ModelTypeAccordion';
import { AssistantBrandLogo } from '../../../components/AssistantBrandLogo';

const PLATFORM_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'custom openai', label: 'OpenAI 兼容(自定义)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'oneapi', label: 'OneAPI' },
  { value: 'fastchat', label: 'FastChat' },
  { value: 'xinference', label: 'Xinference' },
  { value: 'ollama', label: 'Ollama' },
];

export interface PlatformSettingsDialogProps {
  /** 非 null 即打开弹窗 */
  platform: PlatformConfig | null;
  onOpenChange(open: boolean): void;
  /**
   * 平台是否已经持久化到 DB:
   *   - true(默认):dialog 走"已存在,PATCH 更新"的路径
   *   - false:dialog 来自 catalog "未配置" 卡片,保存/测试时要先 POST create
   * 后端的 /admin/model_platforms/{name}/test 只查 DB,所以新厂商必须先 create
   * 才能 test,否则会拿到 "platform 'xxx' not found"。
   */
  existsInDb?: boolean;
}

interface DraftState {
  platform_type: string;
  api_base_url: string;
  api_key: string;
  api_key_dirty: boolean; // 用户改过 key 才下发(否则 PATCH 跳过)
  api_proxy: string;
  api_concurrencies: number;
  enabled: boolean;
  auto_detect_model: boolean;
  /** 8 类模型清单 —— 取代旧的 llm_models_text 单 textarea */
  models: ModelsByType;
  disabled_models_text: string;
  description: string;
}

const MASK = '••••••••';

function platformToDraft(p: PlatformConfig): DraftState {
  const models: ModelsByType = { ...EMPTY_MODELS_BY_TYPE };
  for (const meta of MODEL_TYPES) {
    models[meta.key] = [...((p[meta.field] as string[] | undefined) ?? [])];
  }
  return {
    platform_type: p.platform_type,
    api_base_url: p.api_base_url,
    api_key: p.api_key ? MASK : '',
    api_key_dirty: false,
    api_proxy: p.api_proxy,
    api_concurrencies: p.api_concurrencies,
    enabled: p.enabled,
    auto_detect_model: p.auto_detect_model,
    models,
    disabled_models_text: (p.disabled_models ?? []).join('\n'),
    description: p.description ?? '',
  };
}

/** 判断 draft 与 platform 配置是否有差异(决定是否需要 PATCH) */
function isFieldDirty(p: PlatformConfig, d: DraftState): boolean {
  if (d.platform_type !== p.platform_type) return true;
  if (d.api_base_url.trim() !== p.api_base_url) return true;
  if (d.api_proxy.trim() !== p.api_proxy) return true;
  if (d.api_concurrencies !== p.api_concurrencies) return true;
  if (d.enabled !== p.enabled) return true;
  if (d.auto_detect_model !== p.auto_detect_model) return true;
  if ((d.description ?? '').trim() !== (p.description ?? '')) return true;
  return false;
}

/** 从 draft 拼出 create payload — name 必带,api_key 强制下发(create 用) */
function draftToCreate(name: string, d: DraftState): PlatformCreate {
  return {
    platform_name: name,
    ...draftToPatch(d),
    api_key: d.api_key, // create 必带 key,不依赖 api_key_dirty
  };
}

function draftToPatch(d: DraftState): PlatformPatch {
  const patch: PlatformPatch = {
    platform_type: d.platform_type,
    api_base_url: d.api_base_url.trim(),
    api_proxy: d.api_proxy.trim(),
    api_concurrencies: Number.isFinite(d.api_concurrencies) ? Math.max(1, d.api_concurrencies) : 5,
    enabled: d.enabled,
    auto_detect_model: d.auto_detect_model,
    disabled_models: d.disabled_models_text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
    description: d.description.trim(),
  };
  // 8 类模型 → 后端 8 个数组字段，统一通过 MODEL_TYPES 派生
  for (const meta of MODEL_TYPES) {
    (patch as Record<string, unknown>)[meta.field] = d.models[meta.key] ?? [];
  }
  // 仅当用户改过 api_key 才下发,避免 mask 被回写
  if (d.api_key_dirty) patch.api_key = d.api_key;
  return patch;
}

export const PlatformSettingsDialog: React.FC<PlatformSettingsDialogProps> = ({
  platform,
  onOpenChange,
  existsInDb = true,
}) => {
  const { t } = useTranslation();
  const open = !!platform;
  const [draft, setDraft] = React.useState<DraftState | null>(null);
  const [showKey, setShowKey] = React.useState(false);
  const [testResult, setTestResult] = React.useState<PlatformTestResult | null>(null);
  /**
   * 跟踪本次 dialog 生命周期内"是否已 create 过"。
   * 初始 = props.existsInDb;一旦在 onTest/onSave 里 create 成功就翻 true,
   * 后续 onTest/onSave 走 update 分支,避免重复 create 报 409。
   */
  const [persisted, setPersisted] = React.useState<boolean>(existsInDb);

  const createMut = useCreatePlatform();
  const updateMut = useUpdatePlatform();
  const deleteMut = useDeletePlatform();
  const testMut = useTestPlatform();
  const enrichMut = useEnrichPlatform();
  // 自动拉取(blur 触发)态:防止重复并发 + 给 input 显 loading spinner
  const [autoFetching, setAutoFetching] = React.useState(false);
  // 上次自动拉取用过的 api_key,避免同一个 key 重复 blur 反复 fetch
  const lastAutoKey = React.useRef<string>('');

  // 打开时把 platform 灌成 draft
  React.useEffect(() => {
    if (platform) {
      setDraft(platformToDraft(platform));
      setTestResult(null);
      setShowKey(false);
      setPersisted(existsInDb);
    } else {
      setDraft(null);
    }
  }, [platform, existsInDb]);

  const set = <K extends keyof DraftState>(k: K, v: DraftState[K]) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  };

  const onSave = async () => {
    if (!platform || !draft) return;
    try {
      if (!persisted) {
        if (!draft.api_key) {
          notifyInfo('请先填入 API Key', '新厂商至少需要 API Key 才能保存');
          return;
        }
        await createMut.mutateAsync(draftToCreate(platform.platform_name, draft));
        setPersisted(true);
      } else {
        await updateMut.mutateAsync({ name: platform.platform_name, patch: draftToPatch(draft) });
      }
      notifySuccess(`${platform.platform_name} 已保存,即时生效`);
      onOpenChange(false);
    } catch (e) {
      reportError(e, '保存失败');
    }
  };

  const onDelete = async () => {
    if (!platform) return;
    if (!confirm(`删除厂商「${platform.platform_name}」?(yaml seed 仍可作为兜底)`)) return;
    try {
      await deleteMut.mutateAsync(platform.platform_name);
      notifySuccess(`${platform.platform_name} 已删除`);
      onOpenChange(false);
    } catch (e) {
      reportError(e, '删除失败');
    }
  };

  /**
   * 测试连通 — 后端 /admin/model_platforms/{name}/test 只查 DB 里的配置,
   * 所以必须先把当前 draft 同步到 DB 才能让测试拿到正确的 api_key/base。
   *
   * 流程:
   *   1) 未持久化(catalog "未配置" 卡)→ 必填 api_key,然后 create
   *   2) 已持久化但用户改过 api_key(api_key_dirty)/base/type → 先 PATCH update
   *   3) 否则直接 test
   *   4) 跑 test,把结果写到 testResult
   */
  const onTest = async () => {
    if (!platform || !draft) return;
    try {
      if (!persisted) {
        if (!draft.api_key) {
          notifyInfo('请先填入 API Key', '新厂商必须先填 API Key 才能测试连通');
          return;
        }
        await createMut.mutateAsync(draftToCreate(platform.platform_name, draft));
        setPersisted(true);
        setDraft((d) => (d ? { ...d, api_key_dirty: false } : d));
      } else if (draft.api_key_dirty || isFieldDirty(platform, draft)) {
        await updateMut.mutateAsync({
          name: platform.platform_name,
          patch: draftToPatch(draft),
        });
        setDraft((d) => (d ? { ...d, api_key_dirty: false } : d));
      }
      const r = await testMut.mutateAsync(platform.platform_name);
      setTestResult(r);
    } catch (e) {
      reportError(e, '测试失败');
    }
  };

  /**
   * API Key blur 后自动拉取 + 归类模型(无需用户手点"测试连通"+"一键填入")。
   *
   * 触发条件:
   *   1) 用户改过 key(api_key_dirty)
   *   2) key 长度 >=8(粗判,过滤误触)
   *   3) 与上次 auto-fetch 的 key 不同(防同 key 多次 blur 重拉)
   *   4) 当前没有 in-flight 的 fetch
   *
   * 流程: 同 onTest 一致 — 未持久化先 create / 已持久化先 update → POST /test → autofill
   */
  const onAutoFetch = async () => {
    if (!platform || !draft) return;
    if (autoFetching) return;
    const key = draft.api_key.trim();
    if (!draft.api_key_dirty) return;
    if (!key || key.length < 8 || key === MASK) return;
    if (key === lastAutoKey.current) return;
    lastAutoKey.current = key;
    setAutoFetching(true);
    try {
      if (!persisted) {
        await createMut.mutateAsync(draftToCreate(platform.platform_name, draft));
        setPersisted(true);
        setDraft((d) => (d ? { ...d, api_key_dirty: false } : d));
      } else if (draft.api_key_dirty || isFieldDirty(platform, draft)) {
        await updateMut.mutateAsync({
          name: platform.platform_name,
          patch: draftToPatch(draft),
        });
        setDraft((d) => (d ? { ...d, api_key_dirty: false } : d));
      }
      const r = await testMut.mutateAsync(platform.platform_name);
      setTestResult(r);
      // 探测成功 → 直接合并到 draft.models;失败保持现状,让用户点测试看错因
      if (r.reachable) {
        setDraft((prev) => {
          if (!prev) return prev;
          const merged: ModelsByType = { ...prev.models };
          for (const meta of MODEL_TYPES) {
            const detected = (r.detected[meta.field] ?? []) as string[];
            if (!detected.length) continue;
            const before = merged[meta.key] ?? [];
            merged[meta.key] = [...new Set([...before, ...detected])];
          }
          return { ...prev, models: merged };
        });
        notifySuccess(`已自动拉取到 ${platform.platform_name} 的 ${countDetected(r)} 个模型`);
      }
    } catch (e) {
      // 失败时清掉 lastAutoKey 让用户改 key 后重试有效
      lastAutoKey.current = '';
      reportError(e, '自动拉取模型失败,请检查 base_url 与 api_key');
    } finally {
      setAutoFetching(false);
    }
  };

  /** 把本次 detected 全 8 类模型按类型并入 draft.models（去重保留旧条目） */
  const onAutoFill = () => {
    if (!testResult || !draft) return;
    const merged: ModelsByType = { ...draft.models };
    let total = 0;
    for (const meta of MODEL_TYPES) {
      const detected = (testResult.detected[meta.field] ?? []) as string[];
      if (!detected.length) continue;
      const before = merged[meta.key] ?? [];
      const next = [...new Set([...before, ...detected])];
      merged[meta.key] = next;
      total += next.length - before.length;
    }
    if (total === 0) {
      notifySuccess(t('modelMarket.settings.autoFillEmpty'));
      return;
    }
    set('models', merged);
    notifySuccess(t('modelMarket.settings.autoFillSuccess', { n: total }));
  };

  /**
   * 一键 AI 补全 —— 把 draft 里全部模型 id 喂给后端,后端选一个已配置的 LLM
   * 出 JSON,落到 model_metadata 表;成功后 catalog query invalidate,卡片
   * hover tooltip 自动显示新写入的简介 / 发布日期 / 上下文长度 / 性能短评。
   */
  const onEnrich = async () => {
    if (!platform || !draft) return;
    if (!persisted) {
      notifyInfo('请先保存厂商', 'AI 补全需要厂商已落库,先保存再补全');
      return;
    }
    const allModels: string[] = [];
    for (const meta of MODEL_TYPES) {
      for (const m of draft.models[meta.key] ?? []) {
        if (m && !allModels.includes(m)) allModels.push(m);
      }
    }
    if (allModels.length === 0) {
      notifyInfo('暂无模型', '请先在上方"模型清单"里添加 model id 再用 AI 补全');
      return;
    }
    try {
      const r = await enrichMut.mutateAsync({
        name: platform.platform_name,
        models: allModels,
      });
      notifySuccess(
        `AI 补全完成:已补 ${r.updated.length} 个 / 跳过 ${r.skipped.length} 个 (LLM: ${r.llm_used})`,
      );
    } catch (e) {
      reportError(e, 'AI 补全失败 — 请确保已配置任意一个有 LLM 的厂商');
    }
  };

  /** 把 detected 转成 ModelType -> count 给 accordion 显示"新增 N" 角标 */
  const detectedCounts = React.useMemo<Partial<Record<ModelType, number>>>(() => {
    if (!testResult || !draft) return {};
    const out: Partial<Record<ModelType, number>> = {};
    for (const meta of MODEL_TYPES) {
      const detected = (testResult.detected[meta.field] ?? []) as string[];
      if (!detected.length) continue;
      const before = new Set(draft.models[meta.key] ?? []);
      const newOnes = detected.filter((m) => !before.has(m));
      if (newOnes.length) out[meta.key] = newOnes.length;
    }
    return out;
  }, [testResult, draft]);

  /** 把后端注入的 ``builtin_models`` (key=PlatformConfig 字段名) 转成
   *  ``ModelType -> Set<string>``,给 ModelTypeAccordion 派发到对应 ModelLineEditor;
   *  命中 set 的行 = catalog 默认带的内置模型,UI 不渲染删除按钮。 */
  const builtinByType = React.useMemo<Partial<Record<ModelType, ReadonlySet<string>>>>(() => {
    const src = (platform?.builtin_models ?? {}) as Partial<Record<string, string[]>>;
    const out: Partial<Record<ModelType, ReadonlySet<string>>> = {};
    for (const meta of MODEL_TYPES) {
      const list = src[meta.field];
      if (list && list.length) out[meta.key] = new Set(list);
    }
    return out;
  }, [platform]);

  if (!platform || !draft) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[88vh] w-[92vw] max-w-2xl flex-col gap-0 overflow-hidden p-0"
        hideClose
      >
        <header className="flex items-center justify-between border-b border-[var(--cy-border-subtle)] px-5 py-3">
          <div className="min-w-0">
            <DialogTitle asChild>
              <h2 className="truncate text-base font-semibold text-[var(--cy-text-primary)]">
                配置 {platform.platform_name}
              </h2>
            </DialogTitle>
            <DialogDescription className="text-[11px] text-[var(--cy-text-tertiary)]">
              保存后即时生效,无需重启服务
            </DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--cy-text-tertiary)]">总开关</span>
            <Switch checked={draft.enabled} onCheckedChange={(v) => set('enabled', v)} />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 平台类型 */}
          <Field label="平台类型" hint="决定连通测试与模型探测策略">
            <select
              value={draft.platform_type}
              onChange={(e) => set('platform_type', e.target.value)}
              className="h-9 w-full rounded-md border border-[var(--cy-border-default)] bg-[var(--cy-surface-base)] px-3 text-sm focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none"
            >
              {PLATFORM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Base URL" hint="OpenAI 兼容路径,例如 https://api.deepseek.com/v1">
            <Input
              value={draft.api_base_url}
              placeholder="https://api.deepseek.com/v1"
              onChange={(e) => set('api_base_url', e.target.value)}
            />
          </Field>

          <Field
            label="API Key"
            hint={autoFetching ? '正在自动拉取模型清单…' : '失焦后自动拉取并归类该厂商的可用模型'}
          >
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={draft.api_key}
                placeholder="sk-..."
                onFocus={(e) => {
                  // 第一次聚焦时,如果是 mask,清空让用户重新输入
                  if (!draft.api_key_dirty && draft.api_key === MASK) {
                    set('api_key', '');
                    set('api_key_dirty', true);
                    requestAnimationFrame(() => e.target.select());
                  } else if (!draft.api_key_dirty) {
                    set('api_key_dirty', true);
                  }
                }}
                onChange={(e) => {
                  set('api_key', e.target.value);
                  if (!draft.api_key_dirty) set('api_key_dirty', true);
                }}
                onBlur={() => {
                  // 用户填了 key 后失焦 → 自动 create+test+autofill,无需手点按钮
                  void onAutoFetch();
                }}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]"
                aria-label={showKey ? '隐藏' : '显示'}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              {autoFetching && (
                <span className="absolute right-9 top-1/2 -translate-y-1/2 text-[var(--cy-text-tertiary)]">
                  <AssistantBrandLogo running className="h-3.5 w-3.5 rounded-full" />
                </span>
              )}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="HTTP 代理(可选)">
              <Input
                value={draft.api_proxy}
                placeholder="http://127.0.0.1:7890"
                onChange={(e) => set('api_proxy', e.target.value)}
              />
            </Field>
            <Field label="单模型并发上限">
              <Input
                type="number"
                min={1}
                value={draft.api_concurrencies}
                onChange={(e) => set('api_concurrencies', Math.max(1, Number(e.target.value) || 1))}
              />
            </Field>
          </div>

          {/* 自动检测开关 + 测试结果(含一键填入) — 放在模型清单上方,先看连通性再编模型 */}
          <div className="flex items-center gap-2 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-3 py-2">
            <Switch
              checked={draft.auto_detect_model}
              onCheckedChange={(v) => set('auto_detect_model', v)}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-[var(--cy-text-primary)]">自动检测可用模型</p>
              <p className="text-[10px] text-[var(--cy-text-tertiary)]">
                启用后,服务侧周期性探测厂商可用模型清单(适合 ollama / xinference)
              </p>
            </div>
          </div>

          {testResult && (
            <div
              className={cn(
                'rounded-md border p-3 text-xs',
                testResult.reachable
                  ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800'
                  : 'border-red-200 bg-red-50/60 text-red-800',
              )}
            >
              <p className="font-medium">{testResult.reachable ? '✅ 连通正常' : '❌ 连通失败'}</p>
              {testResult.error && (
                <p className="mt-1 break-words text-[11px] opacity-80">{testResult.error}</p>
              )}
              {testResult.reachable && (
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                  {MODEL_TYPES.map((meta) => {
                    const arr = (testResult.detected[meta.field] ?? []) as string[];
                    if (!arr.length) return null;
                    return (
                      <span
                        key={meta.key}
                        className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 ring-1 ring-emerald-200"
                      >
                        <meta.icon className="h-3 w-3" />
                        {t(`${meta.i18nKey}.label`)}
                        <span className="font-medium tabular-nums">{arr.length}</span>
                      </span>
                    );
                  })}
                </div>
              )}
              {testResult.reachable && Object.keys(testResult.detected).length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 text-xs"
                  onClick={onAutoFill}
                >
                  <Wand2 className="h-3 w-3" /> 一键填入检测到的模型
                </Button>
              )}
            </div>
          )}

          <Field
            label={t('modelMarket.settings.models.label')}
            hint={t('modelMarket.settings.models.hint')}
          >
            <ModelTypeAccordion
              value={draft.models}
              onChange={(next) => set('models', next)}
              detected={detectedCounts}
              builtin={builtinByType}
            />
          </Field>

          <Field
            label={t('modelMarket.settings.blacklist.label')}
            hint={t('modelMarket.settings.blacklist.hint')}
          >
            <Textarea
              rows={3}
              value={draft.disabled_models_text}
              onChange={(e) => set('disabled_models_text', e.target.value)}
              className="font-mono text-xs"
              placeholder={t('modelMarket.settings.blacklist.placeholder')}
            />
          </Field>

          {/* 厂商描述放在底部 — 仅作展示文案,不影响功能 */}
          <Field label="厂商描述(hero / 卡片副标题)" optional>
            <Input
              value={draft.description}
              placeholder="混合推理架构,更高的思考效率"
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-5 py-3">
          {persisted ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={onDelete}
              disabled={deleteMut.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </Button>
          ) : (
            <span className="text-[11px] text-[var(--cy-text-tertiary)]">
              新厂商 · 保存后可测试
            </span>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onEnrich}
              disabled={enrichMut.isPending || !persisted}
              title={
                persisted
                  ? '用 LLM 给当前模型清单批量生成简介 / 发布日期 / 上下文长度 / 性能短评'
                  : '先保存厂商再用 AI 补全'
              }
            >
              {enrichMut.isPending ? (
                <AssistantBrandLogo running className="h-3.5 w-3.5 rounded-full" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              AI 补全简介
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onTest}
              disabled={testMut.isPending || createMut.isPending || updateMut.isPending}
            >
              {testMut.isPending || createMut.isPending || updateMut.isPending ? (
                <AssistantBrandLogo running className="h-3.5 w-3.5 rounded-full" />
              ) : (
                <Wifi className="h-3.5 w-3.5" />
              )}
              {!persisted ? '保存并测试' : '测试连通'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              disabled={updateMut.isPending || createMut.isPending}
            >
              {updateMut.isPending || createMut.isPending ? (
                <AssistantBrandLogo running className="h-3.5 w-3.5 rounded-full" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              保存(立即生效)
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
};

function countDetected(r: PlatformTestResult): number {
  let n = 0;
  for (const meta of MODEL_TYPES) {
    const arr = (r.detected[meta.field] ?? []) as string[];
    n += arr.length;
  }
  return n;
}

const Field: React.FC<{
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}> = ({ label, hint, optional, children }) => (
  <div className="space-y-1">
    <div className="flex items-baseline justify-between">
      <label className="text-xs font-medium text-[var(--cy-text-secondary)]">
        {label}
        {optional && (
          <span className="ml-1 text-[10px] text-[var(--cy-text-tertiary)]">(可选)</span>
        )}
      </label>
      {hint && <span className="text-[10px] text-[var(--cy-text-tertiary)]">{hint}</span>}
    </div>
    {children}
  </div>
);
