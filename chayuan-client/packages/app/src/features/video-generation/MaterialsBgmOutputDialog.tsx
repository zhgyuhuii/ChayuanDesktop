/**
 * 整合 Dialog — 用户点 "去生成视频" 后弹,完成最后配置:
 *   素材(我的素材/在线搜索/从链接) / 在线搜索关键词(在线源) / 背景音乐
 * 字幕样式 + 渲染参数在对话输入框上方工具栏已配,这里不重复。
 *
 * 提交按钮回调 onConfirm,父级(VgMessageExtras → VgChatPage)拿当前 message 信息
 * 调 videoGeneration.submitTask。
 */
import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose, DialogFooter } from '@chayuan/ui';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { videoGeneration } from '@chayuan/api';
import { MaterialsSection } from './sections/MaterialsSection';
import { BgmSection } from './sections/BgmSection';
import { useVgComposer } from './store/vgComposer';
import { reportError } from '../../store/errorDialog';

export interface MaterialsBgmOutputDialogProps {
  open: boolean;
  onOpenChange(o: boolean): void;
  onConfirm(): void | Promise<void>;
  /** 当前消息脚本 — 给"自动生成关键词"用(video_subject 为空时退化用脚本前 80 字)。 */
  script?: string;
}

/**
 * 在线自动下载关键词编辑 — 仅在线源(pexels/pixabay)显示。
 * 绑定 vgComposer.params.video_terms(runner 优先用它,空才 LLM 生成)。
 * 可手动编辑,也可点「自动生成」用脚本/主题调 LLM 填充后再改。
 */
const TermsField: React.FC<{ script: string }> = ({ script }) => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const [gen, setGen] = React.useState(false);
  if (params.video_source === 'local') return null;
  const termsStr = Array.isArray(params.video_terms)
    ? params.video_terms.join(', ')
    : (params.video_terms || '');
  const autoGen = async () => {
    setGen(true);
    try {
      const subj = (params.video_subject || script.slice(0, 80)).trim();
      const r = await videoGeneration.generateTerms({ video_subject: subj, video_script: script });
      patch({ video_terms: r.video_terms });
    } catch (e) {
      reportError(e as Error, '生成关键词失败');
    } finally {
      setGen(false);
    }
  };
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--cy-text-primary)]">在线搜索关键词</h3>
        <button type="button" onClick={() => void autoGen()} disabled={gen}
          className="inline-flex items-center gap-1 rounded border border-[var(--cy-border-subtle)] px-2 py-1 text-xs hover:border-[var(--cy-brand-500)] disabled:opacity-50">
          {gen ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} 自动生成
        </button>
      </div>
      <textarea
        rows={2}
        value={termsStr}
        onChange={(e) => patch({ video_terms: e.target.value })}
        placeholder="英文关键词,逗号分隔(如 city night, blue sky);留空则提交后自动生成"
        className="w-full resize-y rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]"
      />
      <p className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]">
        用于从 Pexels/Pixabay 自动下载素材;可手动编辑或点「自动生成」由 AI 填充。
      </p>
    </section>
  );
};

export const MaterialsBgmOutputDialog: React.FC<MaterialsBgmOutputDialogProps> = ({
  open, onOpenChange, onConfirm, script = '',
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="!w-[min(1080px,calc(100vw-32px))] !max-w-[1080px] max-h-[88vh] overflow-hidden flex flex-col gap-0 p-0">
      <DialogHeader className="flex flex-row items-center justify-between border-b border-[var(--cy-border-subtle)] px-4 py-3">
        <DialogTitle className="text-base font-semibold">完成最后配置</DialogTitle>
        <DialogClose className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--cy-surface-2)]">
          <X className="h-4 w-4" />
        </DialogClose>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto cy-hide-scrollbar p-4 space-y-6">
        <MaterialsSection />
        <TermsField script={script} />
        <BgmSection />
      </div>
      <DialogFooter className="border-t border-[var(--cy-border-subtle)] px-4 py-3">
        <DialogClose className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm hover:border-[var(--cy-border-strong)]">
          取消
        </DialogClose>
        <button type="button" onClick={() => void onConfirm()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-4 py-1.5 text-sm font-medium text-white shadow">
          <Sparkles className="h-4 w-4" /> 提交生成
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
