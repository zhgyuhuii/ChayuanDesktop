import * as React from 'react';
import { Music, Play, Pause } from 'lucide-react';
import { TRACK_H } from './TrackHeader';

/** 音乐(BGM)轨:只显名称(不显路径)+ 可在轨上试听。 */
export const BgmTrack: React.FC<{
  bgmName: string | null;
  bgmUrl?: string;
  contentWidthPx: number;
  /** BGM 块宽 = 内容长度(混音随片长,不应铺满标尺富余区);不传则铺满。 */
  bgmWidthPx?: number;
}> = ({ bgmName, bgmUrl, contentWidthPx, bgmWidthPx }) => {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = React.useState(false);
  React.useEffect(() => () => { audioRef.current?.pause(); }, []);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined); else a.pause();
  };

  return (
    <div className="relative border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
      style={{ height: TRACK_H, width: contentWidthPx }}>
      {bgmName ? (
        <div className="absolute left-1 top-1.5 flex h-8 items-center gap-1 overflow-hidden rounded border border-emerald-300 bg-emerald-50 px-2 text-[10px] text-emerald-800"
          style={{ width: Math.max(40, (bgmWidthPx ?? contentWidthPx) - 8) }}>
          <Music className="h-3 w-3 shrink-0" />
          <span className="truncate">{bgmName}</span>
          {bgmUrl && (
            <>
              <button type="button" onClick={toggle} title={playing ? '暂停' : '试听'}
                className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-emerald-100">
                {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              </button>
              <audio ref={audioRef} src={bgmUrl} preload="none"
                onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};
