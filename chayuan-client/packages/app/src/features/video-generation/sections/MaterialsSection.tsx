/**
 * Materials section — 包 MaterialsStep + OnlineSourceChips。
 *
 * 在线源映射:pexels/pixabay 映到 video_source enum;
 * unsplash/youtube/vimeo/ytdlp 暂记在前端,后端 source connector 支持后再 patch。
 */
import * as React from 'react';
import { MaterialsStep } from '../steps/MaterialsStep';
import { OnlineSourceChips } from './OnlineSourceChips';
import { useVgComposer } from '../store/vgComposer';

export const MaterialsSection: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">素材</h3>
      <div className="mb-3">
        <p className="mb-1 text-xs text-[var(--cy-text-tertiary)]">在线源:</p>
        <OnlineSourceChips
          selected={params.video_source}
          onSelect={(name) => {
            if (name === 'pexels' || name === 'pixabay') {
              patch({ video_source: name });
            }
            // ytdlp / unsplash / youtube / vimeo 暂不直接 patch,等后端 source connector 接入
          }}
        />
        <p className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]">
          ⚠ ytdlp 通用 URL 抓取(YouTube/bilibili/抖音/西瓜/头条 等),仅限 CC0/自有素材,版权风险用户自负
        </p>
      </div>
      <MaterialsStep />
    </section>
  );
};
