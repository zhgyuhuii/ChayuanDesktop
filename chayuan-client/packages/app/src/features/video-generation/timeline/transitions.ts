import { Ban, Blend, MoveRight, MoveLeft, MoveUp, MoveDown, Shuffle } from 'lucide-react';
import type * as React from 'react';

/**
 * 逐片段转场选项(转场作用于「上一片段 → 本片段」的切点)。
 * 值与后端 compose 映射一致(见 _video_effects):
 *   fade→淡化、slide_*→对应方向滑入、shuffle→随机。
 */
export interface TransitionOption {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const TRANSITIONS: TransitionOption[] = [
  { value: 'none', label: '无', icon: Ban },
  { value: 'fade', label: '淡化', icon: Blend },
  { value: 'slide_left', label: '左滑入', icon: MoveRight },
  { value: 'slide_right', label: '右滑入', icon: MoveLeft },
  { value: 'slide_top', label: '上滑入', icon: MoveDown },
  { value: 'slide_bottom', label: '下滑入', icon: MoveUp },
  { value: 'shuffle', label: '随机', icon: Shuffle },
];

export const transitionLabel = (v?: string): string =>
  TRANSITIONS.find((t) => t.value === v)?.label ?? '无';
export const hasTransition = (v?: string): boolean => !!v && v !== 'none';
