/**
 * StorageConfigPage —— 管理控制台「对象存储」域(P4)。复用既有 /storage/*。
 * 切换 local/minio + MinIO 字段 + 测试 + 迁移。切后端/迁移为敏感操作,带确认。改后需重启。
 */
import * as React from 'react';
import { storageConfig, type StorageInfo, type MinioFields } from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw, Wifi, Save, ArrowRightLeft } from 'lucide-react';
import { notifySuccess, reportError } from '../../../store/errorDialog';
import { confirmDialog } from '../../../store/confirmDialog';

const FIELD =
  'mt-1 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)] dark:bg-zinc-800';
const EMPTY_MINIO: MinioFields = {
  endpoint: '', access_key: '', secret_key: '', secure: false, region: 'us-east-1', bucket_prefix: 'chayuan',
};
const NAMESPACES = ['kb-content', 'chat-temp', 'image-files', 'misc'];

export const StorageConfigPage: React.FC = () => {
  const [info, setInfo] = React.useState<StorageInfo | null>(null);
  const [backend, setBackend] = React.useState<'local' | 'minio'>('local');
  const [minio, setMinio] = React.useState<MinioFields>(EMPTY_MINIO);
  const [test, setTest] = React.useState<{ ok: boolean; error?: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  // 迁移
  const [ns, setNs] = React.useState<string>(NAMESPACES[0] ?? 'misc');
  const [dir, setDir] = React.useState<'local_to_minio' | 'minio_to_local'>('local_to_minio');

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const s = await storageConfig.status();
      setInfo(s);
      const sv = s.saved;
      // 回显:优先用「已保存配置」(切了没重启也能回显);secret_key 不回传,留空表示不改。
      const b: 'local' | 'minio' =
        sv?.backend === 'minio' || (!sv && s.backend === 'minio') ? 'minio' : 'local';
      setBackend(b);
      if (sv) {
        setMinio({
          endpoint: sv.endpoint || '',
          access_key: sv.access_key || '',
          secret_key: '',
          secure: !!sv.secure,
          region: sv.region || 'us-east-1',
          bucket_prefix: sv.bucket_prefix || 'chayuan',
        });
      } else if (s.backend === 'minio') {
        setMinio((m) => ({ ...m, endpoint: s.endpoint || m.endpoint }));
      }
    } catch (e) {
      reportError(e, '读取存储状态失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const setM = (k: keyof MinioFields, v: string | boolean) => setMinio((m) => ({ ...m, [k]: v }));

  const doTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      setTest(await storageConfig.testMinio(minio));
    } catch (e) {
      reportError(e, '测试失败');
    } finally {
      setBusy(false);
    }
  };

  const doSave = async () => {
    const msg =
      backend === 'minio'
        ? '将把存储后端切到 MinIO 并写入 basic_settings。旧数据不会自动迁移,重启后生效。'
        : '将把存储后端切回本机磁盘,重启后生效。';
    if (!(await confirmDialog(msg, { title: '切换存储后端？', danger: true }))) return;
    setBusy(true);
    try {
      await storageConfig.switch(backend, backend === 'minio' ? minio : undefined);
      notifySuccess('已保存 — 重启服务后生效');
      await load();
    } catch (e) {
      reportError(e, '切换失败');
    } finally {
      setBusy(false);
    }
  };

  const doMigrate = async (dryRun: boolean) => {
    if (!dryRun && !(await confirmDialog(`将迁移 namespace「${ns}」(${dir})。`, { title: '执行数据迁移？', danger: true })))
      return;
    setBusy(true);
    try {
      const r = await storageConfig.migrate({ namespace: ns, direction: dir, dry_run: dryRun });
      notifySuccess(dryRun ? `预演:扫描 ${r.scanned ?? 0} / 可迁 ${r.moved ?? 0}` : `已迁移 ${r.moved ?? 0} 个对象`);
    } catch (e) {
      reportError(e, '迁移失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">对象存储</h2>
          <p className="mt-1 text-xs opacity-60">知识库 / 图像 / 上传文件的存储后端。local=本机磁盘;minio=S3 兼容对象存储。改动需重启。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </Button>
      </div>

      {info && (
        <div className="rounded-md bg-[var(--cy-surface-2)] px-3 py-2 text-xs">
          当前后端：<b>{info.backend ?? '?'}</b>
          {info.endpoint ? ` · ${info.endpoint}` : ''}
          {typeof info.healthy === 'boolean' ? ` · ${info.healthy ? '正常' : '异常'}` : ''}
        </div>
      )}

      <label className="block text-xs">
        <span className="opacity-60">存储后端</span>
        <select className={FIELD} value={backend} onChange={(e) => setBackend(e.target.value as 'local' | 'minio')}>
          <option value="local">local（本机磁盘）</option>
          <option value="minio">minio（S3 兼容对象存储）</option>
        </select>
      </label>

      {backend === 'minio' && (
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-xs">
            <span className="opacity-60">Endpoint</span>
            <input className={FIELD} placeholder="127.0.0.1:9000 或 https://s3.amazonaws.com" value={minio.endpoint} onChange={(e) => setM('endpoint', e.target.value)} />
            <button type="button" className="mt-1 text-[11px] text-[var(--cy-brand-600)] hover:underline" onClick={() => setM('endpoint', 'minio:9000')}>容器服务名(minio:9000)</button>
          </label>
          <label className="text-xs">
            <span className="opacity-60">Access Key</span>
            <input className={FIELD} value={minio.access_key} onChange={(e) => setM('access_key', e.target.value)} />
          </label>
          <label className="text-xs">
            <span className="opacity-60">Secret Key</span>
            <input type="password" className={FIELD} placeholder={info?.saved?.secret_key_set ? '已保存(留空则不修改)' : ''} value={minio.secret_key} onChange={(e) => setM('secret_key', e.target.value)} />
          </label>
          <label className="text-xs">
            <span className="opacity-60">Region</span>
            <input className={FIELD} value={minio.region} onChange={(e) => setM('region', e.target.value)} />
          </label>
          <label className="text-xs">
            <span className="opacity-60">Bucket 前缀</span>
            <input className={FIELD} value={minio.bucket_prefix} onChange={(e) => setM('bucket_prefix', e.target.value)} />
          </label>
          <label className="col-span-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={minio.secure} onChange={(e) => setM('secure', e.target.checked)} /> 使用 HTTPS（secure）
          </label>
          {test && (
            <div className={`col-span-2 rounded-md px-3 py-2 text-xs ${test.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {test.ok ? '连通成功。' : `失败：${test.error}`}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={() => void doSave()} disabled={busy}>
          <Save className="mr-1.5 h-4 w-4" /> 保存切换
        </Button>
        {backend === 'minio' && (
          <Button variant="outline" onClick={() => void doTest()} disabled={busy}>
            <Wifi className="mr-1.5 h-4 w-4" /> 测试连通
          </Button>
        )}
      </div>

      {/* 数据迁移 */}
      <div className="rounded-lg border border-[var(--cy-border-subtle)] p-4">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
          <ArrowRightLeft className="h-4 w-4" /> 数据迁移
        </div>
        <p className="mb-3 text-[11px] opacity-50">在两后端之间迁移某命名空间的对象。建议先「预演」再正式迁移。</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="opacity-60">命名空间</span>
            <select className={FIELD} value={ns} onChange={(e) => setNs(e.target.value)}>
              {NAMESPACES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="opacity-60">方向</span>
            <select className={FIELD} value={dir} onChange={(e) => setDir(e.target.value as 'local_to_minio' | 'minio_to_local')}>
              <option value="local_to_minio">local → minio</option>
              <option value="minio_to_local">minio → local</option>
            </select>
          </label>
          <Button variant="outline" size="sm" onClick={() => void doMigrate(true)} disabled={busy}>预演</Button>
          <Button variant="outline" size="sm" onClick={() => void doMigrate(false)} disabled={busy}>执行迁移</Button>
        </div>
      </div>
    </div>
  );
};
