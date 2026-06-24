import { describe, it, expect } from 'vitest';
import { detectSummarizeIntent } from './detectSummarizeIntent';

const files = ['2024年报.pdf', '产品手册.docx', 'readme.md'];

describe('detectSummarizeIntent', () => {
  it('命中:总结关键词 + 唯一文件名(整名)', () => {
    expect(detectSummarizeIntent('帮我总结一下 2024年报.pdf', files)).toEqual({ fileName: '2024年报.pdf' });
  });
  it('命中:去扩展名主名 + 写的是什么', () => {
    expect(detectSummarizeIntent('产品手册 写的是什么', files)).toEqual({ fileName: '产品手册.docx' });
  });
  it('无总结意图 → null', () => {
    expect(detectSummarizeIntent('打开 2024年报.pdf', files)).toBeNull();
  });
  it('有意图但没提到文件 → null(交给普通会话)', () => {
    expect(detectSummarizeIntent('帮我总结一下', files)).toBeNull();
  });
  it('歧义:多个文件都命中 → null', () => {
    expect(detectSummarizeIntent('总结 产品手册 和 readme', files)).toBeNull();
  });
  it('命中:说的是什么', () => {
    expect(detectSummarizeIntent('产品手册 说的是什么', files)).toEqual({ fileName: '产品手册.docx' });
  });
  it('命中:讲的是什么', () => {
    expect(detectSummarizeIntent('2024年报 讲的是什么?', files)).toEqual({ fileName: '2024年报.pdf' });
  });
  it('命中:内容是什么', () => {
    expect(detectSummarizeIntent('readme 内容是什么', files)).toEqual({ fileName: 'readme.md' });
  });
  it('命中:主要讲了啥(口语)', () => {
    expect(detectSummarizeIntent('产品手册主要讲了啥', files)).toEqual({ fileName: '产品手册.docx' });
  });

  it('空 query → null', () => {
    expect(detectSummarizeIntent('', files)).toBeNull();
  });
});
