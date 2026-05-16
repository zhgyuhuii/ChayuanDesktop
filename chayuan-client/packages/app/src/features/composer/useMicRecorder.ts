/**
 * 实时语音输入 hook — 每 ~2.5s 重启 MediaRecorder 出独立 WebM 文件 → 转写 → onPartial。
 *
 * 用法:
 *   const mic = useMicRecorder({
 *     sliceMs: 2500,
 *     onPartial: (text, idx) => setDraft((p) => p + text + ' '),
 *     onError: (err) => toast(err.message),
 *   });
 *   <button onClick={mic.recording ? mic.stop : mic.start} />
 *   {mic.recording && <span>{mic.elapsed}s</span>}
 *
 * 切片策略 — 为什么 stop/restart 而不是 MediaRecorder.start(timeslice):
 *  timeslice 模式下只有 chunk #0 含完整 EBML/Tracks 头,chunk #1+ 是裸 Cluster 段,
 *  whisper / faster-whisper 单独解码必定失败 → 返回空字符串 → 体感"完全没识别"。
 *  改成"每 sliceMs 调一次 mr.stop() → 在同一 stream 上 new MediaRecorder 继续",
 *  每片都是自包含可解码的 WebM 文件。切片边界会丢 ~ms 级音频,可接受。
 *
 * 关键约束:
 *  - 每个 chunk 独立 transcribe POST,结果按 chunkIndex 排序后 commit
 *  - stop 时停止滚动 + 等所有 in-flight transcribe 完成再调 onFinal
 *  - cancel 时 abort 所有 in-flight 请求 + stop MediaRecorder
 *  - 浏览器不支持 audio/webm 时降级到默认 MIME(MediaRecorder 自选)
 */
import * as React from 'react';
import { modality } from '@chayuan/api';

export interface UseMicRecorderOptions {
  /** 切片时长(ms),默认 4000 */
  sliceMs?: number;
  /** 语言提示("zh"/"en"/""为自动) */
  language?: string;
  /** 每片转写完成后回调(按 chunkIndex 顺序;乱序到达会 buffer 等齐) */
  onPartial?: (text: string, chunkIndex: number) => void;
  /** 所有 chunk 转写完成 + stop 后整段文本回调 */
  onFinal?: (fullText: string) => void;
  /** 错误回调(getUserMedia 拒绝 / MediaRecorder unsupported) */
  onError?: (err: Error) => void;
}

export interface UseMicRecorderResult {
  recording: boolean;
  elapsed: number;
  /** 开始录音 */
  start: () => Promise<void>;
  /** 正常停止(等 in-flight 完成 + flush) */
  stop: () => void;
  /** 立刻取消(abort 所有 in-flight) */
  cancel: () => void;
}

export function useMicRecorder(opts: UseMicRecorderOptions = {}): UseMicRecorderResult {
  // 默认 2.5s 切片:首字反馈在 ~3-4s,体感"近实时";继续录音持续追加。
  const sliceMs = opts.sliceMs ?? 2500;
  const [recording, setRecording] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const mimeTypeRef = React.useRef<string>('');
  const chunkIndexRef = React.useRef(0);
  const expectedRef = React.useRef(0);
  const pendingRef = React.useRef<Map<number, string>>(new Map());
  const fullTextRef = React.useRef<string[]>([]);
  const abortersRef = React.useRef<AbortController[]>([]);
  const startTsRef = React.useRef(0);
  const tickerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const sliceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRequestedRef = React.useRef(false);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  const flushBuffered = React.useCallback(() => {
    while (pendingRef.current.has(expectedRef.current)) {
      const idx = expectedRef.current;
      const txt = pendingRef.current.get(idx)!;
      pendingRef.current.delete(idx);
      if (txt) {
        fullTextRef.current.push(txt);
        optsRef.current.onPartial?.(txt, idx);
      }
      expectedRef.current++;
    }
  }, []);

  const cleanup = React.useCallback(() => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (sliceTimerRef.current) {
      clearTimeout(sliceTimerRef.current);
      sliceTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    mimeTypeRef.current = '';
    abortersRef.current = [];
    setRecording(false);
    setElapsed(0);
  }, []);

  /** 启动单个 slice 的 MediaRecorder;mr.onstop 里要么开下一片,要么走 final。*/
  const startSlice = React.useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = mimeTypeRef.current;
    const mr = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    recorderRef.current = mr;

    mr.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      const idx = chunkIndexRef.current++;
      const ac = new AbortController();
      abortersRef.current.push(ac);
      // 此时 blob 是一个完整的 WebM 文件(含 EBML 头),whisper 可独立解码
      const ext = e.data.type.includes('webm')
        ? 'webm' : e.data.type.includes('ogg')
        ? 'ogg' : 'webm';
      const named = new File(
        [e.data], `chunk-${idx}.${ext}`,
        { type: e.data.type || 'audio/webm' },
      );
      console.debug(
        `[mic] chunk #${idx} size=${named.size}B type=${named.type}`,
      );
      modality
        .transcribe(named, { language: optsRef.current.language, signal: ac.signal })
        .then((r) => {
          const text = (r.text || '').trim();
          console.debug(`[mic] chunk #${idx} → "${text}" (${text.length} chars)`);
          pendingRef.current.set(idx, text);
          flushBuffered();
        })
        .catch((err) => {
          console.warn(`[mic] chunk #${idx} transcribe failed`, err);
          pendingRef.current.set(idx, '');
          flushBuffered();
        });
    };

    mr.onstop = () => {
      if (stopRequestedRef.current) {
        // 用户主动停 — 等所有 in-flight transcribe 完成再 onFinal
        const checkDone = () => {
          if (chunkIndexRef.current === expectedRef.current) {
            const full = fullTextRef.current.join(' ').trim();
            optsRef.current.onFinal?.(full);
            cleanup();
          } else {
            setTimeout(checkDone, 200);
          }
        };
        checkDone();
      } else {
        // slice 边界 — 立刻在同一 stream 上开下一片(微秒级 gap)
        startSlice();
      }
    };

    mr.start();
    // 定时停 → 触发 ondataavailable(完整文件)→ onstop → 起下一片
    sliceTimerRef.current = setTimeout(() => {
      try {
        if (recorderRef.current === mr && mr.state === 'recording') mr.stop();
      } catch {
        // ignore
      }
    }, sliceMs);
  }, [sliceMs, cleanup, flushBuffered]);

  const start = React.useCallback(async () => {
    if (recording) return;
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      optsRef.current.onError?.(new Error('浏览器不支持录音(MediaDevices)'));
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      optsRef.current.onError?.(new Error('浏览器不支持 MediaRecorder'));
      return;
    }
    chunkIndexRef.current = 0;
    expectedRef.current = 0;
    pendingRef.current.clear();
    fullTextRef.current = [];
    abortersRef.current = [];
    stopRequestedRef.current = false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      optsRef.current.onError?.(e instanceof Error ? e : new Error('麦克风权限被拒绝'));
      return;
    }
    streamRef.current = stream;
    mimeTypeRef.current = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

    startTsRef.current = Date.now();
    setRecording(true);
    tickerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTsRef.current) / 1000));
    }, 500);

    startSlice();
  }, [recording, startSlice]);

  const stop = React.useCallback(() => {
    if (!recording) return;
    stopRequestedRef.current = true;
    if (sliceTimerRef.current) {
      clearTimeout(sliceTimerRef.current);
      sliceTimerRef.current = null;
    }
    try {
      recorderRef.current?.stop();
    } catch {
      // ignore
    }
  }, [recording]);

  const cancel = React.useCallback(() => {
    stopRequestedRef.current = true;
    if (sliceTimerRef.current) {
      clearTimeout(sliceTimerRef.current);
      sliceTimerRef.current = null;
    }
    abortersRef.current.forEach((ac) => ac.abort());
    abortersRef.current = [];
    try {
      if (recording) recorderRef.current?.stop();
    } catch {
      // ignore
    }
    cleanup();
  }, [recording, cleanup]);

  React.useEffect(() => () => {
    // unmount 清理
    stopRequestedRef.current = true;
    abortersRef.current.forEach((ac) => ac.abort());
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (tickerRef.current) clearInterval(tickerRef.current);
    if (sliceTimerRef.current) clearTimeout(sliceTimerRef.current);
  }, []);

  return { recording, elapsed, start, stop, cancel };
}
