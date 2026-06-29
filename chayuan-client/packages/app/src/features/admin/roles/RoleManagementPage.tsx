/**
 * RoleManagementPage —— 管理控制台「角色」域(RBAC 按模块授权 #2)。
 * 建角色 + 勾选后台模块授权 + 改 / 删。内置 admin(全模块只读)/user 不可删;admin 只可改描述。
 * 复用后端 /api/v1/admin/roles。模块目录由后端 module_catalog 提供(与后台域对齐)。
 */
import * as React from 'react';
import {
  roles as rolesApi,
  orgs as orgsApi,
  depts as deptsApi,
  type Role,
  type ModuleCatalogItem,
  type Org,
  type DeptNode,
} from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw, Plus, Trash2, Pencil, X, Shield, Check } from 'lucide-react';
import { notifySuccess, reportError } from '../../../store/errorDialog';
import { confirmDialog } from '../../../store/confirmDialog';
import { DeptTree } from '../orgs/DeptTree';

const FIELD =
  'mt-1 w-full rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--cy-brand-400)] dark:bg-zinc-800';

// 数据权限范围:与后端 data_scope 取值对齐(1全部/4本部门及以下/3本部门/5仅本人/2自定义)。
const DATA_SCOPE_OPTS: { value: number; label: string }[] = [
  { value: 1, label: '全部' },
  { value: 4, label: '本部门及以下' },
  { value: 3, label: '本部门' },
  { value: 5, label: '仅本人' },
  { value: 2, label: '自定义' },
];

const RoleEditDialog: React.FC<{
  role: Role | null; // null = 新建
  catalog: ModuleCatalogItem[];
  onClose: () => void;
  onSaved: () => void;
}> = ({ role, catalog, onClose, onSaved }) => {
  const editing = !!role;
  const adminLocked = role?.name === 'admin';
  const [name, setName] = React.useState(role?.name ?? '');
  const [description, setDescription] = React.useState(role?.description ?? '');
  const [modules, setModules] = React.useState<Set<string>>(new Set(role?.modules ?? []));
  const [dataScope, setDataScope] = React.useState<number>(role?.data_scope ?? 3);
  const [scopeDepts, setScopeDepts] = React.useState<Set<number>>(new Set(role?.scope_dept_ids ?? []));
  const [orgList, setOrgList] = React.useState<Org[]>([]);
  const [scopeOrgId, setScopeOrgId] = React.useState<number | null>(null);
  const [deptTree, setDeptTree] = React.useState<DeptNode[]>([]);
  const [busy, setBusy] = React.useState(false);

  const groups = React.useMemo(() => {
    const m = new Map<string, ModuleCatalogItem[]>();
    for (const it of catalog) {
      if (!m.has(it.group)) m.set(it.group, []);
      m.get(it.group)!.push(it);
    }
    return Array.from(m.entries());
  }, [catalog]);

  const toggle = (key: string) =>
    setModules((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const toggleGroup = (items: ModuleCatalogItem[], on: boolean) =>
    setModules((s) => {
      const n = new Set(s);
      items.forEach((it) => (on ? n.add(it.key) : n.delete(it.key)));
      return n;
    });
  const toggleScopeDept = (id: number) =>
    setScopeDepts((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // data_scope==自定义(2) 时拉组织列表(默认选第一个)。
  React.useEffect(() => {
    if (dataScope !== 2 || orgList.length) return;
    orgsApi
      .list()
      .then((list) => {
        setOrgList(list);
        const first = list[0];
        if (first && scopeOrgId === null) setScopeOrgId(first.id);
      })
      .catch((e) => reportError(e, '读取组织失败'));
  }, [dataScope, orgList.length, scopeOrgId]);

  // 选中组织变化时拉部门树。
  React.useEffect(() => {
    if (scopeOrgId === null) return;
    deptsApi
      .tree(scopeOrgId)
      .then(setDeptTree)
      .catch((e) => reportError(e, '读取部门失败'));
  }, [scopeOrgId]);

  const save = async () => {
    setBusy(true);
    try {
      if (editing) {
        await rolesApi.update(role!.name, {
          description,
          modules: Array.from(modules),
          data_scope: dataScope,
          scope_dept_ids: Array.from(scopeDepts),
        });
      } else {
        await rolesApi.create({
          name: name.trim(),
          description,
          modules: Array.from(modules),
          data_scope: dataScope,
          scope_dept_ids: Array.from(scopeDepts),
        });
      }
      notifySuccess(editing ? '已保存角色' : '已创建角色');
      onSaved();
      onClose();
    } catch (e) {
      reportError(e, '保存角色失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--cy-border-subtle)] px-5 py-3">
          <h3 className="text-sm font-semibold">{editing ? `编辑角色：${role!.name}` : '新建角色'}</h3>
          <button onClick={onClose} className="opacity-50 hover:opacity-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">
              <span className="opacity-60">角色名(1-16 位小写字母/数字/下划线)</span>
              <input className={FIELD} value={name} disabled={editing} placeholder="如 kb_manager"
                     onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="text-xs">
              <span className="opacity-60">说明</span>
              <input className={FIELD} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </div>

          {adminLocked ? (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
              内置 admin 角色拥有全部模块,不可调整(仅可改说明)。
            </div>
          ) : (
            <div>
              <div className="mb-2 text-xs font-medium opacity-70">授权模块 · 后台域 + 前端功能({modules.size})</div>
              <div className="space-y-3">
                {groups.map(([group, items]) => {
                  const allOn = items.every((it) => modules.has(it.key));
                  return (
                    <div key={group} className="rounded-lg border border-[var(--cy-border-subtle)] p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold">{group}</span>
                        <button className="text-[11px] text-[var(--cy-brand-600)] hover:underline"
                                onClick={() => toggleGroup(items, !allOn)}>
                          {allOn ? '全不选' : '全选'}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {items.map((it) => {
                          const on = modules.has(it.key);
                          return (
                            <button key={it.key} type="button" onClick={() => toggle(it.key)}
                              className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                                on ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-500)]/10 text-[var(--cy-brand-600)]'
                                   : 'border-[var(--cy-border-subtle)] hover:bg-[var(--cy-surface-2)]'}`}>
                              <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${on ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-500)] text-white' : 'border-zinc-400'}`}>
                                {on && <Check className="h-2.5 w-2.5" />}
                              </span>
                              {it.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 数据权限范围 —— 决定该角色能看到哪些用户/部门的数据(行级)。 */}
          <div>
            <div className="mb-2 text-xs font-medium opacity-70">数据权限范围</div>
            <div className="flex flex-wrap gap-2">
              {DATA_SCOPE_OPTS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDataScope(opt.value)}
                  className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                    dataScope === opt.value
                      ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-500)]/10 text-[var(--cy-brand-600)]'
                      : 'border-[var(--cy-border-subtle)] hover:bg-[var(--cy-surface-2)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {dataScope === 2 ? (
              <div className="mt-3 rounded-lg border border-[var(--cy-border-subtle)] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs opacity-60">组织</span>
                  <select
                    className="flex-1 rounded border p-1.5 text-sm"
                    value={scopeOrgId ?? ''}
                    onChange={(e) => setScopeOrgId(e.target.value === '' ? null : Number(e.target.value))}
                  >
                    {orgList.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
                <DeptTree nodes={deptTree} checkedIds={scopeDepts} onToggle={toggleScopeDept} />
                {!deptTree.length ? <div className="text-xs opacity-50">该组织暂无部门</div> : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--cy-border-subtle)] px-5 py-3">
          <Button size="sm" onClick={() => void save()} disabled={busy || (!editing && !name.trim())}>
            {editing ? '保存' : '创建'}
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>取消</Button>
        </div>
      </div>
    </div>
  );
};

export const RoleManagementPage: React.FC = () => {
  const [data, setData] = React.useState<{ roles: Role[]; catalog: ModuleCatalogItem[] }>({ roles: [], catalog: [] });
  const [loading, setLoading] = React.useState(true);
  const [edit, setEdit] = React.useState<{ role: Role | null } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await rolesApi.list();
      setData({ roles: r.roles, catalog: r.module_catalog });
    } catch (e) {
      reportError(e, '读取角色失败');
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const del = async (role: Role) => {
    if (!(await confirmDialog(`删除角色「${role.name}」？`, { title: '删除角色', danger: true }))) return;
    try {
      await rolesApi.remove(role.name);
      notifySuccess('已删除');
      await load();
    } catch (e) {
      reportError(e, '删除失败');
    }
  };

  const labelOf = (key: string) => data.catalog.find((m) => m.key === key)?.label ?? key;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">角色</h2>
          <p className="mt-1 text-xs opacity-60">建角色并按后台模块授权;在「用户」页把角色分配给用户。内置 admin/user 不可删。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </Button>
          <Button size="sm" onClick={() => setEdit({ role: null })}>
            <Plus className="mr-1.5 h-4 w-4" /> 新建角色
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {data.roles.map((r) => (
          <div key={r.id} className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-3">
            <div className="flex items-center gap-2">
              <Shield className={`h-4 w-4 ${r.name === 'admin' ? 'text-[var(--cy-brand-500)]' : 'opacity-40'}`} />
              <span className="text-sm font-medium">{r.name}</span>
              {r.is_system && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">内置</span>}
              <span className="ml-auto flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEdit({ role: r })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {!r.is_system && (
                  <Button variant="ghost" size="sm" onClick={() => void del(r)}>
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                  </Button>
                )}
              </span>
            </div>
            {r.description && <div className="mt-1 text-xs opacity-60">{r.description}</div>}
            <div className="mt-2 flex flex-wrap gap-1">
              {r.name === 'admin' ? (
                <span className="text-[11px] opacity-50">全部模块</span>
              ) : r.modules.length ? (
                r.modules.map((m) => (
                  <span key={m} className="rounded bg-[var(--cy-brand-500)]/10 px-1.5 py-0.5 text-[10px] text-[var(--cy-brand-600)]">
                    {labelOf(m)}
                  </span>
                ))
              ) : (
                <span className="text-[11px] opacity-40">无后台权限</span>
              )}
            </div>
          </div>
        ))}
        {!loading && !data.roles.length && <div className="py-8 text-center text-sm opacity-50">暂无角色</div>}
      </div>

      {edit && (
        <RoleEditDialog
          role={edit.role}
          catalog={data.catalog}
          onClose={() => setEdit(null)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
};
