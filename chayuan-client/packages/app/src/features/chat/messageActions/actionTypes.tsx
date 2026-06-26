/**
 * 对话内联产出类型注册表。P1 只注册 tts;P2 图像 / P3 视频按同结构补。
 * 每类型自带:设置组件(受控)、默认设置、由设置构造 modality 的 model + params。
 */
import * as React from 'react';
import { Volume2, Image as ImageIcon, Clapperboard, Wand2, Film } from 'lucide-react';
import type { ModalityCapability } from '@chayuan/transport';
import type { ActionTypeKey } from './intentDetect';
import { TtsActionSettings, DEFAULT_TTS_SETTINGS, type TtsSettings } from './TtsActionSettings';
import { ImageActionSettings, DEFAULT_IMAGE_SETTINGS, type ImageSettings } from './ImageActionSettings';
import { VideoActionSettings, DEFAULT_VIDEO_SETTINGS, type VideoSettings } from './VideoActionSettings';

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
  /** true 时面板显示「模型选择」(图像/视频选真模型);tts 用本地引擎不需要 */
  usesModelPicker?: boolean;
  /** true 时面板需上传参考图(image_edit / i2v) */
  needsRefImage?: boolean;
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
    language: s.language || 'zh',
  }),
  artifactKind: 'audio',
};

const T2I_DEF: ActionTypeDef<ImageSettings> = {
  key: 't2i',
  label: '生成图像',
  icon: ImageIcon,
  capability: 't2i',
  Settings: ImageActionSettings,
  defaultSettings: DEFAULT_IMAGE_SETTINGS,
  buildModel: () => '', // 由面板模型选择决定
  buildParams: (s) => ({ size: s.size, n: s.n }),
  artifactKind: 'image',
  usesModelPicker: true,
};

const T2V_DEF: ActionTypeDef<VideoSettings> = {
  key: 't2v',
  label: '生成视频',
  icon: Clapperboard,
  capability: 't2v',
  Settings: VideoActionSettings,
  defaultSettings: DEFAULT_VIDEO_SETTINGS,
  buildModel: () => '',
  buildParams: (s) => ({ size: s.size, duration: s.duration }),
  artifactKind: 'video',
  usesModelPicker: true,
};

const IMAGE_EDIT_DEF: ActionTypeDef<ImageSettings> = {
  key: 'image_edit',
  label: '图像编辑',
  icon: Wand2,
  capability: 'image_edit',
  Settings: ImageActionSettings,
  defaultSettings: DEFAULT_IMAGE_SETTINGS,
  buildModel: () => '',
  buildParams: (s) => ({ size: s.size, n: s.n }),
  artifactKind: 'image',
  usesModelPicker: true,
  needsRefImage: true,
};

const I2V_DEF: ActionTypeDef<VideoSettings> = {
  key: 'i2v',
  label: '图生视频',
  icon: Film,
  capability: 'i2v',
  Settings: VideoActionSettings,
  defaultSettings: DEFAULT_VIDEO_SETTINGS,
  buildModel: () => '',
  buildParams: (s) => ({ size: s.size, duration: s.duration }),
  artifactKind: 'video',
  usesModelPicker: true,
  needsRefImage: true,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ACTION_TYPES: Partial<Record<ActionTypeKey, ActionTypeDef<any>>> = {
  tts: TTS_DEF,
  t2i: T2I_DEF,
  t2v: T2V_DEF,
  image_edit: IMAGE_EDIT_DEF,
  i2v: I2V_DEF,
};
