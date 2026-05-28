/**
 * Smoke test -- VgChatPage 相关核心逻辑不崩。
 *
 * 背景:vitest 配置使用 environment:'node',没有 jsdom / @testing-library/react,
 * 所以无法在单测里渲染 React 组件树。真实 mount 验证留给 R5.1 手动联调。
 *
 * 本 smoke 测试覆盖:
 *   1. vgComposerStore 初始状态健全(VgChatPage 挂载时依赖这个 store)。
 *   2. deriveStopAt 各 step 返回正确 stop_at(onSubmit 路径用到)。
 *   3. useVgComposer store action: patchParams / setScriptSlot / reset 正常工作。
 *
 * 若后续补了 jsdom 环境,可扩展为真实渲染测试。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { deriveStopAt, useVgComposer } from '../store/vgComposer';
import { vgComposerStore } from '../store/vgComposerStore';

// vgComposerStore 是 ComposerStoreContext 注入给 ChatComposer 的 scope store
// VgChatPage 在 ComposerStoreContext.Provider value={vgComposerStore} 里挂载
describe('VgChatPage smoke -- vgComposerStore', () => {
  it('vgComposerStore is defined (ComposerStoreContext injection target)', () => {
    expect(vgComposerStore).toBeDefined();
    // store 暴露 getState / setState / subscribe (Zustand vanilla store interface)
    expect(typeof vgComposerStore.getState).toBe('function');
    expect(typeof vgComposerStore.setState).toBe('function');
    expect(typeof vgComposerStore.subscribe).toBe('function');
  });
});

describe('VgChatPage smoke -- deriveStopAt (onSubmit + auto mode path)', () => {
  it('step 1-2 => script', () => {
    expect(deriveStopAt(1)).toBe('script');
    expect(deriveStopAt(2)).toBe('script');
  });
  it('step 3 => audio', () => {
    expect(deriveStopAt(3)).toBe('audio');
  });
  it('step 4 => subtitle', () => {
    expect(deriveStopAt(4)).toBe('subtitle');
  });
  it('step 5 => materials', () => {
    expect(deriveStopAt(5)).toBe('materials');
  });
  it('step 6-7 => video (full pipeline)', () => {
    expect(deriveStopAt(6)).toBe('video');
    expect(deriveStopAt(7)).toBe('video');
  });
});

describe('VgChatPage smoke -- useVgComposer store actions', () => {
  beforeEach(() => {
    // reset store between tests
    useVgComposer.getState().reset();
  });

  it('initial step is 1', () => {
    expect(useVgComposer.getState().step).toBe(1);
  });

  it('patchParams updates params (used by onSubmit to build submitTask payload)', () => {
    useVgComposer.getState().patchParams({ video_aspect: '9:16' });
    expect(useVgComposer.getState().params.video_aspect).toBe('9:16');
  });

  it('setScriptSlot mirrors to params.video_script when script_source matches', () => {
    // default script_source is 'ai' from VG_DEFAULT_PARAMS
    const initial = useVgComposer.getState().params.script_source;
    useVgComposer.getState().setScriptSlot(initial as 'ai' | 'manual' | 'srt', 'hello script');
    expect(useVgComposer.getState().params.video_script).toBe('hello script');
  });

  it('next/prev step navigation stays in 1-7 range', () => {
    const s = useVgComposer.getState();
    s.next(); s.next(); s.next();
    expect(useVgComposer.getState().step).toBe(4);
    s.prev(); s.prev(); s.prev(); s.prev(); s.prev();
    expect(useVgComposer.getState().step).toBe(1); // clamped at 1
  });

  it('reset brings state back to step 1 + clears scriptSlots', () => {
    useVgComposer.getState().patchParams({ video_subject: 'test subject' });
    useVgComposer.getState().setScriptSlot('manual', 'my script');
    useVgComposer.getState().reset();
    expect(useVgComposer.getState().step).toBe(1);
    expect(useVgComposer.getState().scriptSlots.manual).toBe('');
  });
});
