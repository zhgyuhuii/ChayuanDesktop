import { describe, it, expect } from 'vitest';
import { parseSrt } from './srtParse';

const SRT = `1
00:00:00,000 --> 00:00:02,500
你好世界

2
00:00:02,500 --> 00:00:05,000
第二句字幕
`;

it('parses cues with ms timing', () => {
  const cues = parseSrt(SRT);
  expect(cues).toHaveLength(2);
  expect(cues[0]).toEqual({ startMs: 0, endMs: 2500, text: '你好世界' });
  expect(cues[1]!.startMs).toBe(2500);
  expect(cues[1]!.endMs).toBe(5000);
});

it('tolerates blank input', () => {
  expect(parseSrt('')).toEqual([]);
  expect(parseSrt('   \n\n')).toEqual([]);
});

it('joins multi-line cue text', () => {
  const cues = parseSrt('1\n00:00:01,000 --> 00:00:02,000\nline A\nline B\n');
  expect(cues[0]!.text).toBe('line A\nline B');
});
