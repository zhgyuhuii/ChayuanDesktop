import { describe, it, expect } from 'vitest';
import { classifyModalityCapability } from '../modality-stream';

describe('classifyModalityCapability — 本地引擎伪模型', () => {
  it('local-tts:<engine> 归为 tts(使语音合成参数条显示 + modality 路由按本地连接器分流)', () => {
    expect(classifyModalityCapability('local-tts:piper')).toBe('tts');
    expect(classifyModalityCapability('local-tts:edge')).toBe('tts');
    expect(classifyModalityCapability('local-tts:sherpa')).toBe('tts');
    expect(classifyModalityCapability('local-tts:clone')).toBe('tts');
  });
  it('大小写不敏感', () => {
    expect(classifyModalityCapability('LOCAL-TTS:Piper')).toBe('tts');
  });
  it('普通模型仍判 chat(厂商 tts 模型由后端 model_type 分桶,不靠前端前缀)', () => {
    expect(classifyModalityCapability('deepseek-chat')).toBe('chat');
  });
});
