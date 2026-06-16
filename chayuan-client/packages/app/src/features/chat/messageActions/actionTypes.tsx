/**
 * 对话内联产出类型注册表。P1 只注册 tts;P2 图像 / P3 视频按同结构补。
 * 每类型自带:设置组件(受控)、默认设置、由设置构造 modality 的 model + params。
 */
import * as React from 'react';
import { Volume2 } from 'lucide-react';
import type { ModalityCapability } from '@chayuan/transport';
import type { ActionTypeKey } from './intentDetect';
import { TtsActionSettings, DEFAULT_TTS_SETTINGS, type TtsSettings } from './TtsActionSettings';

export interface ActionTypeDef<S = unknown> {
  key: ActionTypeKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  capability: ModalityCapability;
  Settings: React.FC<{ value: S; onChange: (v: S) => void }>;
  defaultSettings: S;
  /** 由设置构造 modality 的 model id(本地 tts 用伪模型) */
  buildModel: (s: S) => string;
  /** 由设置构造 modality params */
  buildParams: (s: S) => Record<string, unknown>;
  /** 产物 mediaType 前缀(用于面板内展示分发) */
  artifactKind: 'audio' | 'image' | 'video';
}

const TTS_DEF: ActionTypeDef<TtsSettings> = {
  key: 'tts',
  label: '合成语音',
  icon: Volume2,
  capability: 'tts',
  Settings: TtsActionSettings,
  defaultSettings: DEFAULT_TTS_SETTINGS,
  buildModel: (s) => `local-tts:${s.engine}`,
  buildParams: (s) => ({
    voice_name: s.voice || undefined,
    voice_rate: s.rate,
    voice_volume: s.volume,
    language: s.language || undefined,
  }),
  artifactKind: 'audio',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ACTION_TYPES: Partial<Record<ActionTypeKey, ActionTypeDef<any>>> = {
  tts: TTS_DEF,
};
