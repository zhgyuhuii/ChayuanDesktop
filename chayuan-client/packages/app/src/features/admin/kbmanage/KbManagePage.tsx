/**
 * KbManagePage —— 管理控制台「知识库管理」域。
 * 网格复用前端知识中心的 KbCard 卡片;数据走 knowledgeUniverse.list()(admin 用户后端
 * 自动返回**全部** KB)。点卡片进入 KbAdminDetail(复用前端详情正文体 + 管理员能力)。
 * 顶部「添加知识库」复用共享 KbCreateFlow。卡片可勾选 → 批量删除(管理员可删任意 KB)。
 */
import * as React from 'react';
import {
  knowledgeUniverse, kbAcl, kb as kbApi, knowledgeSource,
  type KuItem, type KbAclItem, type KbAclUser,
} from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw, Plus, Trash2 } from 'lucide-react';
import { KbCard } from '../../kb/KbCard';
import { KbCreateFlow } from '../../kb/create/KbCreateFlow';
import { sourceIdFromKuId } from '../../kb/SchemaScopePicker';
import { reportError, notifySuccess } from '../../../store/errorDialog';
import { confirmDialog } from '../../../store/confirmDialog';
import { KbAdminDetail } from './KbAdminDetail';

export const KbManagePage: React.FC = () => {
  const [kus, setKus] = React.useState<KuItem[]>([]);
  const [aclByName, setAclByName] = React.useState<Record<string, KbAclItem>>({});
  const [users, setUsers] = React.useState<KbAclUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [sel, setSel] = React.useState<KuItem | null>(null);
  // 多选(批量删除)。与前端 KbCard 的勾选 UI 同一套。
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [deleting, setDeleting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [list, acl] = await Promise.all([knowledgeUniverse.list(), kbAcl.list()]);
      setKus(list);
      setUsers(acl.users);
      setAclByName(Object.fromEntries(acl.kbs.map((k) => [k.kb_name, k])));
      // 清掉已不存在的勾选
      setPicked((prev) => {
        const valid = new Set(list.map((k) => k.ku_id));
        const next = new Set([...prev].filter((id) => valid.has(id)));
        return next.size === prev.size ? prev : next;
      });
    } catch (e) {
      reportError(e, '读取知识库失败');
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const toggle = (kuId: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(kuId)) next.delete(kuId); else next.add(kuId);
      return next;
    });

  const deleteOne = async (ku: KuItem) => {
    if (ku.kind === 'document') {
      await kbApi.delete(ku.name);
    } else {
      const id = sourceIdFromKuId(ku.ku_id);
      if (id == null) throw new Error(`非法 ku_id: ${ku.ku_id}`);
      await knowledgeSource.delete(id);
    }
  };

  const deleteSelected = async () => {
    const targets = kus.filter((k) => picked.has(k.ku_id));
    if (!targets.length) return;
    const ok = await confirmDialog(
      `确定删除选中的 ${targets.length} 个知识库?该操作不可恢复。`,
      { title: '删除知识库', danger: true },
    );
    if (!ok) return;
    setDeleting(true);
    let failed = 0;
    for (const ku of targets) {
      try { await deleteOne(ku); } catch { failed += 1; }
    }
    setDeleting(false);
    if (failed) reportError(new Error(`${failed} 个删除失败`), '部分知识库删除失败');
    else notifySuccess(`已删除 ${targets.length} 个知识库`);
    setPicked(new Set());
    await load();
  };

  // ── 详情视图(复用前端详情正文体 + 管理员 acl) ──
  if (sel) {
    return (
      <KbAdminDetail
        ku={sel}
        acl={aclByName[sel.name] ?? null}
        users={users}
        onBack={() => setSel(null)}
        onAclChanged={() => void load()}
      />
    );
  }

  // ── 网格视图(复用知识中心 KbCard,全部 KB) ──
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">知识库管理</h2>
          <p className="mt-1 text-sm text-muted-foreground">全系统知识库(管理员视角)。勾选卡片可批量删除;点卡片进入:文件 / 分片 / 预览(与前端一致)+ 可见性 / owner / 授权。</p>
        </div>
        <div className="flex items-center gap-2">
          {picked.size > 0 && (
            <Button variant="outline" size="sm" disabled={deleting} onClick={() => void deleteSelected()} className="text-rose-600 hover:text-rose-700">
              <Trash2 className={`mr-1.5 h-4 w-4 ${deleting ? 'animate-pulse' : ''}`} /> 删除选中（{picked.size}）
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新</Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> 添加知识库</Button>
        </div>
      </div>
      {loading && !kus.length ? (
        <div className="py-12 text-center text-sm opacity-60">加载中…</div>
      ) : !kus.length ? (
        <div className="py-12 text-center text-sm opacity-60">暂无知识库,点「添加知识库」创建。</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {kus.map((ku, i) => (
            <KbCard key={ku.ku_id} kb={ku} selected={picked.has(ku.ku_id)} index={i} onToggle={() => toggle(ku.ku_id)} onOpen={() => setSel(ku)} />
          ))}
        </div>
      )}
      <KbCreateFlow open={createOpen} onOpenChange={setCreateOpen} onCreated={() => void load()} />
    </div>
  );
};
