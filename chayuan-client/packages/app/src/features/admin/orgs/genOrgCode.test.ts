import { describe, expect, it } from 'vitest';
import { genOrgCode } from './genOrgCode';

describe('genOrgCode', () => {
  it('中文逐字取拼音首字母', () => {
    expect(genOrgCode('华东研发中心')).toBe('hdyfzx');
  });
  it('英文按单词取词首字母', () => {
    expect(genOrgCode('East Lab')).toBe('el');
  });
  it('中英数字混合', () => {
    expect(genOrgCode('华东A区2')).toBe('hdaq2');
  });
  it('忽略标点与空格', () => {
    expect(genOrgCode(' 华 东 ')).toBe('hd');
  });
  it('与已有编码去重(大小写不敏感),撞则加 -N', () => {
    expect(genOrgCode('华东', ['hd'])).toBe('hd-2');
    expect(genOrgCode('华东', ['HD', 'hd-2'])).toBe('hd-3');
  });
  it('空名称 / 纯标点回退 org', () => {
    expect(genOrgCode('   ')).toBe('org');
    expect(genOrgCode('!!!')).toBe('org');
  });
});
