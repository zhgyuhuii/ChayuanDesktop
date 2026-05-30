/**
 * 授权窗口。spec 的「弹窗：公众号/收款二维码 + 序列号输入 + 确定」。
 *
 * - 二维码**离线本地生成**:编码 `${buyBaseUrl}/buy?app=&mid=`,手机扫码到在线购买页。
 * - 序列号手输 → store.activateSerial(B1,经 PAL 原生验签)。
 * - 导入 .lic 授权文件 → store.activateToken('file',Ed25519)。
 * - 刷新在线授权 → store.activateOnline。
 * 渲染纯 UI;所有平台能力经 PAL,业务态经 license store。
 */

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
  /** 购买页基址(默认 aidooo.com;内网可改) */
  buyBaseUrl?: string;
}

export function LicenseDialog({
  app,
  open,
  onOpenChange,
  buyBaseUrl = 'https://aidooo.com',
}: LicenseDialogProps): React.ReactElement {
  const store = useLicenseStore();
  const [mid, setMid] = React.useState<string | null>(null);
  const [qr, setQr] = React.useState<string>('');
  const [serial, setSerial] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // 取本机指纹(桌面 = PAL.license.fingerprint)→ 生成购买链接 + 离线二维码。
  React.useEffect(() => {
    if (!open) return;
    const host = getPlatform().license;
    if (!host) return;
    host.fingerprint().then(setMid);
  }, [open]);

  const buyUrl = mid ? `${buyBaseUrl}/buy?app=${app}&mid=${mid}` : '';

  React.useEffect(() => {
    if (!buyUrl) return;
    QRCode.toDataURL(buyUrl, { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(''));
  }, [buyUrl]);

  async function run(fn: () => Promise<{ licensed: boolean; reason?: string }>): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const s = await fn();
      if (s.licensed) onOpenChange(false);
      else setErr(reasonText(s.reason));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const onConfirmSerial = () => run(() => store.activateSerial(app, serial.trim()));
  const onRefreshOnline = () => run(() => store.activateOnline(app));
  const onImportFile = () =>
    run(async () => {
      const [file] = await getPlatform().fs.pickFiles({ accept: ['.lic', '.txt'] });
      if (!file) return { licensed: false, reason: 'none' };
      const token = (await file.text()).trim();
      return store.activateToken(app, token, 'file');
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>激活授权</DialogTitle>
          <DialogDescription>
            手机扫码购买后,把序列号填入下方激活;或导入授权文件。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          {qr ? (
            <img src={qr} alt="购买二维码" width={220} height={220} />
          ) : (
            <div className="h-[220px] w-[220px] animate-pulse rounded bg-muted" />
          )}
          {buyUrl ? (
            <a
              className="text-xs text-muted-foreground underline"
              href={buyUrl}
              target="_blank"
              rel="noreferrer"
            >
              在手机微信中打开购买
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

function reasonText(reason?: string): string {
  switch (reason) {
    case 'expired':
      return '授权已过期,请续费。';
    case 'rollback':
      return '检测到系统时间被回拨,请联网校时后重试。';
    case 'mismatch':
      return '该授权不属于本机器。';
    default:
      return '激活失败,请核对序列号或稍后重试。';
  }
}
