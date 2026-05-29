import { describe, it, expect } from 'vitest';
import { editCueTime, editCueText, cuesToSrt } from './subtitleEdit';
import type { SrtCue } from './srtParse';

const base: SrtCue[] = [
  { startMs: 0, endMs: 2000, text: 'a' },
  { startMs: 2000, endMs: 4000, text: 'b' },
];

it('editCueTime clamps end >= start + 200, start >= 0', () => {
  expect(editCueTime(base, 0, -500, 1500)[0]).toEqual({ startMs: 0, endMs: 1500, text: 'a' });
  expect(editCueTime(base, 1, 3000, 3000)[1]).toEqual({ startMs: 3000, endMs: 3200, text: 'b' });
});

it('editCueText replaces text, keeps timing', () => {
  const r = editCueText(base, 1, '改了');
  expect(r[1]).toEqual({ startMs: 2000, endMs: 4000, text: '改了' });
  expect(r[0]).toEqual(base[0]);
});

it('cuesToSrt formats with index + comma ms', () => {
  const srt = cuesToSrt([{ startMs: 0, endMs: 2500, text: 'hi' }]);
  expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,500\nhi');
});

import { rebuildCuesFromLines } from './subtitleEdit';

it('rebuildCuesFromLines: same count keeps timing, swaps text', () => {
  const r = rebuildCuesFromLines(base, ['x', 'y'], 4000);
  expect(r).toEqual([
    { startMs: 0, endMs: 2000, text: 'x' },
    { startMs: 2000, endMs: 4000, text: 'y' },
  ]);
});

it('rebuildCuesFromLines: diff count distributes evenly over totalMs', () => {
  const r = rebuildCuesFromLines(base, ['a', 'b', 'c'], 9000);
  expect(r).toHaveLength(3);
  expect(r[0]).toEqual({ startMs: 0, endMs: 3000, text: 'a' });
  expect(r[2]).toEqual({ startMs: 6000, endMs: 9000, text: 'c' });
});

it('rebuildCuesFromLines: ignores blank lines', () => {
  expect(rebuildCuesFromLines(base, ['a', '', '  ', 'b'], 4000)).toHaveLength(2);
});
