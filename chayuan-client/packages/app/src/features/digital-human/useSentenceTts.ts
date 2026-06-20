import * as React from 'react';
import { videoGeneration } from '@chayuan/api';
import type { VgVoiceProvider } from '@chayuan/api';
import { takeCompleteSentences } from './liveSentences';
import { playAudioBlob } from '../video-generation/blobToDataUrl';

interface VoiceCfg {
  voice_provider?: VgVoiceProvider;
  voice_name?: string;
}

/**
 * 把"流式增长的回答文本"转成"逐句语音顺序播放"。
 * - feed(fullText):每次拿到更长的累积文本调一次;内部切出新完成句 → 入 TTS 队列。
 * - flush():流结束时把残句(未以标点结尾)也合成播。
 * - reset():新一轮回答前清空。
 * 顺序保证:一句 TTS 完成播放(audio.ended)才播下一句;TTS 单句失败跳过不卡队列。
 */
export function useSentenceTts(voice: VoiceCfg, enabled: boolean) {
  const consumedRef = React.useRef(0);
  const queueRef = React.useRef<string[]>([]);
  const playingRef = React.useRef(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const urlRef = React.useRef<string | null>(null);

  const playNext = React.useCallback(async () => {
    if (playingRef.current) return;
    const sentence = queueRef.current.shift();
    if (!sentence) return;
    playingRef.current = true;
    try {
      const { blob } = await videoGeneration.previewAudio({
        video_script: sentence,
        voice_provider: voice.voice_provider,
        voice_name: voice.voice_name || undefined,
      });
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      // blob: URL 优先;Windows WebView2 下 data: URL 作媒体源整段失效,失败回退 data:。
      let objUrl: string | null = null;
      await new Promise<void>((resolve) => {
        a.onended = () => resolve();
        a.onerror = () => resolve();
        void playAudioBlob(a, blob).then((u) => { objUrl = u; }).catch(() => resolve());
      });
      if (objUrl) {
        try { URL.revokeObjectURL(objUrl); } catch { /* ignore */ }
      }
    } catch {
      /* 单句失败:跳过,继续下一句 */
    } finally {
      playingRef.current = false;
      if (queueRef.current.length) void playNext();
    }
  }, [voice.voice_provider, voice.voice_name]);

  const enqueue = React.useCallback((sentences: string[]) => {
    const cleaned = sentences.map((s) => s.trim()).filter((s) => s.length > 0);
    if (!cleaned.length) return;
    queueRef.current.push(...cleaned);
    void playNext();
  }, [playNext]);

  const feed = React.useCallback((fullText: string) => {
    if (!enabled) return;
    const { sentences, consumed } = takeCompleteSentences(fullText, consumedRef.current);
    consumedRef.current = consumed;
    enqueue(sentences);
  }, [enabled, enqueue]);

  const flush = React.useCallback((fullText: string) => {
    if (!enabled) return;
    const rest = fullText.slice(consumedRef.current).trim();
    consumedRef.current = fullText.length;
    if (rest) enqueue([rest]);
  }, [enabled, enqueue]);

  const reset = React.useCallback(() => {
    consumedRef.current = 0;
    queueRef.current = [];
    try { audioRef.current?.pause(); } catch { /* noop */ }
  }, []);

  React.useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  return { feed, flush, reset };
}
