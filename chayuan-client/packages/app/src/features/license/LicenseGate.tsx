/**
 * 功能门控:spec 的「使用某功能时弹授权窗口」。
 * 包住付费功能入口(如 video-generation);未授权时渲染锁屏 + 激活入口,授权后透传 children。
 * Web(platform.license=undefined)→ store enabled=false → useIsLicensed 恒 true → 直接透传。
 */

import { Button } from '@chayuan/ui';
import * as React from 'react';
import { LicenseDialog } from './LicenseDialog';
import { useIsLicensed, useLicenseStore } from './licenseStore';

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
  const refresh = useLicenseStore((s) => s.refresh);
  const [open, setOpen] = React.useState(false);

  // 进入即刷新本地态(无记录会 best-effort 在线自动激活)。
  React.useEffect(() => {
    void refresh(app);
  }, [app, refresh]);

  if (licensed) return <>{children}</>;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">购买后扫码激活,即可解锁使用。</p>
      <Button onClick={() => setOpen(true)}>购买 / 激活</Button>
      <LicenseDialog app={app} open={open} onOpenChange={setOpen} />
    </div>
  );
}
