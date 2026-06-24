/**
 * KbAdminDetail —— 后台「知识库管理」详情页。
 *
 * 真复用前端知识中心详情的**正文体**(DocumentKbDetail / ImageKbDetail /
 * StructuredKbDetail / VectorKbDetail + PreviewPanel)—— 这些都是与「库内对话」
 * 无关的独立组件,只依赖全局 preview store,可在后台控制台直接复用,保证后台详情
 * 与前端**完全一致**(文件上传/删除/搜索/预览/下载/分片查看/重建)。
 *
 * 在此之上叠加**管理员专属能力**:可见性 / owner / 授权(kbAcl + GrantsDialog)。
 * 不渲染 ConversationView —— 后台定位是「管理」,且控制台无聊天基设(已与用户确认)。
 */
import * as React from 'react';
import { kbAcl, type KuItem, type KbAclItem, type KbAclUser } from '@chayuan/api';
import { Button, cn } from '@chayuan/ui';
import { ArrowLeft, Lock } from 'lucide-react';
import { useKuDetail } from '../../kb/detail/useKuDetail';
import { DocumentKbDetail } from '../../kb/detail/DocumentKbDetail';
import { ImageKbDetail } from '../../kb/detail/ImageKbDetail';
import { StructuredKbDetail } from '../../kb/detail/StructuredKbDetail';
import { VectorKbDetail } from '../../kb/detail/VectorKbDetail';
import { PreviewPanel, usePreviewStore } from '../../preview';
import { GrantsDialog } from './GrantsDialog';
import { reportError } from '../../../store/errorDialog';

export interface KbAdminDetailProps {
  ku: KuItem;
  /** 该 KB 的 ACL 行(用于可见性 / owner / 授权);可能为空(无 acl 行时只读展示) */
  acl?: KbAclItem | null;
  /** 全部用户(owner / 授权下拉用) */
  users: KbAclUser[];
  onBack(): void;
  /** 可见性 / owner / 授权改动后,通知父级重载列表 + acl */
  onAclChanged(): void;
}

export const KbAdminDetail: React.FC<KbAdminDetailProps> = ({
  ku, acl, users, onBack, onAclChanged,
}) => {
  const detailQ = useKuDetail(ku.ku_id);
  const previewCurrent = usePreviewStore((s) => s.current);
  const claimInline = usePreviewStore((s) => s.claimInline);
  const [grantsOpen, setGrantsOpen] = React.useState(false);

  // 让预览走 inline(右列),不弹全局抽屉。
  React.useEffect(() => claimInline(), [claimInline]);

  const setVis = async (v: string) => {
    if (!acl) return;
    try { await kbAcl.setVisibility(acl.id, v); onAclChanged(); }
    catch (e) { reportError(e, '修改可见性失败'); }
  };
  const setOwner = async (ownerId: number | null) => {
    if (!acl) return;
    try { await kbAcl.setOwner(acl.id, ownerId); onAclChanged(); }
    catch (e) { reportError(e, '修改 owner 失败'); }
  };

  const onMutate = React.useCallback(() => { void detailQ.refetch(); }, [detailQ]);
  const hasPreview = !!previewCurrent;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--cy-surface-base)]">
      {/* 头部:返回 + 标题 + 管理员 acl 控件 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--cy-border-subtle)] px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="mr-1 h-4 w-4" /> 返回</Button>
        <span className="text-sm font-semibold">{ku.display_name || ku.name}</span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] dark:bg-zinc-800">{ku.kind}</span>
        <span className="flex-1" />
        {acl ? (
          <>
            <label className="text-[11px] opacity-60">可见性</label>
            <select className="rounded border p-1 text-xs" value={acl.visibility} onChange={(e) => void setVis(e.target.value)}>
              <option value="private">private</option>
              <option value="public">public</option>
            </select>
            <label className="text-[11px] opacity-60">owner</label>
            <select className="rounded border p-1 text-xs" value={acl.owner_id ?? 0} onChange={(e) => void setOwner(Number(e.target.value) || null)}>
              <option value={0}>（无）</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={() => setGrantsOpen(true)}><Lock className="mr-1.5 h-4 w-4" /> 授权</Button>
          </>
        ) : (
          <span className="text-[11px] opacity-50">{ku.visibility} · owner {ku.owner_id ?? '—'}</span>
        )}
      </div>

      {/* 正文:复用前端详情体(按 kind)+ 右列预览。与前端知识中心完全一致。 */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden', hasPreview ? 'flex-[3]' : 'flex-1')}>
          {detailQ.isLoading ? (
            <div className="flex flex-1 items-center justify-center text-sm opacity-60">加载中…</div>
          ) : detailQ.isError || !detailQ.data ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm opacity-60">
              <span>读取知识库详情失败</span>
              <Button size="sm" variant="outline" onClick={() => void detailQ.refetch()}>重试</Button>
            </div>
          ) : (() => {
            const detail = detailQ.data;
            const canWrite = !!(detail.meta.can_write || detail.meta.mine);
            return (
              <div className="flex min-h-0 flex-1 overflow-hidden">
                {detail.kind === 'document' && <DocumentKbDetail detail={detail} mine={canWrite} onMutate={onMutate} />}
                {detail.kind === 'image' && <ImageKbDetail detail={detail} mine={canWrite} onMutate={onMutate} />}
                {detail.kind === 'structured' && <StructuredKbDetail detail={detail} mine={canWrite} onMutate={onMutate} />}
                {detail.kind === 'vector' && <VectorKbDetail detail={detail} mine={canWrite} onMutate={onMutate} />}
              </div>
            );
          })()}
        </main>
        {hasPreview && (
          <aside className="flex min-h-0 min-w-0 flex-[4] flex-col overflow-hidden border-l border-[var(--cy-border-subtle)]">
            <PreviewPanel embedded />
          </aside>
        )}
      </div>

      {acl && grantsOpen ? (
        <GrantsDialog kb={acl} users={users} onClose={() => { setGrantsOpen(false); onAclChanged(); }} />
      ) : null}
    </div>
  );
};
