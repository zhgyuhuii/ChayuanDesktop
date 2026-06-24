/**
 * 网络版「部署授权」面板 —— 参照单机版「激活授权」(LicenseDialog)的简洁单列设计:
 * 居中扫码购买二维码 + 部署指纹信息条(可复制)+ 授权码激活 + 公众号折叠区。
 * 去掉旧的「席位用量 / 到期」信息卡(用户反馈不需要、且原双列布局太丑)。
 * 走席位授权后端:deploymentStatus(取指纹)/ deploymentActivate(短码或令牌)。单机版不渲染。
 */
import * as React from 'react';
import { Button } from '@chayuan/ui';
import { isWeb, copyText } from '@chayuan/platform-shared';
import QRCode from 'qrcode';
import { Check, Copy, Fingerprint, KeyRound, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';
import {
  deploymentStatus,
  deploymentActivate,
  licenseBuyUrl,
  type DeploymentStatus,
} from '@chayuan/api';
import { FOLLOW_QR_URL } from '../../lib/brandAssets';

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

export const DeploymentStatusPanel: React.FC = () => {
  if (!isWeb()) return null;

  const [status, setStatus] = React.useState<DeploymentStatus | null>(null);
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState(false);
  const [qr, setQr] = React.useState('');
  const [fpCopied, setFpCopied] = React.useState(false);
  const [followOpen, setFollowOpen] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      setStatus(await deploymentStatus());
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  React.useEffect(() => { void refresh(); }, [refresh]);

  // 扫码购买:用部署指纹拼 seat 购买链接并渲染二维码。买后获得授权码,回此处激活。
  React.useEffect(() => {
    const fp = status?.fingerprint;
    if (!fp) return;
    let cancelled = false;
    void (async () => {
      try {
        const { url } = await licenseBuyUrl('web-seat');
        const origin = new URL(url).origin;
        const seatBuyUrl = `${origin}/buy?kind=seat&deployment_fp=${encodeURIComponent(fp)}`;
        const dataUrl = await QRCode.toDataURL(seatBuyUrl, { margin: 1, width: 220 });
        if (!cancelled) setQr(dataUrl);
      } catch {
        /* 购买链接不可用时静默,仍可手动粘贴授权码 */
      }
    })();
    return () => { cancelled = true; };
  }, [status?.fingerprint]);

  const onCopyFp = async () => {
    const fp = status?.fingerprint;
    if (!fp) return;
    try {
      await copyText(fp);
      setFpCopied(true);
      setTimeout(() => setFpCopied(false), 2000);
    } catch { /* 剪贴板不可用时静默 */ }
  };

  const onActivate = async () => {
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      const r = await deploymentActivate(code.trim());
      if (r.ok) { setOk(true); setCode(''); await refresh(); }
      else setErr(reasonText(r.reason));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md p-4">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-foreground">激活授权</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">手机扫码购买后，把授权码填入下方激活。</p>
      </div>

      <div className="flex flex-col gap-3">
        {/* 扫码购买二维码:白底居中 */}
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="inline-block rounded-xl bg-white p-2">
            {qr ? (
              <img src={qr} alt="购买二维码" width={180} height={180} />
            ) : (
              <div className="h-[180px] w-[180px] animate-pulse rounded bg-muted" />
            )}
          </div>
          <p className="px-3 text-center text-xs leading-relaxed text-muted-foreground">
            微信 / 支付宝扫码购买席位授权，已绑定本部署指纹；支付后获得授权码，回此处粘贴激活。
          </p>

          {/* 部署指纹信息条(可复制) */}
          <div className="w-full">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
              <Fingerprint className="size-4 shrink-0 text-muted-foreground" />
              <span className="shrink-0 text-muted-foreground">部署指纹</span>
              <code className="flex-1 truncate font-mono text-foreground">{status?.fingerprint ?? '…'}</code>
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 text-muted-foreground hover:text-primary"
                onClick={() => void onCopyFp()}
                disabled={!status?.fingerprint}
              >
                {fpCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                <span>{fpCopied ? '已复制' : '复制'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* 分隔线 */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          <span>或手动输入授权码</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* 授权码激活(短码或令牌,可能较长 → textarea) */}
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-1.5 text-sm font-medium" htmlFor="seat-code">
            <KeyRound className="size-4" /> 授权码
          </label>
          <textarea
            id="seat-code"
            className="w-full rounded-md border bg-background p-2 font-mono text-xs outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)]"
            rows={3}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XX  或  base64url 令牌"
            autoComplete="off"
          />
          {err ? <p className="text-sm text-destructive">{err}</p> : null}
          {ok ? (
            <p className="flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 className="size-4" /> 激活成功，授权已更新。
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button disabled={busy || !code.trim()} onClick={() => void onActivate()}>
              {busy ? '激活中…' : '激活'}
            </Button>
          </div>
        </div>

        {/* 公众号折叠区(默认收起) */}
        <div className="rounded-lg border bg-muted/30">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setFollowOpen((v) => !v)}
          >
            <span>关注「智灵鸟科技」公众号查询授权码</span>
            {followOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
          {followOpen ? (
            <div className="flex flex-col items-center gap-2 pb-3">
              <img src={FOLLOW_QR_URL} alt="智灵鸟科技公众号" className="size-24 rounded bg-white p-1" />
              <p className="text-center text-xs text-muted-foreground">购买后如未记录授权码，可凭本部署指纹查询</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
