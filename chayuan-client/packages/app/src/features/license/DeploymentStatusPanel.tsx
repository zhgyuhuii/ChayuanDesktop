import * as React from 'react';
import { Button } from '@chayuan/ui';
import { isWeb } from '@chayuan/platform-shared';
import {
  deploymentStatus,
  deploymentActivate,
  type DeploymentStatus,
} from '@chayuan/api';

function reasonText(reason?: string): string {
  switch (reason) {
    case 'bad-signature':
      return '令牌签名无效，请确认复制完整。';
    case 'fp-mismatch':
      return '令牌与本部署指纹不匹配（请用本机指纹购买）。';
    case 'expired':
      return '令牌已过期。';
    case 'not-seat':
    case 'bad-payload':
      return '令牌类型不正确。';
    case 'not-applicable-single-machine':
      return '单机版无需部署授权。';
    default:
      return reason ? `激活失败：${reason}` : '激活失败。';
  }
}

/** 网络版部署席位面板：指纹 / 席位用量 / 到期 + 令牌激活。单机版不渲染。 */
export const DeploymentStatusPanel: React.FC = () => {
  if (!isWeb()) return null;

  const [status, setStatus] = React.useState<DeploymentStatus | null>(null);
  const [token, setToken] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState(false);

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

  const onActivate = async () => {
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      const r = await deploymentActivate(token.trim());
      if (r.ok) {
        setOk(true);
        setToken('');
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

      <div className="rounded-xl border p-4">
        <label className="mb-2 block text-sm font-medium">粘贴部署授权令牌激活</label>
        <textarea
          className="w-full rounded-md border p-2 font-mono text-xs"
          rows={3}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="base64url(payload).base64url(sig)"
        />
        {err ? <p className="mt-2 text-sm text-destructive">{err}</p> : null}
        {ok ? <p className="mt-2 text-sm text-emerald-600">激活成功，席位已更新。</p> : null}
        <div className="mt-3 flex justify-end">
          <Button disabled={busy || !token.trim()} onClick={() => void onActivate()}>
            {busy ? '激活中…' : '激活'}
          </Button>
        </div>
      </div>
    </div>
  );
};
