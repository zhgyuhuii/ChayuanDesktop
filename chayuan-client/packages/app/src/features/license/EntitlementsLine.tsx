import { licenseStatus } from '@chayuan/api';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

// 底部状态栏个人权益:今日各功能剩余免费次数 + 购买的会员到期(只读 GET /license/status)。
const ENT_APPS: ReadonlyArray<{ app: string; label: string }> = [
  { app: 'chat', label: '对话' },
  { app: 'video', label: '视频生成' },
  { app: 'video_edit', label: '视频编辑' },
  { app: 'avatar', label: '数字人' },
  { app: 'ocr', label: '图转文' },
  { app: 'asr', label: '音转文' },
];

/** 底部状态栏左侧:单行展示今日剩余各功能次数 + 会员有效期(不换行,溢出由父容器裁剪)。 */
export const EntitlementsLine: React.FC = () => {
  const q = useQuery({
    queryKey: ['license.statuses'],
    queryFn: async () =>
      Promise.all(
        ENT_APPS.map((a) =>
          licenseStatus(a.app)
            .then((s) => ({ ...a, s }))
            .catch(() => ({ ...a, s: null as null })),
        ),
      ),
    staleTime: 60_000,
  });
  const items = q.data ?? [];
  const expire = items.map((i) => i.s?.timeExpireAt).find(Boolean) || null;
  if (!items.length) {
    return <span className="text-[var(--cy-text-tertiary)]">个人权益:加载中…</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-x-2 overflow-hidden whitespace-nowrap">
      <span className="shrink-0 text-[var(--cy-text-secondary)]">今日剩余</span>
      {items.map((i) => (
        <span key={i.app} className="shrink-0">
          {i.label}
          <span
            className={`ml-0.5 font-semibold ${
              (i.s?.remainingFree ?? 0) > 0 ? 'text-[var(--cy-brand-600)]' : 'text-[var(--cy-danger-500)]'
            }`}
          >
            {i.s ? (i.s.remainingFree ?? 0) : '—'}
          </span>
          次
        </span>
      ))}
      {expire ? (
        <span className="shrink-0 text-[var(--cy-brand-600)]">· 会员有效期至 {String(expire).slice(0, 10)}</span>
      ) : null}
    </span>
  );
};
