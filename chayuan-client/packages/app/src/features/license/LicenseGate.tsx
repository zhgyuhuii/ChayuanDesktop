/**
 * 功能门控：spec 的「使用某功能时弹授权窗口」。
 * 包住付费功能入口（如 video-generation）；未授权时渲染锁屏 + 激活入口，授权后透传 children。
 * 首刷未回前显 loading，避免闪锁屏。授权判定 fail-closed（后端 licensed 为唯一真源）。
 */

import { Button } from '@chayuan/ui';
import * as React from 'react';
import { LicenseDialog } from './LicenseDialog';
import { useIsLicensed, useLicenseReady, useLicenseStore } from './licenseStore';

export interface LicenseGateProps {
  app: string;
  children: React.ReactNode;
  title?: string;
}

export function LicenseGate({
  app,
  children,
  title = '此功能需要授权',
}: LicenseGateProps): React.ReactElement {
  const licensed = useIsLicensed(app);
  const ready = useLicenseReady(app);
  const refresh = useLicenseStore((s) => s.refresh);
  const [open, setOpen] = React.useState(false);

  // 进入即刷新后端态（后端内部会 best-effort 偶尔在线自动激活）。
  React.useEffect(() => {
    void refresh(app);
  }, [app, refresh]);

  if (licensed) return <>{children}</>;

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">购买后扫码激活，即可解锁使用。</p>
      <Button onClick={() => setOpen(true)}>购买 / 激活</Button>
      <LicenseDialog app={app} open={open} onOpenChange={setOpen} />
    </div>
  );
}
