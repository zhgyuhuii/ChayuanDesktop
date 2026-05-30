import * as React from 'react';
import type { DigitalHumanPreset } from '@chayuan/transport';
export const PresetList: React.FC<{ presets: DigitalHumanPreset[]; onChanged: () => void }> = () =>
  <div className="text-sm text-[var(--cy-text-tertiary)]">预设列表(占位)</div>;
