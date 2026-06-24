/**
 * KbManagePage —— 管理控制台「知识库管理」域。
 * 网格复用前端知识中心的 KbCard 卡片;数据走 knowledgeUniverse.list()(admin 用户后端
 * 自动返回**全部** KB)。点卡片进入 KbAdminDetail —— 真复用前端详情正文体
 * (DocumentKbDetail / 各 kind 面板 + 预览),与前端知识中心完全一致,并叠加管理员能力
 * (可见性 / owner / 授权)。顶部「添加知识库」复用共享 KbCreateFlow。
 */
import * as React from 'react';
import {
  knowledgeUniverse, kbAcl,
  type KuItem, type KbAclItem, type KbAclUser,
} from '@chayuan/api';
import { Button } from '@chayuan/ui';
import { RefreshCw, Plus } from 'lucide-react';
import { KbCard } from '../../kb/KbCard';
import { KbCreateFlow } from '../../kb/create/KbCreateFlow';
import { reportError } from '../../../store/errorDialog';
import { KbAdminDetail } from './KbAdminDetail';

export const KbManagePage: React.FC = () => {
  // 全部 KB(admin 视角)+ ACL 映射(用于授权 / owner / 可见性)
  const [kus, setKus] = React.useState<KuItem[]>([]);
  const [aclByName, setAclByName] = React.useState<Record<string, KbAclItem>>({});
  const [users, setUsers] = React.useState<KbAclUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [sel, setSel] = React.useState<KuItem | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [list, acl] = await Promise.all([knowledgeUniverse.list(), kbAcl.list()]);
      setKus(list);
      setUsers(acl.users);
      setAclByName(Object.fromEntries(acl.kbs.map((k) => [k.kb_name, k])));
    } catch (e) {
      reportError(e, '读取知识库失败');
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

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
          <p className="mt-1 text-sm text-muted-foreground">全系统知识库(管理员视角)。可新建文档 / 数据库 / 外部向量库;点卡片进入:文件 / 分片 / 预览(与前端一致)+ 可见性 / owner / 授权。</p>
        </div>
        <div className="flex items-center gap-2">
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
            <KbCard key={ku.ku_id} kb={ku} selected={false} index={i} onToggle={() => {}} onOpen={() => setSel(ku)} />
          ))}
        </div>
      )}
      <KbCreateFlow open={createOpen} onOpenChange={setCreateOpen} onCreated={() => void load()} />
    </div>
  );
};
