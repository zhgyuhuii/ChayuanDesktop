/**
 * Step 2 · 脚本(三模式 chip 切换)。
 *
 * 模式:
 *   - ai      LLM 同步生成 + 可编辑(M2 后端 /script 是同步非 SSE,前端
 *             不做 token-by-token,直接 loading 等结果落地)
 *   - manual  用户手写 / 粘贴纯文本
 *   - srt     用户粘贴 SRT/VTT — 改动 debounce 600ms 后调后端解析校验,
 *             成功的 SrtCue 列表写入 vgComposer.params.srt_cues
 */
import * as React from 'react';
import { Loader2, Sparkles, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { videoGeneration, type VgScriptSource, type VgSrtCue } from '@chayuan/api';
import { useVgComposer } from '../store/vgComposer';
import { reportError } from '../../../store/errorDialog';

const TABS: Array<{ id: VgScriptSource; label: string; hint: string }> = [
  { id: 'ai', label: 'AI 生成', hint: '主题 → LLM 生成文案,可编辑' },
  { id: 'manual', label: '我自己写', hint: '粘贴纯文本,TTS 自然朗读' },
  { id: 'srt', label: '粘贴字幕', hint: 'SRT/VTT,字幕时间已固化' },
];

/** 估算朗读时长 — 中文 ~3.5 字/s, 英文 ~3 词/s。 */
function estimateReadingSeconds(text: string): number {
  if (!text) return 0;
  const cn = (text.match(/[一-龥]/g) || []).length;
  const en = (text.match(/[A-Za-z]+/g) || []).length;
  return Math.round(cn / 3.5 + en / 3);
}

export const ScriptStep: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const slots = useVgComposer((s) => s.scriptSlots);
  const setScriptSource = useVgComposer((s) => s.setScriptSource);
  const setScriptSlot = useVgComposer((s) => s.setScriptSlot);
  const setSrtCues = useVgComposer((s) => s.setSrtCues);

  // ── AI 模式:LLM 生成 ──────────────────────────────────────
  const [generating, setGenerating] = React.useState(false);
  const onGenerate = React.useCallback(async () => {
    if (!params.video_subject.trim()) {
      reportError(new Error('请先回 step 1 填写视频主题'));
      return;
    }
    setGenerating(true);
    try {
      const { video_script } = await videoGeneration.generateScript({
        video_subject: params.video_subject,
        video_language: params.video_language,
        paragraph_number: params.paragraph_number,
      });
      setScriptSlot('ai', video_script || '');
    } catch (e) {
      reportError(e as Error, '生成脚本失败 — 请检查模型广场是否有可用 chat 模型');
    } finally {
      setGenerating(false);
    }
  }, [params.video_subject, params.video_language, params.paragraph_number, setScriptSlot]);

  // ── SRT 模式:debounce 解析校验 ─────────────────────────────
  const [parsing, setParsing] = React.useState(false);
  const [parsed, setParsed] = React.useState<{ count: number; cues: VgSrtCue[] } | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const parseTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (params.script_source !== 'srt') return;
    if (parseTimerRef.current) window.clearTimeout(parseTimerRef.current);
    if (!slots.srt.trim()) {
      setParsed(null);
      setParseError(null);
      setSrtCues([]);
      return;
    }
    parseTimerRef.current = window.setTimeout(async () => {
      setParsing(true);
      setParseError(null);
      try {
        const r = await videoGeneration.parseSrt(slots.srt);
        setParsed(r);
        setSrtCues(r.cues);
      } catch (e) {
        setParseError((e as Error).message || 'SRT 解析失败');
        setParsed(null);
      } finally {
        setParsing(false);
      }
    }, 600);
    return () => {
      if (parseTimerRef.current) window.clearTimeout(parseTimerRef.current);
    };
  }, [slots.srt, params.script_source, setSrtCues]);

  const currentText =
    params.script_source === 'ai' ? slots.ai
    : params.script_source === 'manual' ? slots.manual
    : slots.srt;
  const chars = currentText.length;
  const seconds = estimateReadingSeconds(currentText);

  return (
    <div className="space-y-4">
      {/* 模式 chip */}
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => setScriptSource(t.id)}
            className={
              'rounded-full border px-3 py-1.5 text-xs transition-colors ' +
              (params.script_source === t.id
                ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')
            }
          >
            {t.label}
          </button>
        ))}
        <span className="text-xs text-[var(--cy-text-tertiary)] self-center">
          {TABS.find((t) => t.id === params.script_source)?.hint}
        </span>
      </div>

      {/* AI 生成 */}
      {params.script_source === 'ai' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-[var(--cy-text-tertiary)]">
            <span>主题:{params.video_subject || '(未填,请回 step 1 填写)'}</span>
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating || !params.video_subject.trim()}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[var(--cy-brand-500)] px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-[var(--cy-brand-600)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : slots.ai ? (
                <RefreshCw className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {generating ? '生成中…' : slots.ai ? '重新生成' : '生成脚本'}
            </button>
          </div>
          <textarea
            className="h-64 w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]"
            placeholder="点击「生成脚本」让 LLM 写好后再编辑;或直接在这里手写"
            value={slots.ai}
            onChange={(e) => setScriptSlot('ai', e.target.value)}
          />
        </div>
      )}

      {/* 手写 */}
      {params.script_source === 'manual' && (
        <textarea
          className="h-64 w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]"
          placeholder="在这里粘贴或手写视频文案 — TTS 会按自然节奏朗读"
          value={slots.manual}
          onChange={(e) => setScriptSlot('manual', e.target.value)}
        />
      )}

      {/* SRT 粘贴 + 解析反馈 */}
      {params.script_source === 'srt' && (
        <div className="space-y-2">
          <textarea
            className="h-64 w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]"
            placeholder={'1\n00:00:00,000 --> 00:00:03,500\n春天的花海如诗如画\n\n2\n00:00:03,500 --> 00:00:07,000\n万物复苏的季节'}
            value={slots.srt}
            onChange={(e) => setScriptSlot('srt', e.target.value)}
          />
          <div className="flex items-center gap-2 text-xs">
            {parsing && (
              <span className="inline-flex items-center gap-1 text-[var(--cy-text-tertiary)]">
                <Loader2 className="h-3 w-3 animate-spin" /> 解析中…
              </span>
            )}
            {parsed && !parsing && (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="h-3 w-3" /> 解析成功 · 共 {parsed.count} 行字幕
                {parsed.cues.length > 0 && parsed.cues[parsed.cues.length - 1]?.end_ms && (
                  <span className="ml-1 text-[var(--cy-text-tertiary)]">
                    · 总时长 ~{Math.round((parsed.cues[parsed.cues.length - 1]!.end_ms) / 1000)}s
                  </span>
                )}
              </span>
            )}
            {parseError && !parsing && (
              <span className="inline-flex items-center gap-1 text-rose-700">
                <AlertCircle className="h-3 w-3" /> {parseError}
              </span>
            )}
            <span className="ml-auto text-[var(--cy-text-tertiary)]">
              支持 SRT / VTT,UTF-8
            </span>
          </div>
        </div>
      )}

      {/* 全模式共用:字符数 + 预估朗读时长 */}
      <p className="text-[10px] text-[var(--cy-text-tertiary)]">
        {chars} 字符 · 预估朗读 ~{seconds}s · 越接近 30-90s 越适合短视频
      </p>
    </div>
  );
};
