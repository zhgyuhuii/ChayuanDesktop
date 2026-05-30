import * as React from 'react';
import type { DigitalHumanPreset } from '@chayuan/transport';
export const GeneratePanel: React.FC<{ presets: DigitalHumanPreset[] }> = () =>
  <div className="text-sm text-[var(--cy-text-tertiary)]">生成(占位)</div>;
