/**
 * Materials section — 三 tab 素材选择器(我的素材 / 在线搜索 / 从链接 / 上传)。
 *
 * 在线源 API Key 在对话输入框上方「素材设置」配置,这里不再重复;
 * video_source 的 pexels/pixabay 切换由 MaterialsStep 的 tab 副作用驱动。
 */
import * as React from 'react';
import { MaterialsStep } from '../steps/MaterialsStep';

export const MaterialsSection: React.FC = () => (
  <section>
    <h3 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">素材</h3>
    <MaterialsStep />
  </section>
);
