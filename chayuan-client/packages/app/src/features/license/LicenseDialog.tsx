/**
 * 授权窗口。spec 的「弹窗：公众号/收款二维码 + 序列号输入 + 确定」。
 *
 * - 购买链接从后端 `GET /api/v1/license/buy-url` 取（后端把本机指纹直接拼进 URL，
 *   前端不经手 mid）。
 * - 二维码本地生成（编码后端给的购买链接），手机扫码到在线购买页。
 * - 序列号手输 → store.activateSerial（B1，后端验签）。
 * - 导入 .lic → store.activateToken（Ed25519，后端验签）。
 * - 刷新在线授权 → store.refresh（后端内部做偶尔在线自动激活）。
 */

import { type PayChannels, licenseBuyUrl } from '@chayuan/api';
import { getPlatform } from '@chayuan/platform-shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@chayuan/ui';
import QRCode from 'qrcode';
import * as React from 'react';
import { useLicenseStore } from './licenseStore';

export interface LicenseDialogProps {
  app: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function LicenseDialog({ app, open, onOpenChange }: LicenseDialogProps): React.ReactElement {
  const store = useLicenseStore();
  const [qr, setQr] = React.useState<string>('');
  const [buyUrl, setBuyUrl] = React.useState<string>('');
  const [channels, setChannels] = React.useState<PayChannels | null>(null);
  const [serial, setSerial] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // 取购买链接 + 支持的支付渠道（后端拼 指纹 + app）→ 生成离线二维码。
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    licenseBuyUrl(app)
      .then((r) => {
        if (!alive) return;
        setBuyUrl(r.url);
        setChannels(r.channels ?? null);
      })
      .catch(() => {
        if (alive) setBuyUrl('');
      });
    return () => {
      alive = false;
    };
  }, [open, app]);

  const scanText = channelScanText(channels);

  React.useEffect(() => {
    if (!buyUrl) {
      setQr('');
      return;
    }
    QRCode.toDataURL(buyUrl, { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(''));
  }, [buyUrl]);

  // fn 返回 null = 无操作（如用户取消选文件），不报错、不关窗。
  async function run(
    fn: () => Promise<{ licensed: boolean; reason?: string } | null>,
  ): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const s = await fn();
      if (!s) return;
      if (s.licensed) onOpenChange(false);
      else setErr(reasonText(s.reason));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const onConfirmSerial = () => run(() => store.activateSerial(app, serial.trim()));
  const onRefreshOnline = () => run(() => store.refresh(app));
  const onImportFile = () =>
    run(async () => {
      const [file] = await getPlatform().fs.pickFiles({ accept: ['.lic', '.txt'] });
      if (!file) return null; // 用户取消选文件
      const token = (await file.text()).trim();
      return store.activateToken(app, token);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>激活授权</DialogTitle>
          <DialogDescription>
            手机扫码购买后，把序列号填入下方激活；或导入授权文件。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          {qr ? (
            <img src={qr} alt="购买二维码" width={220} height={220} />
          ) : (
            <div className="h-[220px] w-[220px] animate-pulse rounded bg-muted" />
          )}

          {/* 支持的支付渠道：按后台「支付配置」开关显示官方 logo */}
          {channels && (channels.wechat || channels.alipay) ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{scanText}</span>
              {channels.wechat ? <WeChatLogo /> : null}
              {channels.alipay ? <AlipayLogo /> : null}
            </div>
          ) : null}

          {buyUrl ? (
            <a
              className="text-xs text-muted-foreground underline"
              href={buyUrl}
              target="_blank"
              rel="noreferrer"
            >
              或在手机中打开购买页
            </a>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="lic-serial">
            序列号
          </label>
          <div className="flex gap-2">
            <Input
              id="lic-serial"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXX"
              autoComplete="off"
            />
            <Button onClick={onConfirmSerial} disabled={busy || serial.trim().length === 0}>
              确定
            </Button>
          </div>
          {err ? <p className="text-sm text-destructive">{err}</p> : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onImportFile} disabled={busy}>
            导入授权文件
          </Button>
          <Button variant="outline" onClick={onRefreshOnline} disabled={busy}>
            刷新在线授权
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 按支持的渠道给扫码提示文案。 */
function channelScanText(ch: PayChannels | null): string {
  if (!ch) return '扫码购买';
  if (ch.wechat && ch.alipay) return '微信 / 支付宝 扫码购买';
  if (ch.wechat) return '微信扫码购买';
  if (ch.alipay) return '支付宝扫码购买';
  return '扫码购买';
}

/** 微信官方 logo(brand 路径 + 官方绿)。 */
function WeChatLogo(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 576 512"
      width={22}
      height={22}
      aria-label="微信支付"
      role="img"
      style={{ color: '#07c160' }}
    >
      <path
        fill="currentColor"
        d="M385.2 167.6c6.4 0 12.6 .3 18.8 1.1C387.4 90.3 303.3 32 207.7 32 100.5 32 13 104.8 13 197.4c0 53.4 29.3 97.5 78.2 131.6l-19.6 58.8 68.6-34.3c24.5 4.9 44.1 9.8 68.6 9.8 6.1 0 12.1-.3 18.1-.8-3.8-13.1-6.1-26.8-6.1-41.1 0-85.6 73.8-155.8 165.4-155.8zm-104.5-52.9c14.7 0 24.5 9.8 24.5 24.5 0 14.7-9.8 24.5-24.5 24.5-14.7 0-29.4-9.8-29.4-24.5 0-14.7 14.7-24.5 29.4-24.5zm-147 49c-14.7 0-29.4-9.8-29.4-24.5 0-14.7 14.7-24.5 29.4-24.5 14.7 0 24.5 9.8 24.5 24.5 0 14.7-9.8 24.5-24.5 24.5zM563 319.4c0-77.9-77.9-141.3-165.4-141.3-92.7 0-165.4 63.4-165.4 141.3S305 460.7 397.6 460.7c19.6 0 39.2-4.9 58.8-9.8l53.9 29.4-14.7-48.9c39.1-29.4 67.4-68.6 67.4-112.7zm-219.3-24.5c-9.8 0-19.6-9.8-19.6-19.6 0-9.8 9.8-19.6 19.6-19.6 14.7 0 24.5 9.8 24.5 19.6 0 9.8-9.8 19.6-24.5 19.6zm98 0c-9.8 0-19.6-9.8-19.6-19.6 0-9.8 9.8-19.6 19.6-19.6 14.7 0 24.5 9.8 24.5 19.6 0 9.8-9.8 19.6-24.5 19.6z"
      />
    </svg>
  );
}

/** 支付宝官方 logo(brand 路径 + 官方蓝)。 */
function AlipayLogo(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 448 512"
      width={22}
      height={22}
      aria-label="支付宝"
      role="img"
      style={{ color: '#1677ff' }}
    >
      <path
        fill="currentColor"
        d="M377.74 32H70.26C31.41 32 0 63.41 0 102.26v307.48C0 448.59 31.41 480 70.26 480h307.48c38.52 0 69.76-31.08 70.26-69.6-45.96-25.62-110.59-60.34-171.6-89.81-37.99 46.46-87.71 78.4-139.34 78.4-87.5 0-117.13-76.37-72.62-126.61 9.71-10.95 26.27-21.4 52-27.66 40.23-9.78 104.27 6.27 164.73 26.08 10.91-20.06 20.04-42.07 26.77-65.51H94.32v-18.54h94.42v-33.79H75.16V123.6h113.58V92.26c0-9.96 8.06-18.07 18.07-18.07h41.46v49.41h114.04v18.54H248.27v33.79h93.27c-8.34 33.86-21.07 65.13-37.43 92.61 26.34 9.59 50.13 18.74 67.6 24.74 67.66 23.18 67.83 23.16 84.07 27.74V102.26C448 63.41 416.59 32 377.74 32z"
      />
    </svg>
  );
}

function reasonText(reason?: string): string {
  switch (reason) {
    case 'expired':
      return '授权已过期，请续费。';
    case 'rollback':
      return '检测到系统时间被回拨，请联网校时后重试。';
    case 'mismatch':
      return '该授权不属于本机器。';
    case 'invalid-app':
      return '该授权适用于其他产品，请使用对应产品的授权码。';
    case 'signature':
      return '授权凭证签名校验失败。';
    default:
      return '激活失败，请核对序列号或稍后重试。';
  }
}
