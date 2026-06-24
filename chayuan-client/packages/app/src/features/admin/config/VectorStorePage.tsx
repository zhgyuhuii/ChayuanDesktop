/**
 * VectorStorePage —— 管理控制台「向量库」域(S2)。
 * 复用后端 /api/v1/admin/vectorstore/{schema,test,save}(包装 config_panel/vs_config)。
 * 类型下拉(7 种)→ 动态字段 → 连接测试 → 保存(写 kb_settings.yaml,改后需重启)。
 */
import * as React from 'react';
import { vectorStore, type VsSchema, type VsTypeMeta, type VsTestResult } from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw, Wifi, Save, Eye, EyeOff, CheckCircle2, Star } from 'lucide-react';
import { notifySuccess, reportError } from '../../../store/errorDialog';

const FIELD =
  'mt-1 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)] dark:bg-zinc-800';

export const VectorStorePage: React.FC = () => {
  const [schema, setSchema] = React.useState<VsSchema | null>(null);
  const [active, setActive] = React.useState<string>('');
  const [vals, setVals] = React.useState<Record<string, unknown>>({});
  const [reveal, setReveal] = React.useState<Set<string>>(new Set());
  const [test, setTest] = React.useState<VsTestResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const sc = await vectorStore.schema();
      setSchema(sc);
      const k = sc.default_type || sc.types[0]?.key || '';
      setActive(k);
      setVals({ ...(sc.values[k] || {}) });
      setTest(null);
    } catch (e) {
      reportError(e, '读取向量库配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const pickType = (k: string) => {
    setActive(k);
    setVals({ ...(schema?.values[k] || {}) });
    setTest(null);
  };

  const current: VsTypeMeta | undefined = schema?.types.find((t) => t.key === active);

  const fillContainer = () => {
    if (!current) return;
    const hostMap: Record<string, string> = { milvus: 'milvus', zilliz: 'milvus', es: 'elasticsearch' };
    if (current.fields.some((f) => f.name === 'host')) {
      setVals((v) => ({ ...v, host: hostMap[active] ?? active }));
    } else if (current.fields.some((f) => f.name === 'connection_uri')) {
      const svc = active === 'relyt' ? 'relyt' : 'postgres';
      setVals((v) => ({ ...v, connection_uri: String(v.connection_uri || '').replace('127.0.0.1', svc).replace('localhost', svc) }));
    }
  };
  const isDefault = schema?.default_type === active;

  const doTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      setTest(await vectorStore.test(active, vals));
    } catch (e) {
      reportError(e, '测试失败');
    } finally {
      setBusy(false);
    }
  };

  const doSave = async () => {
    setBusy(true);
    try {
      await vectorStore.save(active, vals, true);
      notifySuccess('已保存并设为默认向量库,立即生效');
      await load();
    } catch (e) {
      reportError(e, '保存失败');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !schema) return <div className="p-6 text-sm opacity-60">加载中…</div>;
  if (!schema) return <div className="p-6 text-sm opacity-60">无 schema</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">向量库配置</h2>
          <p className="mt-1 text-xs opacity-60">
            选择系统默认向量库并配置连接参数。faiss/chromadb 为本地库,生产多用户建议 Milvus / PG(pgvector) / ES。改动需重启服务。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </Button>
      </div>

      <label className="block text-xs">
        <span className="opacity-60">向量库类型</span>
        <select className={FIELD} value={active} onChange={(e) => pickType(e.target.value)}>
          {schema.types.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
              {schema.default_type === t.key ? '（当前默认）' : ''}
            </option>
          ))}
        </select>
      </label>

      {isDefault && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-600">
          <Star className="h-3.5 w-3.5 fill-current" /> 这是当前系统默认向量库
        </div>
      )}
      {current && current.fields.length > 0 && (
        <p className="text-[11px] text-amber-600">Docker 跨容器部署:host 填 compose 服务名(非 127.0.0.1)。<button type="button" className="ml-1 text-[var(--cy-brand-600)] hover:underline" onClick={fillContainer}>一键填入容器服务名</button></p>
      )}
      {current?.help && <p className="text-xs opacity-50">{current.help}</p>}
      {current?.install_hint && (
        <p className="rounded-md bg-zinc-100 px-3 py-2 font-mono text-[11px] opacity-70 dark:bg-zinc-800">
          {current.install_hint}
        </p>
      )}

      {current && current.fields.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {current.fields.map((f) => {
            const v = vals[f.name];
            if (f.widget === 'switch') {
              return (
                <label key={f.name} className="flex items-center gap-2 text-xs sm:col-span-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!v}
                    onClick={() => setVals((m) => ({ ...m, [f.name]: !v }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      v ? 'bg-[var(--cy-brand-500)]' : 'bg-zinc-300 dark:bg-zinc-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        v ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                  <span>
                    <span className="font-medium">{f.label}</span>
                    {f.help && <span className="ml-1 opacity-50">{f.help}</span>}
                  </span>
                </label>
              );
            }
            if (f.widget === 'select') {
              return (
                <label key={f.name} className="text-xs">
                  <span className="opacity-60">{f.label}</span>
                  <select
                    className={FIELD}
                    value={String(v ?? '')}
                    onChange={(e) => setVals((m) => ({ ...m, [f.name]: e.target.value }))}
                  >
                    {(f.choices ?? []).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }
            const isPwd = f.widget === 'password';
            const shown = reveal.has(f.name);
            return (
              <label key={f.name} className="text-xs">
                <span className="opacity-60">{f.label}</span>
                <div className="relative">
                  <input
                    type={isPwd && !shown ? 'password' : 'text'}
                    className={FIELD}
                    value={String(v ?? '')}
                    placeholder={f.placeholder}
                    onChange={(e) => setVals((m) => ({ ...m, [f.name]: e.target.value }))}
                  />
                  {isPwd && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100"
                      onClick={() =>
                        setReveal((s) => {
                          const n = new Set(s);
                          if (n.has(f.name)) n.delete(f.name);
                          else n.add(f.name);
                          return n;
                        })
                      }
                      tabIndex={-1}
                    >
                      {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                </div>
                {f.help && <span className="mt-0.5 block opacity-40">{f.help}</span>}
              </label>
            );
          })}
        </div>
      ) : (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs opacity-60 dark:bg-zinc-800">
          本地向量库,无需连接参数。
        </p>
      )}

      {test && (
        <div
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${
            test.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}
        >
          {test.ok && <CheckCircle2 className="h-4 w-4" />}
          {test.ok ? `连通成功。${test.detail || ''}` : `失败：${test.message}`}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button onClick={() => void doSave()} disabled={busy}>
          <Save className="mr-1.5 h-4 w-4" /> 保存并设为默认
        </Button>
        <Button variant="outline" onClick={() => void doTest()} disabled={busy}>
          <Wifi className="mr-1.5 h-4 w-4" /> 测试连通
        </Button>
      </div>
    </div>
  );
};
