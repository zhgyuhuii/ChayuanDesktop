/**
 * Step 3-7 简单占位 — M5.A3 仅保证 wizard 切换流程可见,具体功能 B 系列接入。
 */
import * as React from 'react';

interface PlaceholderProps {
  title: string;
  hint: string;
  todoMs: string;
}

const Placeholder: React.FC<PlaceholderProps> = ({ title, hint, todoMs }) => (
  <div className="rounded-2xl border border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-6 text-center">
    <h3 className="text-base font-semibold text-[var(--cy-text-primary)]">{title}</h3>
    <p className="mt-2 text-sm text-[var(--cy-text-secondary)]">{hint}</p>
    <p className="mt-3 inline-block rounded-full bg-amber-50 px-3 py-0.5 text-[10px] text-amber-700">
      留待 {todoMs} 实现
    </p>
  </div>
);

export const SubtitleStep: React.FC = () => (
  <Placeholder
    title="Step 4 · 字幕"
    hint="行级表格编辑,拖滑块改时间,拆分/合并,可读速度警告,单行重生 TTS"
    todoMs="M5.B3"
  />
);

export const MaterialsStep: React.FC = () => (
  <Placeholder
    title="Step 5 · 素材"
    hint="三 tab:我的素材库 / 在线搜索(Pexels/Pixabay) / 上传新素材;拖拽排序"
    todoMs="M5.B4"
  />
);

export const BgmOutputStep: React.FC = () => (
  <Placeholder
    title="Step 6 · 配乐 + 输出"
    hint="BGM 选择(内置 / 用户 / 无)+ 音量;数量、转场、拼接模式"
    todoMs="M5.B5"
  />
);

export const RenderStep: React.FC = () => (
  <Placeholder
    title="Step 7 · 渲染"
    hint="提交任务 → SSE 实时进度圆环 → 嵌入式播放器 + 下载 / 复制参数重做"
    todoMs="M5.B5"
  />
);
