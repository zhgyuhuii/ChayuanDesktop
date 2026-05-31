import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { videoGeneration, type VgVideoParams } from '@chayuan/api';
import { scriptHashOf, type VgTimelineDraft } from '../store/vgComposer';
import { parseSrt, type SrtCue } from './srtParse';
import { buildTimelineFromMaterials } from './buildTimeline';
import { roundTimeline } from './timelineEdit';

const POLL_MS = 2500;

export function useVgDraft(args: {
  params: VgVideoParams;
  patchParams: (p: Partial<VgVideoParams>) => void;
  draft: VgTimelineDraft;
  patchDraft: (d: Partial<VgTimelineDraft>) => void;
  canGen: boolean;
  curHash: string;
}) {
  const { params, patchParams, draft, patchDraft, canGen, curHash } = args;
  const [peaks, setPeaks] = React.useState<number[]>([]);
  const [cues, setCues] = React.useState<SrtCue[]>([]);

  // 提交一次草稿生成(stop_at=subtitle:只旁白+字幕,不下素材)。
  // override 显式传参 → 避开 patchParams 异步闭包旧值,并保证「点了就生成」不靠 hash 变化。
  const runDraftGen = React.useCallback(async (override?: VgVideoParams) => {
    const base = override ?? params;
    const submitP = { ...base, timeline: base.timeline ? roundTimeline(base.timeline) : base.timeline };
    patchDraft({ state: 'generating', scriptHash: scriptHashOf(submitP), error: undefined, taskId: null });
    try {
      const t = await videoGeneration.submitTask(submitP, { stop_at: 'subtitle' });
      patchDraft({ taskId: t.task_id });
    } catch (e) {
      patchDraft({ state: 'failed', error: (e as Error).message });
    }
  }, [params, patchDraft]);
  const startDraftGen = React.useCallback(() => runDraftGen(), [runDraftGen]);

  // 手动脚本(#15):保存到 params.video_script(script_source=manual)
  const onSaveScript = (script: string) => patchParams({ video_script: script, script_source: 'manual', video_subject: '' });
  // 合成语音:按当前音频设置生成旁白+字幕
  const onSynthesizeScript = async (script: string) => {
    patchParams({ video_script: script, script_source: 'manual', video_subject: '' });
    await runDraftGen({ ...params, video_script: script, script_source: 'manual', video_subject: '' });
  };

  // ── 进页面 / 脚本变 → 自动生成旁白+字幕 ──
  // 仅当 hash 命中(当前脚本已 ready 或正在生成)才跳过;否则(idle/failed/旧 hash 卡 generating)重发。
  React.useEffect(() => {
    if (!canGen) return;
    if (draft.scriptHash === curHash && (draft.state === 'ready' || draft.state === 'generating')) return;
    void startDraftGen();
    // 依赖 canGen:去编辑合成进入时 video_script 可能晚一拍才到,canGen false→true 时补触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curHash, canGen]);

  // ── 轮询草稿 task 直到 complete ──
  useQuery({
    queryKey: ['vg.draft', draft.taskId],
    enabled: draft.state === 'generating' && !!draft.taskId,
    refetchInterval: POLL_MS,
    queryFn: async () => {
      const t = await videoGeneration.getTask(draft.taskId!);
      if (t.state === 'complete') {
        const res = t.result ?? {};
        const audioFull = String(res.audio_file ?? '');
        const subFull = String(res.subtitle_path ?? '');
        patchDraft({
          state: 'ready',
          audioFileName: audioFull ? audioFull.split(/[\\/]/).pop()! : null,
          subtitleFileName: subFull ? subFull.split(/[\\/]/).pop()! : null,
          // 旁白时长直接取任务结果(可靠),不依赖 audio-peaks;contentMs/旁白块据此显示
          audioDurationMs: Number(res.audio_duration_ms) || 0,
          script: String(res.script ?? ''), // 服务端生成的脚本,供「编辑脚本」回显
          materials: [], // P5a:素材手动拖入,草稿不再自动下素材
        });
      } else if (t.state === 'failed' || t.state === 'canceled') {
        patchDraft({ state: 'failed', error: t.error ?? '草稿生成失败' });
      }
      return t;
    },
  });

  // ── 草稿 ready → 拉波形 + 字幕,并据已选素材初始化 timeline ──
  React.useEffect(() => {
    if (draft.state !== 'ready' || !draft.taskId) return;
    (async () => {
      try {
        const pk = await videoGeneration.fetchAudioPeaks(draft.taskId!, 600);
        setPeaks(pk.peaks);
        if (pk.duration_ms > 0) patchDraft({ audioDurationMs: pk.duration_ms }); // 不用 0 覆盖结果里的可靠值
      } catch { setPeaks([]); }
      if (draft.subtitleFileName) {
        try {
          const { blob } = await videoGeneration.downloadTaskFile(draft.taskId!, draft.subtitleFileName);
          setCues(parseSrt(await blob.text()));
        } catch { setCues([]); }
      }
      if (!params.timeline) patchParams({ timeline: buildTimelineFromMaterials(params.video_materials ?? []) });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.state, draft.taskId]);

  return { peaks, cues, setCues, runDraftGen, startDraftGen, onSaveScript, onSynthesizeScript };
}
