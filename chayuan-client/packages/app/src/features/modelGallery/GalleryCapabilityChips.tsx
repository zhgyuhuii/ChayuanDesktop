/**
 * 模型广场能力筛选 chips。
 *
 * 复用说明:视觉与 ``composer/modelCapabilityChip`` 的 CapabilityChip 同款
 * (圆角 pill + 同色板),但**取值不同** —— 模型广场走后端 model-hub 的
 * 统一能力词表(连字符形式:chat / text-embedding / rerank / speech-to-text /
 * text-to-audio / image-embedding / image-to-text / text-to-image /
 * text-to-video),直接对应 ``HubModelCard.capability`` 与 search 的
 * ``capability`` 过滤参数。CapabilityChip 用的是 transport 内部短码
 * (chat/vl/t2i/...),与 hub 词表不一致,故不能直接复用其取值,这里独立列。
 */

import { cn } from '@chayuan/ui';
import * as React from 'react';

/** 后端 model-hub 统一能力取值(连字符形式)。 */
export const GALLERY_CAPABILITIES = [
  'chat',
  'text-embedding',
  'rerank',
  'speech-to-text',
  'text-to-audio',
  'image-embedding',
  'image-to-text',
  'text-to-image',
  'text-to-video',
] as const;

export type GalleryCapability = (typeof GALLERY_CAPABILITIES)[number];

interface CapMeta {
  label: string;
  classes: string;
  classesActive: string;
}

/** 与 modelCapabilityChip 的色板保持一致(同 capability 同色)。 */
const CAP_META: Record<GalleryCapability, CapMeta> = {
  chat: {
    label: '对话',
    classes: 'bg-blue-50 text-blue-700 border-blue-200',
    classesActive: 'bg-blue-600 text-white border-blue-600',
  },
  'text-embedding': {
    label: '文本嵌入',
    classes: 'bg-zinc-100 text-zinc-700 border-zinc-300',
    classesActive: 'bg-zinc-700 text-white border-zinc-700',
  },
  rerank: {
    label: '重排',
    classes: 'bg-zinc-100 text-zinc-700 border-zinc-300',
    classesActive: 'bg-zinc-700 text-white border-zinc-700',
  },
  'speech-to-text': {
    label: '语音识别',
    classes: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    classesActive: 'bg-cyan-600 text-white border-cyan-600',
  },
  'text-to-audio': {
    label: '语音合成',
    classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    classesActive: 'bg-emerald-600 text-white border-emerald-600',
  },
  'image-embedding': {
    label: '图像嵌入',
    classes: 'bg-teal-50 text-teal-700 border-teal-200',
    classesActive: 'bg-teal-600 text-white border-teal-600',
  },
  'image-to-text': {
    label: '图文理解',
    classes: 'bg-violet-50 text-violet-700 border-violet-200',
    classesActive: 'bg-violet-600 text-white border-violet-600',
  },
  'text-to-image': {
    label: '文生图',
    classes: 'bg-pink-50 text-pink-700 border-pink-200',
    classesActive: 'bg-pink-600 text-white border-pink-600',
  },
  'text-to-video': {
    label: '文生视频',
    classes: 'bg-rose-50 text-rose-700 border-rose-200',
    classesActive: 'bg-rose-600 text-white border-rose-600',
  },
};

/** 给 ModelHubRow 用:把后端 capability 值翻成中文短标签(未知值原样返回)。 */
export function capabilityLabel(cap: string): string {
  return CAP_META[cap as GalleryCapability]?.label ?? cap;
}

const CHIP_BASE =
  'inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium transition-colors';

export interface GalleryCapabilityChipsProps {
  /** 当前选中能力;null = 全部 */
  value: string | null;
  onChange(next: string | null): void;
}

/**
 * 一行能力筛选 chip:首个「全部」(null)+ 九种能力。点已选中的能力再点一下取消
 * (回到「全部」)。
 */
export const GalleryCapabilityChips: React.FC<GalleryCapabilityChipsProps> = ({
  value,
  onChange,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        className={cn(
          CHIP_BASE,
          value === null
            ? 'border-[var(--cy-ink-700)] bg-[var(--cy-ink-700)] text-white'
            : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]',
        )}
        title="显示所有类型"
      >
        全部
      </button>
      {GALLERY_CAPABILITIES.map((cap) => {
        const meta = CAP_META[cap];
        const active = value === cap;
        return (
          <button
            key={cap}
            type="button"
            onClick={() => onChange(active ? null : cap)}
            aria-pressed={active}
            title={meta.label}
            className={cn(CHIP_BASE, active ? meta.classesActive : meta.classes)}
          >
            {meta.label}
          </button>
        );
      })}
    </div>
  );
};
