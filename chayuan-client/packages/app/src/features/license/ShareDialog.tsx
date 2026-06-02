/**
 * ShareDialog — 分享二维码弹层。
 *
 * 展示当日剩余免费次数 + 分享链接的 QR 码，引导用户分享给好友。
 * 与购买的 LicenseDialog 风格镜像，但职责不同：
 *   - LicenseDialog：购买 / 激活序列号
 *   - ShareDialog：生成并展示分享码，让好友扫码安装后双方得奖励
 *
 * 使用 GET /api/share/material?mid=<fingerprint>&app=<app> 取得 shareUrl，
 * 用 qrcode 库本地生成二维码，不依赖外部图片服务。
 */

import { shareUrl as fetchShareUrl } from '@chayuan/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@chayuan/ui';
import QRCode from 'qrcode';
import * as React from 'react';

export interface ShareDialogProps {
  app: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** 今日剩余免费次数（由 consume 返回）。 */
  remainingFree: number;
}

export function ShareDialog({ app, open, onOpenChange, remainingFree }: ShareDialogProps): React.ReactElement {
  const [qr, setQr] = React.useState<string>('');
  const [shareUrl, setShareUrl] = React.useState<string>('');
  const [copied, setCopied] = React.useState(false);
  const [loadErr, setLoadErr] = React.useState<string | null>(null);

  // 打开时获取指纹 → 取分享素材 → 生成 QR。
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    setShareUrl('');
    setQr('');
    setLoadErr(null);

    (async () => {
      try {
        const { url } = await fetchShareUrl(app);
        if (!alive) return;
        if (!url) { setLoadErr('暂不支持该模块的分享'); return; }
        setShareUrl(url);
      } catch {
        if (alive) setLoadErr('生成分享链接失败，请重试');
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, app]);

  // shareUrl → 本地生成 QR 图。
  React.useEffect(() => {
    if (!shareUrl) {
      setQr('');
      return;
    }
    QRCode.toDataURL(shareUrl, { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(''));
  }, [shareUrl]);

  const onCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时静默失败
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>今日还可免费用 {remainingFree} 次</DialogTitle>
          <DialogDescription>
            分享给好友，好友安装后你可继续使用
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          {loadErr ? (
            <p className="text-sm text-destructive">{loadErr}</p>
          ) : qr ? (
            <img src={qr} alt="分享二维码" width={220} height={220} />
          ) : (
            <div className="h-[220px] w-[220px] animate-pulse rounded bg-muted" />
          )}

          <p className="text-center text-xs text-muted-foreground">
            好友扫码下载安装后，你的使用次数自动续期
          </p>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            onClick={() => void onCopyLink()}
            disabled={!shareUrl}
            className="w-full sm:w-auto"
          >
            {copied ? '已复制！' : '复制分享链接'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto"
          >
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
