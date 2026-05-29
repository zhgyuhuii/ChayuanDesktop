/**
 * Step 6 · 配乐 + 输出参数(紧凑版)。
 *
 * - BGM:无 / 随机 / 指定(下拉)+ 音量(内联滑块)+ 试听 — 同一行
 * - 字幕样式:启用开关 + 位置/字体/字号/颜色/描边/背景 — 窄控件一行排布;
 *   字体下拉显示 family 名并按该字体预览(option style fontFamily)
 * - 渲染参数:数量 / 单段最长 / 拼接 / 转场 — 一行
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  videoGeneration,
  vgBgmFileUrl,
  type VgBgmItem,
  type VgFontItem,
} from '@chayuan/api';
import { Volume2 } from 'lucide-react';
import { useVgComposer } from '../store/vgComposer';
import { useTranslation } from '../../../i18n';

/** 音量控件:图标 + 点击弹出纵向滑块(比一条横滑块更紧凑不另类)。 */
const VolumePopover: React.FC<{ value: number; max?: number; onChange: (v: number) => void }> = ({
  value, max = 1, onChange,
}) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const pct = Math.round((value / max) * 100);
  return (
    <div ref={ref} className="relative inline-flex">
      <button type="button" onClick={() => setOpen((v) => !v)} title={`音量 ${pct}%`}
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]">
        <Volume2 className="h-3.5 w-3.5" />
        <span className="tabular-nums">{pct}%</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-3 shadow-lg">
          <div className="flex h-28 w-6 items-center justify-center">
            <input
              type="range" min={0} max={max} step={0.05} value={value}
              onChange={(e) => onChange(parseFloat(e.target.value))}
              className="w-24 -rotate-90 accent-[var(--cy-brand-500)]"
            />
          </div>
          <div className="mt-1 text-center text-[10px] tabular-nums text-[var(--cy-text-tertiary)]">{pct}%</div>
        </div>
      )}
    </div>
  );
};

// 转场 enum → i18n key(显示按系统语言,值仍发后端 enum)
const TRANSITIONS: ReadonlyArray<readonly [string, string]> = [
  ['', 'none'], ['Shuffle', 'shuffle'], ['FadeIn', 'fadeIn'],
  ['FadeOut', 'fadeOut'], ['SlideIn', 'slideIn'], ['SlideOut', 'slideOut'],
];

const sel =
  'h-8 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs text-[var(--cy-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]';
const fieldLbl = 'flex flex-col gap-0.5 text-[10px] text-[var(--cy-text-tertiary)]';

export const BgmOutputStep: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patchParams = useVgComposer((s) => s.patchParams);
  const { t } = useTranslation();

  const bgmQ = useQuery({
    queryKey: ['vg.bgm'],
    queryFn: () => videoGeneration.listBgm(),
    staleTime: 5 * 60 * 1000,
  });
  const fontsQ = useQuery({
    queryKey: ['vg.fonts'],
    queryFn: () => videoGeneration.listFonts(),
    staleTime: 5 * 60 * 1000,
  });
  const bgmItems: VgBgmItem[] = bgmQ.data?.items ?? [];
  const fontItems: VgFontItem[] = fontsQ.data?.items ?? [];
  const selectedBgm = bgmItems.find((b) => b.path === params.bgm_file);
  const selectedFont = fontItems.find((f) => f.name === params.font_name);

  return (
    <div className="space-y-4">
      {/* 背景音乐 — 一行 */}
      <section>
        <h3 className="mb-1.5 text-sm font-semibold text-[var(--cy-text-primary)]">背景音乐</h3>
        <div className="flex flex-wrap items-center gap-2">
          {(['none', 'random', 'file'] as const).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => patchParams({ bgm_type: t })}
              className={
                'rounded-full border px-3 py-1 text-xs transition-colors ' +
                (params.bgm_type === t
                  ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                  : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')
              }
            >
              {t === 'none' ? '无' : t === 'random' ? '随机' : '指定'}
            </button>
          ))}
          {params.bgm_type === 'file' && (
            <select
              className={`${sel} w-[14em]`}
              value={params.bgm_file}
              onChange={(e) => patchParams({ bgm_file: e.target.value })}
            >
              <option value="">(选择 BGM)</option>
              {bgmItems.map((b) => (
                <option key={b.path} value={b.path}>{b.name} · {b.source}</option>
              ))}
            </select>
          )}
          {/* 音量 — 图标按钮,点击弹出纵向滑块(放在试听前) */}
          {params.bgm_type !== 'none' && (
            <VolumePopover value={params.bgm_volume} onChange={(v) => patchParams({ bgm_volume: v })} />
          )}
          {params.bgm_type === 'file' && selectedBgm && (
            <audio src={vgBgmFileUrl(selectedBgm.name)} controls className="h-8" />
          )}
        </div>
      </section>

      {/* 字幕样式 — 紧凑窄控件一行 */}
      <section>
        <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-[var(--cy-text-primary)]">
          字幕样式
          <label className="flex items-center gap-1 text-xs font-normal text-[var(--cy-text-secondary)]">
            <input
              type="checkbox"
              checked={params.subtitle_enabled}
              onChange={(e) => patchParams({ subtitle_enabled: e.target.checked })}
            />
            启用
          </label>
        </h3>
        {params.subtitle_enabled && (
          <div className="flex flex-wrap items-end gap-2">
            <label className={fieldLbl}>位置
              <select
                className={`${sel} w-[5em]`}
                value={params.subtitle_position}
                onChange={(e) => patchParams({ subtitle_position: e.target.value as 'top' | 'bottom' | 'center' | 'custom' })}
              >
                <option value="top">顶部</option>
                <option value="center">居中</option>
                <option value="bottom">底部</option>
                <option value="custom">自定义</option>
              </select>
            </label>
            <label className={fieldLbl}>字体
              <select
                className={`${sel} w-[11em]`}
                value={params.font_name}
                onChange={(e) => patchParams({ font_name: e.target.value })}
                style={{ fontFamily: selectedFont?.family || undefined }}
                title={selectedFont?.label || params.font_name}
              >
                {fontItems.length === 0 && <option value={params.font_name}>{params.font_name}</option>}
                {fontItems.map((f) => (
                  <option key={f.name} value={f.name} style={{ fontFamily: f.family || undefined }}>
                    {f.label || f.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={fieldLbl}>字号
              <input
                type="number" min={20} max={200}
                value={params.font_size}
                onChange={(e) => patchParams({ font_size: parseInt(e.target.value, 10) || 60 })}
                className={`${sel} w-[4.5em]`}
              />
            </label>
            <label className={fieldLbl}>前景
              <input type="color" value={params.text_fore_color}
                onChange={(e) => patchParams({ text_fore_color: e.target.value })}
                className="h-8 w-9 rounded border border-[var(--cy-border-subtle)]" />
            </label>
            <label className={fieldLbl}>描边
              <input type="color" value={params.stroke_color}
                onChange={(e) => patchParams({ stroke_color: e.target.value })}
                className="h-8 w-9 rounded border border-[var(--cy-border-subtle)]" />
            </label>
            <label className={fieldLbl}>描边宽
              <input type="number" min={0} max={10} step={0.5}
                value={params.stroke_width}
                onChange={(e) => patchParams({ stroke_width: parseFloat(e.target.value) || 1.5 })}
                className={`${sel} w-[4.5em]`} />
            </label>
            <label className={fieldLbl}>背景
              <select
                className={`${sel} w-[5.5em]`}
                value={typeof params.text_background_color === 'string' ? 'custom' : params.text_background_color ? 'on' : 'off'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'on') patchParams({ text_background_color: true });
                  else if (v === 'off') patchParams({ text_background_color: false });
                }}
              >
                <option value="on">黑底</option>
                <option value="off">无</option>
              </select>
            </label>
          </div>
        )}
      </section>

      {/* 渲染参数 — 一行 */}
      <section>
        <h3 className="mb-1.5 text-sm font-semibold text-[var(--cy-text-primary)]">渲染参数</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className={fieldLbl}>视频数量
            <input type="number" min={1} max={5}
              value={params.video_count}
              onChange={(e) => patchParams({ video_count: parseInt(e.target.value, 10) || 1 })}
              className={`${sel} w-[4.5em]`} />
          </label>
          <label className={fieldLbl}>单段最长(s)
            <input type="number" min={1} max={60}
              value={params.video_clip_duration}
              onChange={(e) => patchParams({ video_clip_duration: parseInt(e.target.value, 10) || 5 })}
              className={`${sel} w-[5em]`} />
          </label>
          <label className={fieldLbl}>拼接
            <select
              className={`${sel} w-[5.5em]`}
              value={params.video_concat_mode}
              onChange={(e) => patchParams({ video_concat_mode: e.target.value as 'random' | 'sequential' })}
            >
              <option value="random">随机</option>
              <option value="sequential">顺序</option>
            </select>
          </label>
          <label className={fieldLbl}>转场
            <select
              className={`${sel} w-[6.5em]`}
              value={params.video_transition_mode}
              onChange={(e) => patchParams({ video_transition_mode: e.target.value as '' | 'Shuffle' | 'FadeIn' | 'FadeOut' | 'SlideIn' | 'SlideOut' })}
            >
              {TRANSITIONS.map(([v, k]) => (
                <option key={k} value={v}>{t(`videoGen.transition.${k}`)}</option>
              ))}
            </select>
          </label>
        </div>
      </section>
    </div>
  );
};
