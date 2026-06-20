import * as React from 'react';
import { Button, Dialog, DialogContent, DialogTitle } from '@chayuan/ui';
import { useQuery } from '@tanstack/react-query';
import { kb, type EmbeddingModelInfo } from '@chayuan/api';
import { notifySuccess, reportError } from '../../store/errorDialog';

/** [admin] 重建知识库向量库:选嵌入模型 + 重置策略。 */
export const RebuildVsDialog: React.FC<{ kbName: string; open: boolean; onOpenChange(v: boolean): void }> = ({ kbName, open, onOpenChange }) => {
  const modelsQ = useQuery<EmbeddingModelInfo[]>({ queryKey: ['kb', 'embedding-models'], queryFn: () => kb.embeddingModels(false), enabled: open });
  const models = modelsQ.data ?? [];
  const [embed, setEmbed] = React.useState('');
  const [strategy, setStrategy] = React.useState<'atomic_swap' | 'clear_then_rebuild'>('atomic_swap');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { const first = models[0]; if (open && first && !embed) setEmbed(first.model_name); }, [open, models, embed]);

  const run = async () => {
    if (!embed) return;
    setBusy(true);
    try {
      await kb.recreateVectorStore({ knowledge_base_name: kbName, embed_model: embed, reset_strategy: strategy });
      notifySuccess('已提交重建', `${kbName} 向量库重建任务已提交（${strategy}）`);
      onOpenChange(false);
    } catch (e) { reportError(e, '重建向量库失败'); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>重建向量库 · {kbName}</DialogTitle>
        <div className="space-y-2 text-sm">
          <label className="block">嵌入模型
            <select className="mt-1 w-full rounded border p-2" value={embed} onChange={(e) => setEmbed(e.target.value)}>
              {models.length === 0 ? <option value="">（无可用嵌入模型）</option> : null}
              {models.map((m) => <option key={m.id} value={m.model_name}>{m.model_name}{m.platform_name ? ` · ${m.platform_name}` : ''}</option>)}
            </select>
          </label>
          <label className="block">重置策略
            <select className="mt-1 w-full rounded border p-2" value={strategy} onChange={(e) => setStrategy(e.target.value as 'atomic_swap' | 'clear_then_rebuild')}>
              <option value="atomic_swap">atomic_swap（影子索引切换，期间可用）</option>
              <option value="clear_then_rebuild">clear_then_rebuild（先清空后重建）</option>
            </select>
          </label>
          <p className="text-xs text-amber-600">重建会按所选模型重新切片并写入向量库，耗时取决于文档量。</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button size="sm" disabled={busy || !embed} onClick={() => void run()}>{busy ? '提交中…' : '开始重建'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
