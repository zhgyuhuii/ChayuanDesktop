import { licenseStatus } from '@chayuan/api';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@chayuan/ui';
import { LicenseDialog } from './LicenseDialog';

// 底部状态栏个人权益:有会员显有效期,否则显对话/视频生成/视频编辑今日剩余;
// 「详情」展开全部权益(今日免费 + 购买/赠送次数),「解除限制」开购买弹窗。
const ENT_APPS: ReadonlyArray<{ app: string; label: string }> = [
  { app: 'chat', label: '对话' },
  { app: 'video', label: '视频生成' },
  { app: 'video_edit', label: '视频编辑' },
  { app: 'avatar', label: '数字人' },
  { app: 'ocr', label: '图转文' },
  { app: 'asr', label: '音转文' },
];
// 折叠态只展示这几个的今日剩余(其余进「详情」)
const COLLAPSED_APPS: ReadonlyArray<string> = ['chat', 'video', 'video_edit'];

/** 底部状态栏左侧:折叠摘要 + 详情浮层 + 解除限制(购买)。 */
export const EntitlementsLine: React.FC = () => {
  const [buyOpen, setBuyOpen] = React.useState(false);
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
  const collapsed = items.filter((i) => COLLAPSED_APPS.includes(i.app));

  return (
    <span className="flex min-w-0 items-center gap-x-2 overflow-hidden whitespace-nowrap">
      {expire ? (
        // 有会员:只显有效期
        <span className="shrink-0 font-medium text-[var(--cy-brand-600)]">
          会员有效期至 {String(expire).slice(0, 10)}
        </span>
      ) : (
        // 无会员:今日剩余 对话/视频生成/视频编辑
        <>
          <span className="shrink-0 text-[var(--cy-text-secondary)]">今日剩余</span>
          {collapsed.map((i) => (
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
        </>
      )}

      {/* 详情:点开浮层列全部权益 */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="shrink-0 text-[var(--cy-brand-600)] hover:underline"
          >
            详情
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-72 text-xs">
          <div className="mb-1.5 text-sm font-semibold text-[var(--cy-text-primary)]">我的权益</div>
          {expire ? (
            <div className="mb-1.5 font-medium text-[var(--cy-brand-600)]">
              会员有效期至 {String(expire).slice(0, 10)}
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            {items.map((i) => (
              <div key={i.app} className="flex items-center justify-between gap-3">
                <span className="text-[var(--cy-text-secondary)]">{i.label}</span>
                <span className="text-[var(--cy-text-primary)]">
                  今日免费 <span className="font-semibold">{i.s ? (i.s.remainingFree ?? 0) : '—'}</span>
                  {(i.s?.counts ?? 0) > 0 ? (
                    <span className="ml-1 text-[var(--cy-brand-600)]">· 购买/赠送 {i.s?.counts}</span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* 解除限制:打开购买弹窗(复用 LicenseDialog,内含购买二维码 + 序列号激活) */}
      <button
        type="button"
        onClick={() => setBuyOpen(true)}
        className="shrink-0 rounded border border-[var(--cy-brand-500)] px-1.5 py-0.5 font-medium text-[var(--cy-brand-600)] hover:bg-[var(--cy-surface-2)]"
      >
        解除限制
      </button>
      <LicenseDialog app="chat" open={buyOpen} onOpenChange={setBuyOpen} />
    </span>
  );
};
