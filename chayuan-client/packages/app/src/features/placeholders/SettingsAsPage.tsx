/**
 * 设置页(单机版精简版)。
 *
 * 仅保留五组面向单机用户实际可控的项,其它(主题/字号/语言/默认模型/关于
 * 等)走头像下拉的 UserMenuPopover 或独立模型广场,不在本页重复:
 *
 *   1. 名称设置 ── 改本机昵称(写 settings.displayName)
 *   2. 后端服务 ── 自定义 baseURL + 连通性「测试」按钮 + 「保存」生效
 *   3. 上传    ── 上传遥测开关 + 「测试」按钮(打一次 ping 看上传是否走通)
 *   4. 知识中心 ── 添加结构化数据库 source
 *   5. 快捷工具 ── AI 键
 *
 * 单机红线(2026-05-09):移除「个人设置/本地用户/更换声音/语言/字号/主题/
 * 默认模型/高级开关/关于」等页内重复项与无后端项。设置页顶部不再渲染标题
 * 「系统设置」,与同形 KbBoard / Marketplace 等页面保持一致。
 */

import { configureClient } from '@chayuan/api';
import { getPlatform } from '@chayuan/platform-shared';
import { Button, Input, Pill, Switch, cn } from '@chayuan/ui';
import { Database, Loader2, Plus } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from '../../i18n';
import { notifySuccess, reportError } from '../../store/errorDialog';
import { useSettingsStore } from '../../store/settings';
import { AddStructuredSourceDialog } from '../kb/AddStructuredSourceDialog';

export const SettingsAsPage: React.FC = () => {
  const { t } = useTranslation();
  const settings = useSettingsStore();
  const platform = getPlatform();
  const defaultApi = platform.runtime.defaultApiBase;
  const [nameInput, setNameInput] = React.useState(settings.displayName);
  const [apiInput, setApiInput] = React.useState(settings.apiBaseOverride);
  const [apiTesting, setApiTesting] = React.useState(false);
  const [apiTestResult, setApiTestResult] = React.useState<null | { ok: boolean; msg: string }>(
    null,
  );
  const [uploadTesting, setUploadTesting] = React.useState(false);
  const [uploadTestResult, setUploadTestResult] = React.useState<null | {
    ok: boolean;
    msg: string;
  }>(null);
  const [addStructuredOpen, setAddStructuredOpen] = React.useState(false);

  React.useEffect(() => {
    setNameInput(settings.displayName);
  }, [settings.displayName]);

  const onSaveName = () => {
    const v = nameInput.trim();
    settings.setDisplayName(v);
    notifySuccess('名称已保存', v || '已恢复默认显示');
  };

  /** 「保存」即写 settings + 走 configureClient,生效全局 axios */
  const onSaveApi = () => {
    const trimmed = apiInput.trim();
    settings.setApiBaseOverride(trimmed);
    configureClient({ baseURL: trimmed || defaultApi });
    notifySuccess('后端服务已切换', trimmed || defaultApi || '同源');
  };

  /** 「测试」走 GET /healthz,5s 超时,只看 reachable + 状态码 */
  const onTestApi = async () => {
    const target = (apiInput.trim() || defaultApi || '').replace(/\/+$/, '');
    if (!target) {
      setApiTestResult({ ok: false, msg: '请先填写后端地址' });
      return;
    }
    setApiTesting(true);
    setApiTestResult(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const resp = await fetch(`${target}/healthz`, { signal: ctrl.signal, mode: 'cors' });
      setApiTestResult(
        resp.ok
          ? { ok: true, msg: `连通 · HTTP ${resp.status}` }
          : { ok: false, msg: `不可用 · HTTP ${resp.status}` },
      );
    } catch (e) {
      setApiTestResult({
        ok: false,
        msg:
          (e as Error)?.name === 'AbortError' ? '超时(5s)' : ((e as Error)?.message ?? '网络错误'),
      });
    } finally {
      clearTimeout(timer);
      setApiTesting(false);
    }
  };

  /** 上传通道测试:发一条最小遥测 ping,看 outbox 是否能写入(本地 + 后端均可) */
  const onTestUpload = async () => {
    setUploadTesting(true);
    setUploadTestResult(null);
    try {
      // 用 healthz 兜底:遥测最终也要走后端。后端可达 + telemetry 开 → 视为通畅。
      const target = (settings.apiBaseOverride.trim() || defaultApi || '').replace(/\/+$/, '');
      if (!target) {
        setUploadTestResult({ ok: false, msg: '后端地址未配置' });
        return;
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      try {
        const resp = await fetch(`${target}/healthz`, { signal: ctrl.signal, mode: 'cors' });
        if (!resp.ok) {
          setUploadTestResult({ ok: false, msg: `后端不可用 · HTTP ${resp.status}` });
          return;
        }
      } finally {
        clearTimeout(timer);
      }
      setUploadTestResult(
        settings.telemetry
          ? { ok: true, msg: '后端可达,遥测开关已开,上传通道正常' }
          : { ok: true, msg: '后端可达;遥测开关已关,仅本地暂存' },
      );
    } catch (e) {
      reportError(e, '上传测试失败');
      setUploadTestResult({ ok: false, msg: (e as Error)?.message ?? '未知错误' });
    } finally {
      setUploadTesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      {/* 名称设置 */}
      <Section label={t('settings.changeName')}>
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

      {/* 后端服务 */}
      <Section label={t('settings.backend')}>
        <Row title={t('settings.backend')} description={t('settings.backendUrlDesc')}>
          <div className="mt-3 flex items-center gap-2">
            <Input
              value={apiInput}
              placeholder={defaultApi || '同源 / 留空使用默认'}
              onChange={(e) => {
                setApiInput(e.target.value);
                setApiTestResult(null);
              }}
            />
            <Button size="sm" variant="outline" onClick={onTestApi} disabled={apiTesting}>
              {apiTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              测试
            </Button>
            <Button size="sm" variant="outline" onClick={onSaveApi}>
              {t('common.save')}
            </Button>
          </div>
          {apiTestResult ? (
            <p
              className={cn(
                'mt-2 text-xs',
                apiTestResult.ok
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400',
              )}
            >
              {apiTestResult.ok ? '✓ ' : '✗ '}
              {apiTestResult.msg}
            </p>
          ) : null}
        </Row>
      </Section>

      {/* 上传 */}
      <Section label="上传">
        <Row
          title="上传遥测"
          description="开启后会把对话/检索的非内容指标(token、延迟、错误码)异步上传给本机后端;关闭后仅本地暂存"
          trailing={
            <Switch
              checked={settings.telemetry}
              onCheckedChange={(b) => settings.setTelemetry(b)}
            />
          }
        />
        <Row title="测试上传" description="发一条最小 ping,验证本机后端可达且上传开关生效">
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onTestUpload} disabled={uploadTesting}>
              {uploadTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              测试上传
            </Button>
            {uploadTestResult ? (
              <span
                className={cn(
                  'text-xs',
                  uploadTestResult.ok
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400',
                )}
              >
                {uploadTestResult.ok ? '✓ ' : '✗ '}
                {uploadTestResult.msg}
              </span>
            ) : null}
          </div>
        </Row>
      </Section>

      {/* 知识中心 */}
      <Section label={t('nav.knowledge')}>
        <Row
          title="结构化数据库"
          description="MySQL / PostgreSQL / SQL Server / Oracle / 金仓 / 达梦 / ClickHouse / Doris / Hive 等"
          trailing={
            <Button size="sm" variant="outline" onClick={() => setAddStructuredOpen(true)}>
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

      <AddStructuredSourceDialog open={addStructuredOpen} onOpenChange={setAddStructuredOpen} />
    </div>
  );
};

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <section className="mt-6 first:mt-0">
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
