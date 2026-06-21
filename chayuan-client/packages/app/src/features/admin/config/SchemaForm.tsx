/**
 * SchemaForm —— Schema 驱动的通用配置表单(S0 引擎)。
 *
 * 后端 /api/v1/admin/config/{file}/{schema,values} 暴露 config_panel/schema.py 的
 * FileSchema(sections/fields)。本组件按 section 分块卡、按 widget 渲染控件,跟踪脏值、
 * 保存(POST /config/{file})、needs_restart 横幅、password reveal、可选原始 YAML 编辑器。
 *
 * 复用此一个组件即可覆盖 basic/kb/model/tool/prompt 五个配置域,后续加字段只改后端 schema.py。
 */
import * as React from 'react';
import {
  configApi,
  type ConfigFile,
  type ConfigSchema,
  type ConfigField,
} from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw, Save, Eye, EyeOff, AlertTriangle, Code2 } from 'lucide-react';
import { notifySuccess, reportError } from '../../../store/errorDialog';

const FIELD =
  'mt-1 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)] dark:bg-zinc-800';

type Vals = Record<string, unknown>;

function FieldControl({
  f,
  value,
  onChange,
}: {
  f: ConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [reveal, setReveal] = React.useState(false);

  if (f.widget === 'switch') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={!!value}
        onClick={() => onChange(!value)}
        className={`relative mt-1 inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          value ? 'bg-[var(--cy-brand-500)]' : 'bg-zinc-300 dark:bg-zinc-600'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            value ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    );
  }
  if (f.widget === 'number') {
    return (
      <input
        type="number"
        className={FIELD}
        value={value === null || value === undefined ? '' : String(value)}
        min={f.min ?? undefined}
        max={f.max ?? undefined}
        step={f.step ?? undefined}
        placeholder={f.placeholder}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
    );
  }
  if (f.widget === 'select') {
    return (
      <select className={FIELD} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">（未设置）</option>
        {(f.choices ?? []).map((c) => (
          <option key={String(c)} value={String(c)}>
            {String(c)}
          </option>
        ))}
      </select>
    );
  }
  if (f.widget === 'textarea' || f.widget === 'yaml') {
    return (
      <textarea
        className={`${FIELD} font-mono`}
        rows={f.rows || 6}
        value={String(value ?? '')}
        placeholder={f.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (f.widget === 'password') {
    return (
      <div className="relative">
        <input
          type={reveal ? 'text' : 'password'}
          className={FIELD}
          value={String(value ?? '')}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {f.password_toggle && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100"
            onClick={() => setReveal((r) => !r)}
            tabIndex={-1}
          >
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    );
  }
  // text(默认)
  return (
    <input
      className={FIELD}
      value={String(value ?? '')}
      placeholder={f.placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export const SchemaForm: React.FC<{ file: ConfigFile; title?: string; intro?: React.ReactNode }> = ({
  file,
  title,
  intro,
}) => {
  const [schema, setSchema] = React.useState<ConfigSchema | null>(null);
  const [vals, setVals] = React.useState<Vals>({});
  const [dirty, setDirty] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [rawMode, setRawMode] = React.useState(false);
  const [rawText, setRawText] = React.useState<string>('');

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [sc, vv] = await Promise.all([configApi.schema(file), configApi.values(file)]);
      setSchema(sc);
      setVals(vv.values || {});
      setRawText(vv.raw_text || '');
      setDirty(new Set());
    } catch (e) {
      reportError(e, '读取配置失败');
    } finally {
      setLoading(false);
    }
  }, [file]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const setVal = (path: string, v: unknown) => {
    setVals((m) => ({ ...m, [path]: v }));
    setDirty((d) => new Set(d).add(path));
  };

  // 本次脏字段里是否有需要重启的
  const needsRestart = React.useMemo(() => {
    if (!schema) return false;
    const byPath = new Map<string, ConfigField>();
    schema.sections.forEach((s) => s.fields.forEach((f) => byPath.set(f.path, f)));
    return Array.from(dirty).some((p) => byPath.get(p)?.needs_restart);
  }, [dirty, schema]);

  const doSave = async () => {
    if (!dirty.size) {
      notifySuccess('没有改动');
      return;
    }
    setBusy(true);
    try {
      const payload: Vals = {};
      dirty.forEach((p) => (payload[p] = vals[p]));
      const r = await configApi.save(file, payload);
      notifySuccess(r.needs_restart ? '已保存 — 重启服务后生效' : '已保存');
      await load();
    } catch (e) {
      reportError(e, '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const doSaveRaw = async () => {
    setBusy(true);
    try {
      await configApi.saveRaw(file, rawText);
      notifySuccess('已保存原文 — 重启后生效');
      setRawMode(false);
      await load();
    } catch (e) {
      reportError(e, '保存失败');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !schema) {
    return <div className="p-6 text-sm opacity-60">加载中…</div>;
  }
  if (!schema) return <div className="p-6 text-sm opacity-60">无 schema</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title || schema.title}</h2>
          {(intro || schema.description) && (
            <p className="mt-1 text-xs leading-relaxed opacity-60">{intro || schema.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {schema.raw_editor && (
            <Button variant="ghost" size="sm" onClick={() => setRawMode((m) => !m)}>
              <Code2 className="mr-1.5 h-4 w-4" /> {rawMode ? '表单' : '原始 YAML'}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </Button>
        </div>
      </div>

      {needsRestart && (
        <div className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" /> 本次改动含需重启生效的项,保存后请重启服务。
        </div>
      )}

      {rawMode ? (
        <div className="space-y-3">
          <textarea
            className={`${FIELD} font-mono`}
            rows={28}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button onClick={() => void doSaveRaw()} disabled={busy}>
              <Save className="mr-1.5 h-4 w-4" /> 保存原文
            </Button>
            <span className="text-xs opacity-50">直接覆盖整个 yaml,保存前会做语法校验。</span>
          </div>
        </div>
      ) : (
        <>
          {schema.sections.map((s) => (
            <section
              key={s.title}
              className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-4"
            >
              <div className="mb-3">
                <h3 className="text-sm font-semibold">{s.title}</h3>
                {s.description && <p className="mt-0.5 text-xs opacity-50">{s.description}</p>}
              </div>
              <div className="space-y-3">
                {s.fields.map((f) => (
                  <div
                    key={f.path}
                    className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-start sm:gap-4"
                  >
                    <div className="pt-1">
                      <div className="text-xs font-medium">
                        {f.label}
                        {dirty.has(f.path) && <span className="ml-1 text-[var(--cy-brand-500)]">●</span>}
                      </div>
                      {f.help && (
                        <div className="mt-0.5 whitespace-pre-line text-[11px] leading-snug opacity-45">
                          {f.help}
                        </div>
                      )}
                    </div>
                    <FieldControl f={f} value={vals[f.path]} onChange={(v) => setVal(f.path, v)} />
                  </div>
                ))}
              </div>
            </section>
          ))}

          <div className="sticky bottom-0 flex items-center gap-2 border-t border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]/90 py-3 backdrop-blur">
            <Button onClick={() => void doSave()} disabled={busy || !dirty.size}>
              <Save className="mr-1.5 h-4 w-4" /> 保存{dirty.size ? `(${dirty.size})` : ''}
            </Button>
            <span className="text-xs opacity-50">仅提交改动字段;密码留空或不动则不覆盖。</span>
          </div>
        </>
      )}
    </div>
  );
};
