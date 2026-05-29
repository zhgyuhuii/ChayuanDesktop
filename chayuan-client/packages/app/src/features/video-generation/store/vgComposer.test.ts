import { describe, it, expect } from 'vitest';
import { scriptHashOf } from './vgComposer';
import { VG_DEFAULT_PARAMS } from '@chayuan/api';

it('scriptHashOf changes when video_subject changes (ai 模式靠主题)', () => {
  const a = scriptHashOf({ ...VG_DEFAULT_PARAMS, video_subject: '猫' });
  const b = scriptHashOf({ ...VG_DEFAULT_PARAMS, video_subject: '狗' });
  expect(a).not.toBe(b);
});

it('scriptHashOf stable when irrelevant field changes (画幅)', () => {
  const a = scriptHashOf({ ...VG_DEFAULT_PARAMS, video_subject: '猫', video_aspect: '9:16' });
  const b = scriptHashOf({ ...VG_DEFAULT_PARAMS, video_subject: '猫', video_aspect: '1:1' });
  expect(a).toBe(b);
});
