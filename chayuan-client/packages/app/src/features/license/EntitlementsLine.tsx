import { licenseStatus } from '@chayuan/api';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { LicenseDialog } from './LicenseDialog';

// 底部状态栏个人权益:有会员显有效期,否则显「免费体验中」。
// 按产品要求**不显示任何剩余次数/余额**;次数用完由各能力入口自动弹购买窗(useUsageGate)。
// 「解除限制」开购买弹窗。
const ENT_APPS: ReadonlyArray<{ app: string; label: string }> = [
  { app: 'chat', label: '对话' },
  { app: 'video', label: '视频生成' },
  { app: 'video_edit', label: '视频编辑' },
  { app: 'avatar', label: '数字人' },
  { app: 'ocr', label: '图转文' },
  { app: 'asr', label: '音转文' },
];

/** 底部状态栏左侧:会员有效期 / 免费体验中 + 解除限制(购买)。不展示剩余次数。 */
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

  return (
    <span className="flex min-w-0 items-center gap-x-2 overflow-hidden whitespace-nowrap">
      {expire ? (
        <span className="shrink-0 font-medium text-[var(--cy-brand-600)]">
          会员有效期至 {String(expire).slice(0, 10)}
        </span>
      ) : (
        <span className="shrink-0 text-[var(--cy-text-tertiary)]">免费体验中</span>
      )}

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
