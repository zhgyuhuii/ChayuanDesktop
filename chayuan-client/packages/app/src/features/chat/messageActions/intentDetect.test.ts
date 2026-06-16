import { describe, it, expect } from 'vitest';
import { keywordIntent, parseIntentResult } from './intentDetect';

describe('keywordIntent', () => {
  it('命中各类型', () => {
    expect(keywordIntent('帮我写段开场白并合成语音')).toBe('tts');
    expect(keywordIntent('读一下这段')).toBe('tts');
    expect(keywordIntent('生成一张猫的图')).toBe('t2i');
    expect(keywordIntent('生成玻璃杯宣传图')).toBe('t2i');
    expect(keywordIntent('做个短视频')).toBe('t2v');
    expect(keywordIntent('生成玻璃杯宣传视频')).toBe('t2v');
    expect(keywordIntent('让这张图动起来')).toBe('i2v');
    expect(keywordIntent('帮我改图换个背景')).toBe('image_edit');
    expect(keywordIntent('普通问题没有媒体')).toBe(null);
  });
});

describe('parseIntentResult', () => {
  it('解析 JSON', () => {
    expect(parseIntentResult('{"type":"tts","prompt":"你好"}')).toEqual({ type: 'tts', prompt: '你好' });
  });
  it('容忍 ```json 包裹', () => {
    expect(parseIntentResult('```json\n{"type":"none"}\n```')).toEqual({ type: 'none', prompt: '' });
  });
  it('非法输出回退 none', () => {
    expect(parseIntentResult('garbage')).toEqual({ type: 'none', prompt: '' });
  });
  it('未知 type 归 none', () => {
    expect(parseIntentResult('{"type":"music"}')).toEqual({ type: 'none', prompt: '' });
  });
});
