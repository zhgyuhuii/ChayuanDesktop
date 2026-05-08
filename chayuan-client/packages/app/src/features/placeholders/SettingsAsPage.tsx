/**
 * 设置页(参考图"设置")—— M4 完整实现。
 *
 * 4 组:
 *   - 个人设置(账号 / 头像 / 昵称)
 *   - 基础设置(主题 / 字号 / 语言 / 后端 / 遥测)
 *   - 快捷工具(AI 键 / 截图等占位)
 *   - 高级(本地模型对话 / 设备调优 / 教学)
 */

import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sun, Moon, Monitor, RotateCcw, Volume2, User as UserIcon, Database, Plus, Cpu,
} from 'lucide-react';
import { Button, cn, Input, Slider, Switch, Pill } from '@chayuan/ui';
import { configureClient, serverCapabilityDefaults, type CapabilityDefaultsResponse } from '@chayuan/api';
import { getPlatform } from '@chayuan/platform-shared';
import { useSettingsStore, type ThemeMode, type LocalePreference } from '../../store/settings';
import { useAuthStore } from '../../store/auth';
import { useSingleMachineMode } from '../first-run/useSingleMachineMode';
import { SUPPORTED_LOCALES, useTranslation } from '../../i18n';
import { AddStructuredSourceDialog } from '../kb/AddStructuredSourceDialog';
import { notifySuccess, reportError } from '../../store/errorDialog';

export const SettingsAsPage: React.FC = () => {
  const { t } = useTranslation();
  const settings = useSettingsStore();
  const auth = useAuthStore();
  const platform = getPlatform();
  const singleMachine = useSingleMachineMode();
  const defaultApi = platform.runtime.defaultApiBase;
  const [apiInput, setApiInput] = React.useState(settings.apiBaseOverride);
  const [localModel, setLocalModel] = React.useState(false);
  const [deviceOpt, setDeviceOpt] = React.useState(true);
  const [teachMe, setTeachMe] = React.useState(true);
  const [addStructuredOpen, setAddStructuredOpen] = React.useState(false);

  const onApplyApi = () => {
    const trimmed = apiInput.trim();
    settings.setApiBaseOverride(trimmed);
    configureClient({ baseURL: trimmed || defaultApi });
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-center text-xl font-semibold text-[var(--cy-text-primary)]">
        {t('settings.title')}
      </h1>

      {/* 个人 —— 单机版无登录概念,显示"本地用户"占位,不渲染登录/退出按钮 */}
      <Section label={t('settings.personal')}>
        {singleMachine ? (
          <Row
            title="本地用户"
            description="数据保存在本机"
          />
        ) : auth.user ? (
          <Row
            title={auth.user.username}
            description={auth.user.role}
            trailing={
              <Button size="sm" variant="outline" onClick={() => void auth.logout()}>
                {t('auth.logout')}
              </Button>
            }
          />
        ) : (
          <Row
            title={t('settings.notLoggedIn')}
            description={t('settings.loginHint')}
            trailing={<Button size="sm">{t('settings.login')}</Button>}
          />
        )}
      </Section>

      {/* 基础 */}
      <Section label={t('settings.basic')}>
        <Row
          title={t('settings.changeVoice')}
          description={t('settings.changeVoiceDesc')}
          trailing={
            <Button size="sm" variant="outline">
              <Volume2 className="h-3.5 w-3.5" />
              {t('settings.change')}
            </Button>
          }
        />
        <Row
          title={t('settings.changeName')}
          description={t('settings.changeNameDesc')}
          trailing={
            <Button size="sm" variant="outline">
              <UserIcon className="h-3.5 w-3.5" />
              {t('settings.change')}
            </Button>
          }
        />
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
        <Row title={t('settings.backend')} description={t('settings.backendUrlDesc')}>
          <div className="mt-3 flex items-center gap-2">
            <Input
              value={apiInput}
              placeholder={defaultApi || '同源 / 留空使用默认'}
              onChange={(e) => setApiInput(e.target.value)}
            />
            <Button size="sm" variant="outline" onClick={onApplyApi}>
              {t('common.save')}
            </Button>
          </div>
        </Row>
        <Row
          title="上传遥测 (Langfuse)"
          description="关闭后仅本地暂存"
          trailing={
            <Switch
              checked={settings.telemetry}
              onCheckedChange={(b) => settings.setTelemetry(b)}
            />
          }
        />
      </Section>

      {/* 默认模型 — 模型广场配好厂商后,这里挑哪一个用做默认 */}
      <DefaultModelsSection />

      {/* 知识库管理 */}
      <Section label={t('nav.knowledge')}>
        <Row
          title="结构化数据库"
          description="MySQL / PostgreSQL / SQL Server / Oracle / 金仓 / 达梦 / ClickHouse / Doris / Hive 等"
          trailing={
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddStructuredOpen(true)}
            >
              <Database className="h-3.5 w-3.5" />
              <Plus className="h-3 w-3" />
              添加
            </Button>
          }
        />
      </Section>

      {/* 快捷工具 */}
      <Section label={t('settings.shortcuts')}>
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
      <Section label="高级">
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
      <Section label={t('settings.about')}>
        <Row
          title={`${platform.runtime.appName} · ${platform.runtime.appVersion}`}
          description={platform.kind}
          trailing={
            platform.updater && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const upd = await platform.updater!.check();
                  if (upd.available) {
                    if (confirm(`发现新版本 ${upd.version}。立即安装?`)) {
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
          onClick={() => {
            if (!confirm('恢复默认设置?')) return;
            settings.reset();
            setApiInput('');
            configureClient({ baseURL: defaultApi });
          }}
        >
          <RotateCcw className="h-4 w-4" />
          恢复默认
        </Button>
      </div>

      <AddStructuredSourceDialog
        open={addStructuredOpen}
        onOpenChange={setAddStructuredOpen}
      />
    </div>
  );
};

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <section className="mt-8">
    <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--cy-text-tertiary)]">
      {label}
    </h2>
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
  { cap: 'chat',      label: '聊天模型',     hint: '问答 / 写作 / 多轮对话' },
  { cap: 'embedding', label: '文本向量模型', hint: '知识库索引 / 语义检索' },
  { cap: 'clip',      label: '图像向量模型', hint: '图片知识库 / 多模态检索' },
  { cap: 'rerank',    label: '重排模型',     hint: '检索后精排提升相关性' },
];

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
          notifySuccess('已设为默认', `${VISIBLE_CAPS.find((c) => c.cap === cap)?.label ?? cap} → ${modelId}`);
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
    <Section label="默认模型">
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
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id}{c.runtime ? ` · ${c.runtime}` : ''}
                    </option>
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
