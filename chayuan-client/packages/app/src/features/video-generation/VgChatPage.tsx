/**
 * Chat-driven 视频生成入口 — 重设计后的主交互(占位实现)。
 *
 * 设计参考前一轮 brainstorming 方案(用户拍板):
 *   - 复用 ChatComposer 输入框 + 附件 + 模型选择
 *   - 复用 ConversationView 消息列表
 *   - 流式脚本作为 assistant message;消息块下方嵌 TTS 卡 + 字幕编辑图标
 *   - "去生成"按钮弹素材抽屉(本地/在线/URL/上传)
 *   - 字幕编辑器走 ArtifactPanel 弹出
 *   - URL 解析(BeautifulSoup + PyMuPDF)走后端 N1.c extractor
 *   - 全自动模式 toggle(默认关)
 *
 * 这一对话仅占位,真实现见后续 N2/N3+ 系列 commit。
 */
import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { MessagesSquare, Layers, ArrowRight } from 'lucide-react';
import { useTabsStore } from '../../store/tabs';

export const VgChatPage: React.FC = () => {
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.open);

  const goBatch = () => {
    openTab('/video-generation/batch', { title: '批量生成', icon: 'layers' });
    void navigate({ to: '/video-generation/batch' as never });
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col items-center justify-center gap-6 px-6 py-10">
      <div className="rounded-3xl border border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-10 text-center">
        <MessagesSquare className="mx-auto h-12 w-12 text-[var(--cy-text-tertiary)]" />
        <h1 className="mt-4 text-2xl font-semibold text-[var(--cy-text-primary)]">
          对话式视频生成
        </h1>
        <p className="mt-2 max-w-xl text-sm text-[var(--cy-text-secondary)]">
          复用 ChatComposer 输入框 + 流式脚本回复 + 内嵌 TTS 选择 + 字幕
          编辑 Artifact + 素材抽屉 — 即将上线,见 ROADMAP N2-N5。
        </p>
        <p className="mt-3 text-xs text-[var(--cy-text-tertiary)]">
          当前阶段:可用「批量生成」走自动管道,也可走旧 wizard(已迁
          到 ``/video-generation/batch``)。
        </p>
        <button
          type="button"
          onClick={goBatch}
          className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--cy-brand-600)]"
        >
          <Layers className="h-4 w-4" /> 去批量生成 <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
