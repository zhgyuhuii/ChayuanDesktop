import * as React from 'react';
import { Button } from '@chayuan/ui';
import { isWeb } from '@chayuan/platform-shared';
import QRCode from 'qrcode';
import {
  deploymentStatus,
  deploymentActivate,
  licenseBuyUrl,
  type DeploymentStatus,
} from '@chayuan/api';

function reasonText(reason?: string): string {
  switch (reason) {
    case 'bad-signature':
    case 'signature':
      return '授权码/令牌签名无效，请确认复制完整。';
    case 'checksum':
    case 'decode':
    case 'length':
      return '授权码格式不正确（请核对是否漏字符）。';
    case 'fp-mismatch':
      return '与本部署指纹不匹配（请用本机指纹购买）。';
    case 'expired':
      return '授权已过期。';
    case 'unknown-key':
      return '签发密钥版本不被识别（请更新到最新版本）。';
    case 'not-seat':
    case 'bad-payload':
      return '授权码类型不正确（非席位授权）。';
    case 'not-applicable-single-machine':
      return '单机版无需部署授权。';
    default:
      return reason ? `激活失败：${reason}` : '激活失败。';
  }
}

/** 网络版部署席位面板：指纹 / 席位用量 / 到期 + 扫码购买 + 授权码(短码/令牌)激活。单机版不渲染。 */
export const DeploymentStatusPanel: React.FC = () => {
  if (!isWeb()) return null;

  const [status, setStatus] = React.useState<DeploymentStatus | null>(null);
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState(false);
  const [qr, setQr] = React.useState('');
  const [buyUrl, setBuyUrl] = React.useState('');

  const refresh = React.useCallback(async () => {
    try {
      setStatus(await deploymentStatus());
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // 扫码购买:用部署指纹拼 seat 购买链接并渲染二维码。买后获得 seat 短码,回此处激活。
  React.useEffect(() => {
    const fp = status?.fingerprint;
    if (!fp) return;
    let cancelled = false;
    void (async () => {
      try {
        const { url } = await licenseBuyUrl('web-seat');
        const origin = new URL(url).origin;
        const seatBuyUrl = `${origin}/buy?kind=seat&deployment_fp=${encodeURIComponent(fp)}`;
        if (cancelled) return;
        setBuyUrl(seatBuyUrl);
        const dataUrl = await QRCode.toDataURL(seatBuyUrl, { margin: 1, width: 200 });
        if (!cancelled) setQr(dataUrl);
      } catch {
        /* 购买链接不可用时静默,仍可手动粘贴授权码 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status?.fingerprint]);

  const onActivate = async () => {
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      const r = await deploymentActivate(code.trim());
      if (r.ok) {
        setOk(true);
        setCode('');
        await refresh();
      } else {
        setErr(reasonText(r.reason));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const used = status?.usedUsers ?? 0;
  const max = status?.maxUsers;

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl border p-4">
        <h3 className="mb-2 text-sm font-semibold">部署授权</h3>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">席位用量</dt>
          <dd>{max == null ? '无限制（单机）' : `${used} / ${max}`}</dd>
          <dt className="text-muted-foreground">到期</dt>
          <dd>{status?.expireAt ? new Date(status.expireAt).toLocaleDateString() : '—'}</dd>
          <dt className="text-muted-foreground">部署指纹（购买时上报）</dt>
          <dd className="font-mono text-xs break-all">{status?.fingerprint ?? '…'}</dd>
        </dl>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 扫码购买 */}
        <div className="rounded-xl border p-4">
          <h4 className="mb-2 text-sm font-medium">扫码购买席位授权</h4>
          {qr ? (
            <div className="flex flex-col items-center gap-2">
              <img src={qr} alt="购买二维码" width={180} height={180} />
              <p className="text-center text-xs text-muted-foreground">
                微信/支付宝扫码购买席位，已绑定本部署指纹；支付后获得授权码，回此处粘贴激活。
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              购买二维码加载中…若长时间无二维码，请直接联系销售获取授权码。
            </p>
          )}
        </div>

        {/* 授权码激活 */}
        <div className="rounded-xl border p-4">
          <label className="mb-2 block text-sm font-medium">粘贴授权码激活（短码或令牌）</label>
          <textarea
            className="w-full rounded-md border p-2 font-mono text-xs"
            rows={3}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XX  或  base64url 令牌"
          />
          {err ? <p className="mt-2 text-sm text-destructive">{err}</p> : null}
          {ok ? <p className="mt-2 text-sm text-emerald-600">激活成功，席位已更新。</p> : null}
          <div className="mt-3 flex justify-end">
            <Button disabled={busy || !code.trim()} onClick={() => void onActivate()}>
              {busy ? '激活中…' : '激活'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
