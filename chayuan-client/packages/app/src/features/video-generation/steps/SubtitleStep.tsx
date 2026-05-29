/**
 * Step 4 · 字幕(行级表格编辑器)。
 *
 * 数据源:vgComposer.params.srt_cues
 * - SRT 粘贴模式:step 2 解析时已经填好
 * - AI / 手写模式:本步骤进来时如果还没字幕,提供"用脚本初始化字幕"
 *   按钮:按句号/逗号切 + 估算时长平摊到每句(完整 TTS-driven cues 要
 *   等 step 5 / step 7 跑 task 时由后端 SubMaker 产出再回写,M5.B5 实现)
 *
 * 编辑能力:
 *   ✏  text  inline 编辑
 *   ⏱  start_ms / end_ms 数字输入(毫秒整数)
 *   ✂  拆分:从光标位置或文本中点切两段,时长按字数比例分
 *   🔗  合并下一行:文本拼接 + end_ms 取后者
 *   🗑  删除行
 *   ⚠  可读速度警告:文本/(end-start)>5字/s 时高亮
 *
 * 字幕编辑没自动 "重新生成 TTS"(单行 TTS regen),这个交给 B5 实现;
 * 当前编辑完直接进 step 5 / 7,合成时 SRT 模式按这套 cues 走精准节奏。
 */
import * as React from 'react';
import { Plus, Scissors, Link2, Trash2, AlertTriangle, Wand2 } from 'lucide-react';
import type { VgSrtCue } from '@chayuan/api';
import { useVgComposer } from '../store/vgComposer';

const READING_SPEED_WARN = 5.0; // 字/s 阈值

function reindexCues(cues: VgSrtCue[]): VgSrtCue[] {
  return cues.map((c, i) => ({ ...c, index: i + 1 }));
}

function clampMs(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

function readingSpeed(cue: VgSrtCue): number {
  const dur = (cue.end_ms - cue.start_ms) / 1000;
  if (dur <= 0) return Infinity;
  return cue.text.length / dur;
}

/** 按句号/逗号切句,按字数等分时长 — 生成初始 cues。 */
function deriveCuesFromScript(text: string, totalMs: number): VgSrtCue[] {
  if (!text || totalMs <= 0) return [];
  const parts = text
    .split(/[?,.、;:!…？，。；：！]+|\.\.\./)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  const totalChars = parts.reduce((a, p) => a + p.length, 0) || 1;
  let cursor = 0;
  const out: VgSrtCue[] = [];
  parts.forEach((p, i) => {
    const share = Math.floor(totalMs * p.length / totalChars);
    const end = i === parts.length - 1 ? totalMs : cursor + share;
    out.push({ index: i + 1, start_ms: cursor, end_ms: end, text: p });
    cursor = end;
  });
  return out;
}

export interface SubtitleStepProps {
  /**
   * override 模式(chat-redesign):cues 由父级(VgMessageExtras → message.metadata.
   * videoMeta.scriptCues)提供,不读 vgComposer 全局 store。三个 override 一起传:
   *   - scriptOverride:当前 message 的脚本(用来"用脚本初始化字幕")
   *   - cuesOverride:当前 message 的 cues
   *   - onCuesOverride:写回 cues 的回调
   * 全不传时退回 wizard 旧行为(读写 vgComposer.params.srt_cues + scriptSlots)。
   */
  scriptOverride?: string;
  cuesOverride?: VgSrtCue[] | null;
  onCuesOverride?: (cues: VgSrtCue[]) => void;
}

export const SubtitleStep: React.FC<SubtitleStepProps> = ({
  scriptOverride,
  cuesOverride,
  onCuesOverride,
}) => {
  const storeCues = useVgComposer((s) => s.params.srt_cues) ?? [];
  const storeSetSrtCues = useVgComposer((s) => s.setSrtCues);
  const scriptSource = useVgComposer((s) => s.params.script_source);
  const slots = useVgComposer((s) => s.scriptSlots);
  const setParams = useVgComposer((s) => s.patchParams);

  // override 模式:cues / setter / script 都走父级;否则走全局 store
  const overriding = typeof onCuesOverride === 'function';
  const cues = overriding ? (cuesOverride ?? []) : storeCues;
  const setSrtCues = overriding ? onCuesOverride! : storeSetSrtCues;

  const currentScript = overriding
    ? (scriptOverride ?? '')
    : scriptSource === 'ai' ? slots.ai
    : scriptSource === 'manual' ? slots.manual
    : '';

  const onInitFromScript = React.useCallback(() => {
    // 估算总时长:中文 3.5 字/s + 英文 3 词/s
    const cn = (currentScript.match(/[一-龥]/g) || []).length;
    const en = (currentScript.match(/[A-Za-z]+/g) || []).length;
    const totalMs = Math.max(1000, Math.round((cn / 3.5 + en / 3) * 1000));
    setSrtCues(deriveCuesFromScript(currentScript, totalMs));
    // wizard 模式下顺便转 srt 模式让任务提交走 cues;override 模式不碰全局 store
    if (!overriding) setParams({ script_source: 'srt' });
  }, [currentScript, setSrtCues, setParams, overriding]);

  const patchCue = React.useCallback((idx: number, patch: Partial<VgSrtCue>) => {
    const next = cues.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    setSrtCues(reindexCues(next));
  }, [cues, setSrtCues]);

  const splitCue = React.useCallback((idx: number) => {
    const cur = cues[idx];
    if (!cur) return;
    const mid = Math.floor(cur.text.length / 2);
    if (mid <= 0) return;
    const leftText = cur.text.slice(0, mid).trim();
    const rightText = cur.text.slice(mid).trim();
    const dur = cur.end_ms - cur.start_ms;
    const leftShare = Math.floor(dur * leftText.length / (leftText.length + rightText.length || 1));
    const splitAt = cur.start_ms + leftShare;
    const left: VgSrtCue = { ...cur, end_ms: splitAt, text: leftText };
    const right: VgSrtCue = {
      index: cur.index + 1,
      start_ms: splitAt,
      end_ms: cur.end_ms,
      text: rightText,
    };
    const next = [...cues.slice(0, idx), left, right, ...cues.slice(idx + 1)];
    setSrtCues(reindexCues(next));
  }, [cues, setSrtCues]);

  const mergeWithNext = React.useCallback((idx: number) => {
    if (idx >= cues.length - 1) return;
    const a = cues[idx]; const b = cues[idx + 1];
    if (!a || !b) return;
    const merged: VgSrtCue = {
      index: a.index,
      start_ms: a.start_ms,
      end_ms: b.end_ms,
      text: `${a.text} ${b.text}`.trim(),
    };
    const next = [...cues.slice(0, idx), merged, ...cues.slice(idx + 2)];
    setSrtCues(reindexCues(next));
  }, [cues, setSrtCues]);

  const deleteCue = React.useCallback((idx: number) => {
    const next = cues.filter((_, i) => i !== idx);
    setSrtCues(reindexCues(next));
  }, [cues, setSrtCues]);

  const appendCue = React.useCallback(() => {
    const last = cues[cues.length - 1];
    const start = last ? last.end_ms : 0;
    const newCue: VgSrtCue = {
      index: cues.length + 1,
      start_ms: start,
      end_ms: start + 3000,
      text: '',
    };
    setSrtCues([...cues, newCue]);
  }, [cues, setSrtCues]);

  if (cues.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-8 text-center">
        <h3 className="text-base font-semibold text-[var(--cy-text-primary)]">还没有字幕</h3>
        <p className="mt-2 text-sm text-[var(--cy-text-secondary)]">
          字幕通常由 TTS 步骤产出(SubMaker timestamps);要立即编辑可由
          脚本初始化一份估算字幕,等任务跑完后用真实音频校对。
        </p>
        {currentScript.trim() && (
          <button
            type="button"
            onClick={onInitFromScript}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--cy-brand-600)]"
          >
            <Wand2 className="h-4 w-4" /> 用当前脚本初始化字幕
          </button>
        )}
        {!currentScript.trim() && scriptSource !== 'srt' && (
          <p className="mt-3 text-xs text-[var(--cy-text-tertiary)]">
            请先回 step 2 写好脚本,再回来初始化字幕
          </p>
        )}
      </div>
    );
  }

  const totalMs = cues.length > 0 ? cues[cues.length - 1]!.end_ms : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--cy-text-tertiary)]">
          {cues.length} 行 · 总时长 {(totalMs / 1000).toFixed(1)}s · 双击文本即可编辑
        </p>
        <button
          type="button"
          onClick={appendCue}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]"
        >
          <Plus className="h-3 w-3" /> 追加一行
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--cy-border-subtle)]">
        <table className="w-full min-w-max text-xs">
          <thead className="bg-[var(--cy-surface-1)]">
            <tr className="text-left text-[var(--cy-text-tertiary)]">
              <th className="px-2 py-2 w-10">#</th>
              <th className="px-2 py-2 w-24">起 (ms)</th>
              <th className="px-2 py-2 w-24">止 (ms)</th>
              <th className="px-2 py-2">字幕文本</th>
              <th className="px-2 py-2 w-32 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {cues.map((cue, idx) => {
              const speed = readingSpeed(cue);
              const overSpeed = speed > READING_SPEED_WARN;
              return (
                <tr key={idx} className="border-t border-[var(--cy-border-subtle)]">
                  <td className="px-2 py-1.5 align-top text-[var(--cy-text-tertiary)]">{cue.index}</td>
                  <td className="px-2 py-1.5 align-top">
                    <input
                      type="number"
                      min={0}
                      step={50}
                      value={cue.start_ms}
                      onChange={(e) => patchCue(idx, { start_ms: clampMs(parseInt(e.target.value, 10)) })}
                      className="w-20 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 py-0.5 text-xs"
                    />
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <input
                      type="number"
                      min={0}
                      step={50}
                      value={cue.end_ms}
                      onChange={(e) => patchCue(idx, { end_ms: clampMs(parseInt(e.target.value, 10)) })}
                      className="w-20 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 py-0.5 text-xs"
                    />
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <div className="flex items-start gap-1">
                      <textarea
                        rows={1}
                        value={cue.text}
                        onChange={(e) => patchCue(idx, { text: e.target.value })}
                        className={
                          'min-h-[1.75rem] w-full resize-y rounded border bg-[var(--cy-surface-base)] px-1.5 py-1 text-xs leading-snug focus:outline-none focus:ring-1 focus:ring-[var(--cy-brand-500)] ' +
                          (overSpeed
                            ? 'border-amber-300 bg-amber-50/40'
                            : 'border-[var(--cy-border-subtle)]')
                        }
                      />
                      {overSpeed && (
                        <span className="mt-1 inline-flex items-center" title={`${speed.toFixed(1)} 字/s,建议 ≤5`}>
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => splitCue(idx)}
                        title="拆分"
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-secondary)]"
                      >
                        <Scissors className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => mergeWithNext(idx)}
                        disabled={idx >= cues.length - 1}
                        title="合并下一行"
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-secondary)] disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCue(idx)}
                        title="删除"
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-rose-500 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-[var(--cy-text-tertiary)]">
        ⚠ 标记的行可读速度 &gt; {READING_SPEED_WARN} 字/s,观众可能跟不上。
        单行 TTS 重生功能留待 M5.B5 接入。
      </p>
    </div>
  );
};
