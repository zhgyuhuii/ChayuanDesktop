/**
 * 设置页(参考图"设置")。
 *
 * 视觉:**不渲染顶部「系统设置」标题、不渲染各分组的 label**,
 * 只保留卡片本身和卡片内的逐行内容(用户在 2026-05-09 反馈中明确要求
 * 「这些列的名称都应该去掉」)。
 *
 * 结构(从上到下,每张卡都是无 label 的圆角容器):
 *
 *   1. 基础(主题 / 字号 / 语言 / 名称设置)
 *   2. 本地模型服务(LocalRuntimeServicesSection — chat/embedding/rerank/asr/image-embedding 启停)
 *   3. 默认模型(聊天 / 文本嵌入 / 图像嵌入 / 重排)
 *   4. 知识中心(添加结构化数据库)
 *   5. 快捷工具(AI 键)
 *   6. 高级(本地模型对话 / 设备调优 / 教学)
 *   7. 关于(应用名 + 版本 + 检测更新)
 *
 * 与老实现的差异:
 *   - 删掉 ``<h1>{settings.title}</h1>`` 顶部大标题
 *   - 删掉 「个人设置」整个分组(单机版无登录概念,只有「本地用户」一行没意义)
 *   - 删掉 「更换声音」行(无后端能力,空按钮误导)
 *   - 「名称设置」 改为 ``<Input>`` + 保存按钮,写 settings.displayName,
 *     UserMenuPopover 头像下拉同步显示
 *   - Section 的 ``label`` 不再渲染 ``<h2>``,但卡片视觉保留(圆角 + 边框)
 *   - 2026-05-16:删除「后端服务」「上传遥测」两行(单机版无业务价值),
 *     腾出位置插入「本地模型服务」分组
 */

import {
  type BootstrapResponse,
  type CapabilityDefaultsCandidate,
  type CapabilityDefaultsResponse,
  type InstallJob,
  serverCapabilityDefaults,
  serverModelsBootstrap,
  serverModelsInstall,
} from '@chayuan/api';
import { getPlatform } from '@chayuan/platform-shared';
import { Button, Input, Pill, Slider, Switch, cn } from '@chayuan/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Cpu, Loader2, Monitor, Moon, Plus, RotateCcw, Sun } from 'lucide-react';
import * as React from 'react';
import { SUPPORTED_LOCALES, useTranslation } from '../../i18n';
import { notifySuccess, reportError } from '../../store/errorDialog';
import { type LocalePreference, type ThemeMode, useSettingsStore } from '../../store/settings';
import { LocalRuntimeServicesSection } from '../aiPlatform';

export const SettingsAsPage: React.FC = () => {
  const { t } = useTranslation();
  const settings = useSettingsStore();
  const platform = getPlatform();

  const [nameInput, setNameInput] = React.useState(settings.displayName);
  const [localModel, setLocalModel] = React.useState(false);
  const [deviceOpt, setDeviceOpt] = React.useState(true);
  const [teachMe, setTeachMe] = React.useState(true);

  React.useEffect(() => {
    setNameInput(settings.displayName);
  }, [settings.displayName]);

  // 处理 footer 状态灯跳转过来的 hash(#local-runtime-<cap>):
  // 先等本地模型 section 渲染完成,再 scrollIntoView。空轮询 ~10 次 (~500ms)
  // 足以覆盖 LocalRuntimeServicesSection 等异步数据填充后再挂载子 row 的场景。
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash.startsWith('local-runtime-')) return;
    let tries = 0;
    const tick = () => {
      const el = document.getElementById(hash);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 给个轻量视觉强调,让用户清楚到底跳到哪一行
        el.classList.add('ring-2', 'ring-emerald-400', 'ring-offset-2');
        window.setTimeout(() => {
          el.classList.remove('ring-2', 'ring-emerald-400', 'ring-offset-2');
        }, 1600);
        return;
      }
      if (++tries < 10) window.setTimeout(tick, 50);
    };
    tick();
  }, []);

  const onSaveName = () => {
    const v = nameInput.trim();
    settings.setDisplayName(v);
    notifySuccess('名称已保存', v || '已恢复默认显示');
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      {/* 基础 */}
      <Section>
        <Row
          title={t('settings.theme')}
          trailing={
            <div className="flex gap-1">
              {THEME_OPTS.map((o) => {
                const Icon = o.icon;
                const active = settings.theme === o.value;
                const labelKey =
                  o.value === 'light'
                    ? 'settings.themeLight'
                    : o.value === 'dark'
                      ? 'settings.themeDark'
                      : 'settings.themeSystem';
                return (
                  <Pill
                    key={o.value}
                    active={active}
                    tone={active ? 'ink' : 'outline'}
                    size="sm"
                    onClick={() => settings.setTheme(o.value)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t(labelKey)}
                  </Pill>
                );
              })}
            </div>
          }
        />
        <Row
          title={`${t('settings.fontSize')} (${settings.fontSize}px)`}
          trailing={
            <div className="w-40">
              <Slider
                min={12}
                max={22}
                step={1}
                value={[settings.fontSize]}
                onValueChange={([v]) => v !== undefined && settings.setFontSize(v)}
              />
            </div>
          }
        />
        <Row
          title={t('settings.language')}
          trailing={
            <select
              value={settings.locale}
              onChange={(e) => settings.setLocale(e.target.value as LocalePreference)}
              className={cn(
                'rounded-md border border-[var(--cy-border-default)] bg-[var(--cy-surface-base)] px-2 py-1 text-sm',
              )}
            >
              <option value="system">{t('language.system')}</option>
              {SUPPORTED_LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          }
        />
        <Row title={t('settings.changeName')} description={t('settings.changeNameDesc')}>
          <div className="mt-3 flex items-center gap-2">
            <Input
              value={nameInput}
              placeholder="例如:小察"
              maxLength={30}
              onChange={(e) => setNameInput(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={onSaveName}
              disabled={nameInput === settings.displayName}
            >
              {t('common.save')}
            </Button>
          </div>
        </Row>
      </Section>

      {/* 本地模型服务(spec: 2026-05-16) */}
      <LocalRuntimeServicesSection />

      {/* 默认模型 — 模型广场配好厂商后,这里挑哪一个用做默认 */}
      <DefaultModelsSection />

      {/* 快捷工具 */}
      <Section>
        <Row
          title={t('settings.aiKey')}
          description={t('settings.aiKeyDesc')}
          trailing={
            <Pill tone="outline" size="sm">
              ☆ → 唤起聊天
            </Pill>
          }
        />
      </Section>

      {/* 高级(M4 占位 — 后端缺对应能力,前端开关只持久化本地偏好) */}
      <Section>
        <Row
          title="显示底部状态栏"
          description="主界面底部显示版权 + 6 个本地模型能力的运行状态点;关闭后腾出 28px 给主区"
          trailing={
            <Switch
              checked={settings.showAppFooter}
              onCheckedChange={(b) => settings.setShowAppFooter(b)}
            />
          }
        />
        <Row
          title={t('settings.localModel')}
          description={t('settings.localModelDesc')}
          trailing={<Switch checked={localModel} onCheckedChange={setLocalModel} />}
        />
        <Row
          title={t('settings.deviceOptimize')}
          description={t('settings.deviceOptimizeDesc')}
          trailing={<Switch checked={deviceOpt} onCheckedChange={setDeviceOpt} />}
        />
        <Row
          title={t('settings.teachMe')}
          description={t('settings.teachMeDesc')}
          trailing={<Switch checked={teachMe} onCheckedChange={setTeachMe} />}
        />
      </Section>

      {/* 关于 */}
      <Section>
        <Row
          title={`${platform.runtime.appName} · ${platform.runtime.appVersion}`}
          description={platform.kind}
          trailing={
            platform.updater && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  // biome-ignore lint/style/noNonNullAssertion: 上面 platform.updater 真值守卫已确保非空
                  const upd = await platform.updater!.check();
                  if (upd.available) {
                    // 走 platform.dialog.confirm — 详见 ImageToTextPage 同处注释
                    const ok = await platform.dialog.confirm(
                      `发现新版本 ${upd.version}。立即安装?`,
                      { title: '更新' },
                    );
                    if (ok) {
                      // biome-ignore lint/style/noNonNullAssertion: 同上
                      await platform.updater!.install();
                    }
                  } else {
                    notifySuccess('已是最新版本');
                  }
                }}
              >
                {t('settings.checkUpdate')}
              </Button>
            )
          }
        />
      </Section>

      <div className="mt-8 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            const ok = await platform.dialog.confirm('恢复默认设置?', { title: '恢复默认' });
            if (!ok) return;
            settings.reset();
            setNameInput('');
          }}
        >
          <RotateCcw className="h-4 w-4" />
          恢复默认
        </Button>
      </div>
    </div>
  );
};

/**
 * 设置页分组容器 — **不渲染 ``<h2>`` 标题**(用户要求)。
 * 仅保留圆角边框 + 浅色背景,把内部 Row 视觉成一组。
 */
const Section: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <section className="mt-6 first:mt-0">
    <div className="overflow-hidden rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]">
      {children}
    </div>
  </section>
);

const Row: React.FC<{
  title: string;
  description?: string;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ title, description, trailing, children }) => (
  <div className="flex items-start gap-4 border-b border-[var(--cy-border-subtle)] px-4 py-3 last:border-b-0">
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-[var(--cy-text-primary)]">{title}</p>
      {description && (
        <p className="mt-0.5 text-xs text-[var(--cy-text-tertiary)]">{description}</p>
      )}
      {children}
    </div>
    {trailing && <div className="flex-shrink-0">{trailing}</div>}
  </div>
);

const THEME_OPTS: Array<{
  value: ThemeMode;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

// 设置页"默认模型"分组 — 与模型广场保持单向数据流:
// 广场配好厂商/模型 → list() 候选刷新 → 这里挑选 → setMany() 写盘 → 业务读真源。
//
// 显示哪几类:对应 UI 上"聊天 / 文本嵌入 / 图像嵌入 / 重排"等用户最常配置的能力;
// 其它(t2i/t2v/tts/asr/ocr)留在 RuntimeCenter 全量面板,这里只暴露 4 类高频。
const VISIBLE_CAPS: Array<{ cap: string; label: string; hint: string }> = [
  { cap: 'chat', label: '聊天模型', hint: '用于问答 / 写作 / 多轮对话' },
  { cap: 'embedding', label: '文本向量模型', hint: '用于知识库索引和语义检索' },
  { cap: 'clip', label: '图像向量模型', hint: '用于图片知识库和图文检索' },
  { cap: 'rerank', label: '结果重排模型', hint: '检索后再排一次,让最相关的结果排到前面' },
];

// 模型库自检 Banner — 缺模型时引导用户走三条配置路径:
//   1. 一键下载推荐 release(serverModelsInstall.start + 轮询)
//   2. 去模型广场配厂商(/marketplace)
//   3. 已经手动放进 <CHAYUAN_ROOT>/models/ → 刷新扫盘(do_scan=true 重拉)
const BootstrapBanner: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery<BootstrapResponse>({
    queryKey: ['serverModelsBootstrap'],
    queryFn: () => serverModelsBootstrap.get({ doScan: false }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // 下载任务状态(运行中时锁住按钮 + 显示进度)
  const [runningJob, setRunningJob] = React.useState<InstallJob | null>(null);
  // 轮询 effect:有运行中任务时每 2s 查一次
  React.useEffect(() => {
    if (!runningJob) return;
    if (runningJob.status === 'succeeded' || runningJob.status === 'failed') {
      // 终态:刷新 bootstrap + capability_defaults 让 UI 重新拉
      void qc.invalidateQueries({ queryKey: ['serverModelsBootstrap'] });
      void qc.invalidateQueries({ queryKey: ['serverCapabilityDefaults'] });
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const fresh = await serverModelsInstall.get(runningJob.id);
        setRunningJob(fresh);
      } catch {
        // 网络抖动忽略,下一轮再试
      }
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [runningJob, qc]);

  if (!data || data.ready) return null;

  const hint = data.install_hints[0];
  const capLabel = (cap: string) =>
    ({
      chat: '对话',
      'text-embedding': '文本向量',
      rerank: '重排',
      'speech-to-text': '语音识别',
      'image-to-text': '图像识别',
    })[cap] ?? cap;

  const onDownload = async () => {
    if (!hint) return;
    try {
      const job = await serverModelsInstall.start({
        release: hint.release as 'lite' | 'standard' | 'pro',
        mirror: 'hf-mirror',
      });
      setRunningJob(job);
      notifySuccess('已开始下载', `release ${job.release}(后台运行,可继续使用)`);
    } catch (e) {
      reportError(e, '启动下载失败');
    }
  };

  const onRescan = async () => {
    try {
      await serverModelsBootstrap.get({ doScan: true });
      await qc.invalidateQueries({ queryKey: ['serverModelsBootstrap'] });
      await qc.invalidateQueries({ queryKey: ['serverCapabilityDefaults'] });
      notifySuccess('已重新扫盘', '本地模型索引已刷新');
    } catch (e) {
      reportError(e, '扫盘失败');
    }
  };

  const downloading =
    runningJob &&
    (runningJob.status === 'queued' || runningJob.status === 'running');

  return (
    <div className="mb-3 rounded-md border border-[var(--cy-border-warning)] bg-[var(--cy-surface-warning-subtle)] px-4 py-3 text-sm">
      <p className="font-medium text-[var(--cy-text-primary)]">
        模型库不完整 — 缺失 {data.missing.map(capLabel).join(' / ')}
      </p>
      {hint && (
        <p className="mt-1 text-xs text-[var(--cy-text-tertiary)]">
          建议下载 <span className="font-medium">{hint.release}</span> 包(约
          {Math.round(hint.approx_size_mb / 100) / 10}GB) — {hint.description}
        </p>
      )}
      {runningJob && (
        <div className="mt-2 space-y-1">
          {/* 进度文案 + X/Y 文件计数 */}
          <p className="text-xs text-[var(--cy-text-primary)]">
            {runningJob.progress_message ||
              `step=${runningJob.step || 'queued'} · status=${runningJob.status}`}
            {typeof runningJob.files_total === 'number' &&
              runningJob.files_total > 0 && (
                <span className="ml-1 text-[var(--cy-text-tertiary)]">
                  ({runningJob.files_done ?? 0}/{runningJob.files_total} 文件)
                </span>
              )}
          </p>
          {/* 进度条:有 progress_pct 才画;终态显示 100% */}
          {(typeof runningJob.progress_pct === 'number' ||
            runningJob.status === 'succeeded' ||
            runningJob.status === 'failed') && (
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--cy-surface-1)]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(runningJob.progress_pct ?? 0)}
            >
              <div
                className={cn(
                  'h-full transition-all',
                  runningJob.status === 'failed'
                    ? 'bg-[var(--cy-text-danger,#dc2626)]'
                    : 'bg-[var(--cy-brand-500)]',
                )}
                style={{
                  width: `${Math.min(100, Math.max(0, runningJob.status === 'succeeded' ? 100 : runningJob.progress_pct ?? 0))}%`,
                }}
              />
            </div>
          )}
          {runningJob.status === 'failed' &&
            runningJob.exit_code !== null && (
              <p className="text-xs text-[var(--cy-text-danger,#dc2626)]">
                失败 · exit={runningJob.exit_code}
                {runningJob.log_tail?.length
                  ? ` · 最后一行:${runningJob.log_tail.slice(-1)[0]}`
                  : ''}
              </p>
            )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {hint && !downloading && (
          <Button size="sm" onClick={() => void onDownload()}>
            <Plus className="h-3.5 w-3.5" />
            下载 {hint.release} 包
          </Button>
        )}
        {downloading && runningJob && (
          <>
            <Button size="sm" disabled>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              下载中…
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const j = await serverModelsInstall.cancel(runningJob.id);
                  setRunningJob(j);
                  notifySuccess('已请求取消', '后台正在收尾,稍后会进入 cancelled 终态');
                } catch (e) {
                  reportError(e, '取消失败');
                }
              }}
            >
              取消下载
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void navigate({ to: '/marketplace' })}
        >
          <Cpu className="h-3.5 w-3.5" />
          去模型广场配厂商
        </Button>
        <Button size="sm" variant="outline" onClick={() => void onRescan()}>
          <RotateCcw className="h-3.5 w-3.5" />
          我已有模型,刷新扫盘
        </Button>
      </div>
    </div>
  );
};

/** 候选 model id 短显:本地 scanner 路径(models/bundled/chat/Qwen3-...-GGUF)
 *  只取最后一段 + 去 -GGUF 后缀;云厂商裸 id (deepseek-v4-flash) 原样。 */
function shortModelLabel(id: string): string {
  if (!id.includes('/')) return id;
  const tail = id.split('/').filter(Boolean).pop() ?? id;
  return tail.replace(/-(gguf|GGUF)$/, '');
}

function fmtSizeMB(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** platform_name 归一到 group key + 显示 label。本地 sidecar(local / local-*)
 *  归一到「本地模型」;云厂商按 platform_name 各自一组。platform_name 缺失 →「其它」。 */
function platformGroupKeyForSettings(p: string | null | undefined): { key: string; label: string } {
  if (!p) return { key: '__other__', label: '其它' };
  if (p === 'local' || p.startsWith('local-')) {
    return { key: '__local__', label: '本地模型' };
  }
  return { key: p, label: p };
}

function groupCandidatesByPlatform(
  candidates: CapabilityDefaultsCandidate[],
): Array<{ label: string; items: CapabilityDefaultsCandidate[] }> {
  const map = new Map<string, { label: string; items: CapabilityDefaultsCandidate[] }>();
  for (const c of candidates) {
    // local_index 来源(scanner 直出)兜底走「本地模型」组,即使后端忘了带 platform_name
    const effectivePlatform =
      c.platform_name ?? (c.source === 'local_index' ? 'local' : undefined);
    const { key, label } = platformGroupKeyForSettings(effectivePlatform);
    const entry = map.get(key) ?? { label, items: [] };
    entry.items.push(c);
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === '__local__') return -1;
      if (b === '__local__') return 1;
      if (a === '__other__') return 1;
      if (b === '__other__') return -1;
      return a.localeCompare(b);
    })
    .map(([, v]) => ({
      label: v.label,
      items: v.items.slice().sort((x, y) => x.id.localeCompare(y.id)),
    }));
}

const DefaultModelsSection: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<CapabilityDefaultsResponse>({
    queryKey: ['serverCapabilityDefaults'],
    queryFn: () => serverCapabilityDefaults.list(),
    staleTime: 30_000,
  });

  const onPick = React.useCallback(
    async (cap: string, modelId: string) => {
      try {
        const res = await serverCapabilityDefaults.setMany({ [cap]: modelId });
        const r = res.results?.[cap];
        if (r?.ok) {
          notifySuccess(
            '已设为默认',
            `${VISIBLE_CAPS.find((c) => c.cap === cap)?.label ?? cap} → ${modelId}`,
          );
          await qc.invalidateQueries({ queryKey: ['serverCapabilityDefaults'] });
        } else {
          reportError(new Error(r?.error || '保存失败'), '保存默认模型失败');
        }
      } catch (e) {
        reportError(e, '保存默认模型失败');
      }
    },
    [qc],
  );

  return (
    <Section>
      <BootstrapBanner />
      {error ? (
        <Row
          title="无法读取默认模型"
          description={`后端服务可能未就绪;${(error as Error)?.message ?? error}`}
        />
      ) : isLoading || !data ? (
        <Row title="加载中…" description="正在读取已配置的厂商和模型清单" />
      ) : (
        VISIBLE_CAPS.map(({ cap, label, hint }) => {
          const candidates = data.candidates[cap] ?? [];
          const current = data.defaults[cap] ?? '';
          if (candidates.length === 0) {
            return (
              <Row
                key={cap}
                title={label}
                description={`${hint} · 暂无可选模型`}
                trailing={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void navigate({ to: '/marketplace' })}
                  >
                    <Cpu className="h-3.5 w-3.5" />
                    去模型广场
                  </Button>
                }
              />
            );
          }
          // 按 platform_name 分组渲染 <optgroup>:本地 sidecar(local / local-<cap>)
          // 归一到「本地模型」首位,云厂商(deepseek / qwen / openrouter / ...)各自一组按字母序。
          // 本地路径式 id 短化显示,云厂商 id 原样。
          const groups = groupCandidatesByPlatform(candidates);
          return (
            <Row
              key={cap}
              title={label}
              description={hint}
              trailing={
                <select
                  value={current}
                  onChange={(e) => void onPick(cap, e.target.value)}
                  className={cn(
                    'min-w-[180px] max-w-[260px] rounded-md border border-[var(--cy-border-default)]',
                    'bg-[var(--cy-surface-base)] px-2 py-1 text-sm',
                  )}
                  data-testid={`settings-default-${cap}`}
                >
                  {!current && (
                    <option value="" disabled>
                      请选择
                    </option>
                  )}
                  {groups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map((c) => (
                        <option key={c.id} value={c.id}>
                          {shortModelLabel(c.id)}
                          {c.size_bytes ? ` · ${fmtSizeMB(c.size_bytes)}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              }
            />
          );
        })
      )}
    </Section>
  );
};
