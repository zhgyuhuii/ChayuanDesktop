/**
 * 「我的权限」面板(系统设置内):列出本机购买/授权记录。
 * 数据来自本地 chayuan-server `GET /api/v1/license/entitlements`:
 * 在线时含产品/到期/购买时间/支付金额/序列号;断网回落本地激活(无金额/购买时间)。
 */

import { type EntitlementItem, licenseEntitlements } from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw } from 'lucide-react';
import * as React from 'react';

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtYuan(fen?: number | null): string {
  if (fen == null) return '—';
  const v = fen / 100;
  return `¥${Number.isInteger(v) ? v : v.toFixed(2)}`;
}

export function MyEntitlementsSection(): React.ReactElement {
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<EntitlementItem[]>([]);
  const [online, setOnline] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await licenseEntitlements();
      setItems(r.items || []);
      setOnline(r.online);
    } catch (e) {
      setErr((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">本机购买的产品与授权状态。</p>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          刷新
        </Button>
      </div>

      {!online && !loading ? (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
          当前未联网,仅显示本地授权(无购买时间与金额)。联网后刷新可看到完整记录。
        </p>
      ) : null}

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
      ) : err ? (
        <p className="py-8 text-center text-sm text-destructive">{err}</p>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">暂无购买记录。</p>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div
              key={`${it.serial || it.app}-${i}`}
              className="rounded-lg border border-border p-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{it.productName || it.app}</span>
                <span
                  className={
                    it.active
                      ? 'rounded-full bg-emerald-500/12 px-2 py-0.5 text-xs font-medium text-emerald-600'
                      : 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                  }
                >
                  {it.active ? '有效' : '已过期'}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <dt>到期</dt>
                  <dd className="text-foreground">{fmtDate(it.expireAt)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>购买时间</dt>
                  <dd className="text-foreground">{fmtDate(it.paidAt)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>支付金额</dt>
                  <dd className="text-foreground">{fmtYuan(it.amountFen)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>序列号</dt>
                  <dd className="truncate font-mono text-foreground" title={it.serial || ''}>
                    {it.serial || '—'}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
