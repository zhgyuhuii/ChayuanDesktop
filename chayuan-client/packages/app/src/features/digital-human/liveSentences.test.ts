import { describe, it, expect } from 'vitest';
import { splitSentences, takeCompleteSentences } from './liveSentences';

describe('liveSentences', () => {
  it('splitSentences 按句末标点切,保留标点;尾部未完句单独一段', () => {
    expect(splitSentences('你好。今天天气不错!走')).toEqual(['你好。', '今天天气不错!', '走']);
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('整句结束。')).toEqual(['整句结束。']);
  });

  it('takeCompleteSentences 只吐"已完成"句(以标点结尾),返回新 consumed 偏移', () => {
    const r1 = takeCompleteSentences('你好。今天', 0);
    expect(r1.sentences).toEqual(['你好。']);
    expect(r1.consumed).toBe(3);
    const r2 = takeCompleteSentences('你好。今天好热!', r1.consumed);
    expect(r2.sentences).toEqual(['今天好热!']);
    expect(r2.consumed).toBe('你好。今天好热!'.length);
    const r3 = takeCompleteSentences('你好。今天好热!还', r2.consumed);
    expect(r3.sentences).toEqual([]);
    expect(r3.consumed).toBe(r2.consumed);
  });

  it('换行也算句界;空白句忽略', () => {
    const r = takeCompleteSentences('第一行\n第二句。', 0);
    expect(r.sentences).toEqual(['第一行\n', '第二句。']);
  });
});
