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

// 改音色/语速/音量/BGM 不应让草稿失效指纹变化 —— 否则编辑页会因每次调音色就自动
// 重发草稿生成任务,造成任务堆积、卡顿。音色变化由「合成语音」按钮显式触发,
// 最终合成时也会按当前音色重渲染。
it('scriptHashOf stable when voice/bgm changes (避免一动音色就自动重生成)', () => {
  const base = { ...VG_DEFAULT_PARAMS, video_subject: '猫' };
  const a = scriptHashOf(base);
  expect(scriptHashOf({ ...base, voice_name: 'zh-CN-XiaoxiaoNeural' })).toBe(a);
  expect(scriptHashOf({ ...base, voice_rate: 1.5 })).toBe(a);
  expect(scriptHashOf({ ...base, voice_volume: 1.2 })).toBe(a);
  expect(scriptHashOf({ ...base, voice_provider: 'edge' })).toBe(a);
  expect(scriptHashOf({ ...base, bgm_type: 'random' })).toBe(a);
  expect(scriptHashOf({ ...base, bgm_file: 'x.mp3' })).toBe(a);
});
