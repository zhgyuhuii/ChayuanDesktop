/**
 * 实时语音输入 hook — MediaRecorder 分片(4-5s)+ 串行 transcribe + onPartial 回调。
 *
 * 用法:
 *   const mic = useMicRecorder({
 *     sliceMs: 4000,
 *     onPartial: (text, idx) => setDraft((p) => p + text + ' '),
 *     onError: (err) => toast(err.message),
 *   });
 *   <button onClick={mic.recording ? mic.stop : mic.start} />
 *   {mic.recording && <span>{mic.elapsed}s</span>}
 *
 * 关键约束:
 *  - 每个 chunk 独立 transcribe POST,串行结果按 chunkIndex 排序后 commit
 *  - stop 时把当前 buffer 一次性提交,等所有 in-flight transcribe 完成再调 onFinal
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
  const chunkIndexRef = React.useRef(0);
  const expectedRef = React.useRef(0);
  const pendingRef = React.useRef<Map<number, string>>(new Map());
  const fullTextRef = React.useRef<string[]>([]);
  const abortersRef = React.useRef<AbortController[]>([]);
  const startTsRef = React.useRef(0);
  const tickerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
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
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    abortersRef.current = [];
    setRecording(false);
    setElapsed(0);
  }, []);

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
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      optsRef.current.onError?.(e instanceof Error ? e : new Error('麦克风权限被拒绝'));
      return;
    }
    streamRef.current = stream;
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
    const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorderRef.current = mr;

    mr.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      const idx = chunkIndexRef.current++;
      const ac = new AbortController();
      abortersRef.current.push(ac);
      // 给 blob 取个有效文件名,让后端通过 filename 推断格式(否则只能靠 content-type)
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
      // 等所有 in-flight transcribe 完成再触发 onFinal
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
    };

    mr.start(sliceMs);
    startTsRef.current = Date.now();
    setRecording(true);
    tickerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTsRef.current) / 1000));
    }, 500);
  }, [recording, sliceMs, cleanup, flushBuffered]);

  const stop = React.useCallback(() => {
    if (recording) recorderRef.current?.stop();
  }, [recording]);

  const cancel = React.useCallback(() => {
    abortersRef.current.forEach((ac) => ac.abort());
    abortersRef.current = [];
    if (recording) recorderRef.current?.stop();
    cleanup();
  }, [recording, cleanup]);

  React.useEffect(() => () => {
    // unmount 清理
    abortersRef.current.forEach((ac) => ac.abort());
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (tickerRef.current) clearInterval(tickerRef.current);
  }, []);

  return { recording, elapsed, start, stop, cancel };
}
