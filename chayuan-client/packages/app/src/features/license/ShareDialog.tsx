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
 *
 * 次数提示职责补齐：除分享码外，本弹窗也展示本机指纹、提供「购买授权」入口
 * （打开 LicenseDialog，复用其购买/激活全套）、关注公众号查询序列号折叠区。
 */

import { licenseFingerprint, shareUrl as fetchShareUrl } from '@chayuan/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@chayuan/ui';
import { Check, ChevronDown, ChevronUp, Copy, Fingerprint, ShoppingCart } from 'lucide-react';
import QRCode from 'qrcode';
import * as React from 'react';
import { FOLLOW_QR_URL } from '../../lib/brandAssets';

export interface ShareDialogProps {
  app: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** 今日剩余免费次数（由 consume 返回）。 */
  remainingFree: number;
  /**
   * 点击「购买授权」时回调（通常由 UsageGateDialogs 接到 gate.setBuyOpen，
   * 关闭本弹窗并打开 LicenseDialog）。未提供时渲染「关闭」按钮。
   */
  onBuy?: () => void;
}

export function ShareDialog({
  app,
  open,
  onOpenChange,
  onBuy,
}: ShareDialogProps): React.ReactElement {
  const [qr, setQr] = React.useState<string>('');
  const [shareUrl, setShareUrl] = React.useState<string>('');
  const [copied, setCopied] = React.useState(false);
  const [loadErr, setLoadErr] = React.useState<string | null>(null);
  const [fingerprint, setFingerprint] = React.useState('');
  const [fpCopied, setFpCopied] = React.useState(false);
  const [followOpen, setFollowOpen] = React.useState(false);

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

  // 打开时取本机指纹（与购买弹窗一致，便于用户核对/查询序列号）。
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    licenseFingerprint()
      .then((r) => { if (alive) setFingerprint(r.fingerprint); })
      .catch(() => { if (alive) setFingerprint(''); });
    return () => { alive = false; };
  }, [open]);

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

  const onCopyFp = async () => {
    if (!fingerprint) return;
    try {
      await navigator.clipboard.writeText(fingerprint);
      setFpCopied(true);
      setTimeout(() => setFpCopied(false), 2000);
    } catch {
      // 剪贴板不可用时静默
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>邀好友安装 · 解锁更多次数</DialogTitle>
          <DialogDescription>
            邀好友安装得次数；也可直接购买授权解除限制
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
            好友扫码安装并首次使用后，你将获得该功能的使用次数
          </p>

          {/* 本机指纹条（与 LicenseDialog 一致，便于核对/查询序列号） */}
          {fingerprint ? (
            <div className="w-full">
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
                <Fingerprint className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">本机指纹</span>
                <code className="flex-1 truncate font-mono text-foreground">{fingerprint}</code>
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1 text-muted-foreground hover:text-primary"
                  onClick={() => void onCopyFp()}
                >
                  {fpCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  <span>{fpCopied ? '已复制' : '复制'}</span>
                </button>
              </div>
            </div>
          ) : null}

          {/* 公众号折叠区（默认收起，购买后凭指纹查询序列号） */}
          <div className="w-full rounded-lg border bg-muted/30">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setFollowOpen((v) => !v)}
            >
              <span>关注「智灵鸟科技」公众号查询序列号</span>
              {followOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
            {followOpen ? (
              <div className="flex flex-col items-center gap-2 pb-3">
                <img
                  src={FOLLOW_QR_URL}
                  alt="智灵鸟科技公众号"
                  className="size-24 rounded bg-white p-1"
                />
                <p className="text-center text-xs text-muted-foreground">
                  购买后如未记录序列号，可凭本机指纹查询
                </p>
              </div>
            ) : null}
          </div>
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
          {onBuy ? (
            <Button
              onClick={onBuy}
              className="w-full sm:w-auto"
            >
              <ShoppingCart className="size-4" />
              购买授权
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="w-full sm:w-auto"
            >
              关闭
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
