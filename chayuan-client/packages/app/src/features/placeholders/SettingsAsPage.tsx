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
import {
  Sun, Moon, Monitor, RotateCcw, Volume2, User as UserIcon, Database, Plus,
} from 'lucide-react';
import { Button, cn, Input, Slider, Switch, Pill } from '@chayuan/ui';
import { configureClient } from '@chayuan/api';
import { getPlatform } from '@chayuan/platform-shared';
import { useSettingsStore, type ThemeMode, type LocalePreference } from '../../store/settings';
import { useAuthStore } from '../../store/auth';
import { SUPPORTED_LOCALES, useTranslation } from '../../i18n';
import { AddStructuredSourceDialog } from '../kb/AddStructuredSourceDialog';
import { notifySuccess } from '../../store/errorDialog';

export const SettingsAsPage: React.FC = () => {
  const { t } = useTranslation();
  const settings = useSettingsStore();
  const auth = useAuthStore();
  const platform = getPlatform();
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

      {/* 个人 */}
      <Section label={t('settings.personal')}>
        {auth.user ? (
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
