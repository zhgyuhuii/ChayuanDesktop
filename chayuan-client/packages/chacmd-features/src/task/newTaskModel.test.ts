import { describe, expect, it } from 'vitest';
import { parseNlDraft, validateDraft } from './newTaskModel';

describe('parseNlDraft', () => {
  it('goal 直接取输入，非推断', () => {
    const d = parseNlDraft('实现用户登录功能');
    expect(d.goal).toBe('实现用户登录功能');
    expect(d.inferred.goal).toBe(false);
  });

  it('name/code/workdir 为推断字段且非空', () => {
    const d = parseNlDraft('实现用户登录功能');
    expect(d.name).not.toBe('');
    expect(d.code).not.toBe('');
    expect(d.workdir).toContain(d.code);
    expect(d.inferred.name).toBe(true);
    expect(d.inferred.code).toBe(true);
    expect(d.inferred.workdir).toBe(true);
  });

  it('英文输入 code 生成 slug', () => {
    const d = parseNlDraft('Build Login API');
    expect(d.code).toBe('build-login-api');
    expect(d.workdir).toBe('/workspace/build-login-api');
  });

  it('无可 slug 化字符时回退 task', () => {
    const d = parseNlDraft('实现登录');
    expect(d.code).toBe('task');
  });

  it('空输入也不崩', () => {
    const d = parseNlDraft('');
    expect(d.goal).toBe('');
    expect(d.code).toBe('task');
  });
});

describe('validateDraft', () => {
  it('仅 goal 必填', () => {
    expect(validateDraft(parseNlDraft('做点事')).length).toBe(0);
    const empty = parseNlDraft('');
    const errs = validateDraft(empty);
    expect(errs.some((e) => e.field === 'goal')).toBe(true);
  });
});
