/**
 * Wizard 状态 — Zustand store。
 *
 * 跟 ChatComposer 同构(packages/app/src/store/composer.ts):
 * - persist(LS key `cy.vgComposer`)只保存"用户偏好"字段(语音/字幕样式
 *   /BGM 选择等),不保存当前任务运行态。
 * - 三模式分支字段共存:ScriptStep 在 [ai / manual / srt] chip 间切换
 *   时,各 slot 已填内容不丢(各持各的 string,提交时按 script_source
 *   决定用哪个 slot 当 video_script / srt_cues)。
 *
 * 任务运行态(activeTaskId / SSE 进度)单独走 vgTaskRuntime hook(非
 * persist),保持 store 简洁。
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  VG_DEFAULT_PARAMS,
  type VgScriptSource,
  type VgSrtCue,
  type VgStopAt,
  type VgVideoParams,
} from '@chayuan/api';

/** 时间轴预生成草稿素材项。 */
export interface VgTimelineDraftMaterial {
  idx: number;
  durationMs: number;
}

/** 时间轴预生成草稿(会话级,非 persist):stop_at=materials 产物的缓存。 */
export interface VgTimelineDraft {
  taskId: string | null;
  scriptHash: string;
  state: 'idle' | 'generating' | 'ready' | 'failed';
  audioFileName: string | null;
  subtitleFileName: string | null;
  audioDurationMs: number;
  materials: VgTimelineDraftMaterial[];
  error?: string;
}

const EMPTY_DRAFT: VgTimelineDraft = {
  taskId: null, scriptHash: '', state: 'idle',
  audioFileName: null, subtitleFileName: null, audioDurationMs: 0, materials: [],
};

/** 草稿失效指纹:仅脚本/语音/BGM/语言/段落 —— 画幅/timeline/素材排列不计入。 */
export function scriptHashOf(p: VgVideoParams): string {
  return JSON.stringify([
    p.video_subject, p.video_script, p.voice_provider, p.voice_name, p.voice_rate, p.voice_volume,
    p.bgm_type, p.bgm_file, p.video_language, p.paragraph_number,
  ]);
}

/** Wizard 当前 step;1-based,跟前端进度条 step 数对齐。 */
export type VgWizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Wizard step 顺序,UI 进度条共用 */
export const VG_WIZARD_STEPS: ReadonlyArray<{ step: VgWizardStep; label: string }> = [
  { step: 1, label: '选题' },
  { step: 2, label: '脚本' },
  { step: 3, label: '语音' },
  { step: 4, label: '字幕' },
  { step: 5, label: '素材' },
  { step: 6, label: '配乐+输出' },
  { step: 7, label: '渲染' },
];

interface VgComposerState {
  /** 当前 wizard step */
  step: VgWizardStep;
  /** 提交参数主体 — VideoParams 一一对应 */
  params: VgVideoParams;
  /** 三模式分支 slot — 切换 chip 不丢已填内容 */
  scriptSlots: {
    ai: string;       // AI 生成后用户编辑过的版本
    manual: string;   // 用户手写
    srt: string;      // 用户粘贴的 SRT/VTT 原文(解析后填 params.srt_cues)
  };
  /** 当前活动任务 id — 渲染步骤的 SSE 订阅锚点,刷新页面会清空(非 persist) */
  activeTaskId: string | null;
  /** 时间轴预生成草稿(会话级,非 persist) */
  timelineDraft: VgTimelineDraft;

  // ── actions ────────────────────────────────────────────────
  setStep(step: VgWizardStep): void;
  next(): void;
  prev(): void;
  /** 整体重置(回到选题) */
  reset(): void;
  /** 局部更新 params */
  patchParams(patch: Partial<VgVideoParams>): void;
  /** 设置 script_source 并把对应 slot 的 string 同步到 params.video_script */
  setScriptSource(s: VgScriptSource): void;
  /** 写 ai/manual 任一 slot,并 mirror 到 params.video_script(若当前 script_source 命中) */
  setScriptSlot(slot: 'ai' | 'manual' | 'srt', text: string): void;
  /** SRT 解析成功后写入 cues(同时保留 srt slot 原文便于回看) */
  setSrtCues(cues: VgSrtCue[]): void;
  setActiveTaskId(id: string | null): void;
  setDraft(d: VgTimelineDraft): void;
  patchDraft(patch: Partial<VgTimelineDraft>): void;
  resetDraft(): void;
}

const PERSIST_KEY = 'cy.vgComposer';

export const useVgComposer = create<VgComposerState>()(
  persist(
    (set) => ({
      step: 1,
      params: { ...VG_DEFAULT_PARAMS },
      scriptSlots: { ai: '', manual: '', srt: '' },
      activeTaskId: null,
      timelineDraft: EMPTY_DRAFT,

      setStep: (step) => set({ step }),
      next: () =>
        set((s) => ({
          step: Math.min(7, (s.step + 1)) as VgWizardStep,
        })),
      prev: () =>
        set((s) => ({
          step: Math.max(1, (s.step - 1)) as VgWizardStep,
        })),

      reset: () =>
        set({
          step: 1,
          params: { ...VG_DEFAULT_PARAMS },
          scriptSlots: { ai: '', manual: '', srt: '' },
          activeTaskId: null,
        }),

      patchParams: (patch) =>
        set((s) => ({ params: { ...s.params, ...patch } })),

      setScriptSource: (src) =>
        set((s) => {
          const mirror =
            src === 'ai' ? s.scriptSlots.ai :
            src === 'manual' ? s.scriptSlots.manual :
            s.scriptSlots.srt; // srt 模式 video_script 也保留原文便于 LLM term 生成 fallback
          return {
            params: { ...s.params, script_source: src, video_script: mirror },
          };
        }),

      setScriptSlot: (slot, text) =>
        set((s) => {
          const next = { ...s.scriptSlots, [slot]: text };
          const mirror = s.params.script_source === slot ? text : s.params.video_script;
          return {
            scriptSlots: next,
            params: { ...s.params, video_script: mirror },
          };
        }),

      setSrtCues: (cues) =>
        set((s) => ({ params: { ...s.params, srt_cues: cues } })),

      setActiveTaskId: (id) => set({ activeTaskId: id }),
      setDraft: (d) => set({ timelineDraft: d }),
      patchDraft: (patch) => set((s) => ({ timelineDraft: { ...s.timelineDraft, ...patch } })),
      resetDraft: () => set({ timelineDraft: EMPTY_DRAFT }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      // 只保用户偏好:语音/字幕样式/BGM/画幅;不保 video_subject / scriptSlots
      // (避免下次回到 wizard 还顶着上次的内容,改成空白起步,贴上次内容
      // 通过"复制重做"功能从我的视频页恢复)
      partialize: (s) => ({
        params: {
          ...VG_DEFAULT_PARAMS,
          video_aspect: s.params.video_aspect,
          voice_name: s.params.voice_name,
          voice_provider: s.params.voice_provider,
          voice_rate: s.params.voice_rate,
          voice_volume: s.params.voice_volume,
          bgm_type: s.params.bgm_type,
          bgm_volume: s.params.bgm_volume,
          subtitle_enabled: s.params.subtitle_enabled,
          subtitle_position: s.params.subtitle_position,
          font_name: s.params.font_name,
          font_size: s.params.font_size,
          text_fore_color: s.params.text_fore_color,
          text_background_color: s.params.text_background_color,
          stroke_color: s.params.stroke_color,
          stroke_width: s.params.stroke_width,
          video_concat_mode: s.params.video_concat_mode,
          video_transition_mode: s.params.video_transition_mode,
          video_clip_duration: s.params.video_clip_duration,
          video_count: s.params.video_count,
          video_source: s.params.video_source,
          n_threads: s.params.n_threads,
        },
      }),
    },
  ),
);

/** 帮 wizard 决定提交时的 stop_at(默认 video 全跑) */
export function deriveStopAt(step: VgWizardStep): VgStopAt {
  // 当前 step 单跑预览时用,生产提交直接 video。
  // step 1/2 单跑 = script,3 = audio,4 = subtitle,5 = materials,
  // 6/7 = video(全流程)
  if (step <= 2) return 'script';
  if (step === 3) return 'audio';
  if (step === 4) return 'subtitle';
  if (step === 5) return 'materials';
  return 'video';
}
