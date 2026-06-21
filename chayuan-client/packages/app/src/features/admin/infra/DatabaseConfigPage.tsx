/**
 * DatabaseConfigPage —— 管理控制台「数据库」域(P5,敏感)。
 * DB 类型下拉(sqlite/pg/mysql) + 动态字段 + 测试连接 + 建库(DDL,二次确认) + 保存(需重启)。
 * 复用后端 /api/v1/admin/db/{status,validate,create,save}。
 */
import * as React from 'react';
import { dbConfig, type DbForm, type DbType, type DbValidateResult } from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw, Wifi, Save, DatabaseZap } from 'lucide-react';
import { notifySuccess, reportError } from '../../../store/errorDialog';
import { confirmDialog } from '../../../store/confirmDialog';

const FIELD =
  'mt-1 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)] dark:bg-zinc-800';

const EMPTY: DbForm = {
  db_type: 'sqlite', sqlite_path: '', host: '', port: '', database: '', schema: '', username: '', password: '', charset: '',
};

export const DatabaseConfigPage: React.FC = () => {
  const [form, setForm] = React.useState<DbForm>(EMPTY);
  const [types, setTypes] = React.useState<DbType[]>([]);
  const [summary, setSummary] = React.useState('');
  const [val, setVal] = React.useState<DbValidateResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const s = await dbConfig.status();
      setForm(s.form || EMPTY);
      setTypes(s.db_types || []);
      setSummary(s.summary || '');
    } catch (e) {
      reportError(e, '读取数据库配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const curType = types.find((t) => t.key === form.db_type);
  const set = (k: keyof DbForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onType = (key: string) => {
    const t = types.find((x) => x.key === key);
    setForm((f) => ({
      ...f,
      db_type: key,
      port: f.port || (t?.default_port ? String(t.default_port) : ''),
      database: f.database || (t?.default_db ?? ''),
      schema: f.schema || (t?.default_schema ?? ''),
      charset: f.charset || (t?.default_charset ?? ''),
    }));
    setVal(null);
  };

  const doValidate = async () => {
    setBusy(true);
    setVal(null);
    try {
      setVal(await dbConfig.validate(form));
    } catch (e) {
      reportError(e, '测试失败');
    } finally {
      setBusy(false);
    }
  };

  const doCreate = async () => {
    if (
      !(await confirmDialog('将在目标服务器上执行 CREATE DATABASE。请确认连接信息正确,且你有权限。', {
        title: '创建数据库？',
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      const r = await dbConfig.create(form);
      if (r.ok) {
        notifySuccess('数据库已创建');
        await doValidate();
      } else {
        reportError(new Error(r.message || r.detail), '创建失败');
      }
    } catch (e) {
      reportError(e, '创建失败');
    } finally {
      setBusy(false);
    }
  };

  const doSave = async () => {
    if (
      !(await confirmDialog('保存后 SQLALCHEMY_DATABASE_URI 改变,需重启服务才生效。建议先「测试连接」。', {
        title: '保存数据库配置？',
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await dbConfig.save(form);
      notifySuccess('已保存 — 重启服务后生效');
      await load();
    } catch (e) {
      reportError(e, '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const isSqlite = curType ? !curType.has_host : form.db_type === 'sqlite';

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">数据库配置</h2>
          <p className="mt-1 text-xs opacity-60">主业务数据库。改动需重启服务。SQLite 仅适合单机/开发,生产建议 PostgreSQL。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </Button>
      </div>

      {summary && <div className="rounded-md bg-[var(--cy-surface-2)] px-3 py-2 text-xs">当前：{summary}</div>}

      <label className="block text-xs">
        <span className="opacity-60">数据库类型</span>
        <select className={FIELD} value={form.db_type} onChange={(e) => onType(e.target.value)}>
          {types.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </label>

      {isSqlite ? (
        <label className="block text-xs">
          <span className="opacity-60">SQLite 文件路径（留空=默认 $CHAYUAN_ROOT/data/knowledge_base/info.db）</span>
          <input className={FIELD} value={form.sqlite_path} onChange={(e) => set('sqlite_path', e.target.value)} />
        </label>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs"><span className="opacity-60">主机 host</span>
            <input className={FIELD} value={form.host} onChange={(e) => set('host', e.target.value)} /></label>
          <label className="text-xs"><span className="opacity-60">端口 port</span>
            <input className={FIELD} value={form.port} onChange={(e) => set('port', e.target.value)} /></label>
          <label className="text-xs"><span className="opacity-60">数据库名 database</span>
            <input className={FIELD} value={form.database} onChange={(e) => set('database', e.target.value)} /></label>
          {curType?.has_schema && (
            <label className="text-xs"><span className="opacity-60">模式 schema</span>
              <input className={FIELD} value={form.schema} onChange={(e) => set('schema', e.target.value)} /></label>
          )}
          <label className="text-xs"><span className="opacity-60">用户名 username</span>
            <input className={FIELD} value={form.username} onChange={(e) => set('username', e.target.value)} /></label>
          <label className="text-xs"><span className="opacity-60">密码 password</span>
            <input type="password" className={FIELD} value={form.password} onChange={(e) => set('password', e.target.value)} /></label>
          {curType?.has_charset && (
            <label className="text-xs"><span className="opacity-60">字符集 charset</span>
              <input className={FIELD} value={form.charset} onChange={(e) => set('charset', e.target.value)} /></label>
          )}
        </div>
      )}

      {curType?.install_hint && <div className="text-[11px] opacity-50">{curType.install_hint}</div>}

      {val && (
        <div className={`rounded-md px-3 py-2 text-xs ${val.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
          {val.ok ? `连接成功。${val.uri_masked || ''}` : `失败：${val.message}`}
          {val.detail ? ` (${val.detail})` : ''}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button onClick={() => void doSave()} disabled={busy}>
          <Save className="mr-1.5 h-4 w-4" /> 保存
        </Button>
        <Button variant="outline" onClick={() => void doValidate()} disabled={busy}>
          <Wifi className="mr-1.5 h-4 w-4" /> 测试连接
        </Button>
        {val?.db_missing && (
          <Button variant="outline" onClick={() => void doCreate()} disabled={busy}>
            <DatabaseZap className="mr-1.5 h-4 w-4 text-amber-500" /> 立即创建数据库
          </Button>
        )}
      </div>
    </div>
  );
};
