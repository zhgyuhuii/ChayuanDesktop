import { describe, expect, it } from 'vitest';
import {
  groupModelsByCapability,
  listPlatformsCapabilities,
  platformHasCapability,
  type PlatformModelArrays,
} from './capabilityGrouping';

/** 只给本模块关心的数组字段,其余按空数组。 */
function P(partial: Partial<PlatformModelArrays>): PlatformModelArrays {
  return {
    llm_models: [],
    embed_models: [],
    rerank_models: [],
    text2image_models: [],
    text2video_models: [],
    image2text_models: [],
    image2image_models: [],
    text2speech_models: [],
    speech2text_models: [],
    disabled_models: [],
    ...partial,
  };
}

describe('groupModelsByCapability', () => {
  it('按字段提示映射到 capability(名字判不出时回退字段)', () => {
    const groups = groupModelsByCapability(
      P({
        llm_models: ['deepseek-chat'],
        image2text_models: ['gpt-4o'], // 名字判不出 → 回退 image2text → 视觉
        text2image_models: ['my-diffusion-xl'], // 中性名 → 回退 text2image → 文生图
        embed_models: ['my-embed-001'],
        rerank_models: ['my-rerank-001'],
        text2speech_models: ['my-tts-001'],
        speech2text_models: ['my-asr-001'],
      }),
    );
    const byCap = Object.fromEntries(groups.map((g) => [g.cap, g.models]));
    expect(byCap.chat).toEqual(['deepseek-chat']);
    expect(byCap.vl).toEqual(['gpt-4o']);
    expect(byCap.t2i).toEqual(['my-diffusion-xl']);
    expect(byCap.embedding).toEqual(['my-embed-001']);
    expect(byCap.rerank).toEqual(['my-rerank-001']);
    expect(byCap.tts).toEqual(['my-tts-001']);
    expect(byCap.asr).toEqual(['my-asr-001']);
  });

  it('text2video 桶按模型名拆分 文生视频 / 图生视频', () => {
    const groups = groupModelsByCapability(
      P({ text2video_models: ['wanx2.1-t2v-turbo', 'foo-i2v-1', 'plain-video'] }),
    );
    const byCap = Object.fromEntries(groups.map((g) => [g.cap, g.models]));
    // 含 i2v 的名字 → 图生视频;其余 → 文生视频
    expect(byCap.i2v).toEqual(['foo-i2v-1']);
    expect(byCap.t2v).toEqual(['wanx2.1-t2v-turbo', 'plain-video']);
  });

  it('image2image → 图像编辑;名字命中 image-edit 也归图像编辑', () => {
    const groups = groupModelsByCapability(
      P({
        image2image_models: ['my-edit-model'],
        text2image_models: ['qwen-image-edit'], // 名字命中 → 图像编辑(不是文生图)
      }),
    );
    const byCap = Object.fromEntries(groups.map((g) => [g.cap, g.models]));
    expect(byCap.image_edit).toContain('my-edit-model');
    expect(byCap.image_edit).toContain('qwen-image-edit');
    expect(byCap.t2i).toBeUndefined();
  });

  it('按 CAP_ORDER 顺序输出(对话在视觉在文生图之前)', () => {
    const groups = groupModelsByCapability(
      P({
        text2image_models: ['my-diffusion-xl'],
        llm_models: ['deepseek-chat'],
        image2text_models: ['gpt-4o'],
      }),
    );
    expect(groups.map((g) => g.cap)).toEqual(['chat', 'vl', 't2i']);
    // 每个 group 带可用于上色的 meta
    expect(groups[0]!.meta.label).toBe('对话');
  });

  it('excludeDisabled 扣除黑名单模型,空桶不出现', () => {
    const groups = groupModelsByCapability(
      P({ llm_models: ['a', 'b'], disabled_models: ['a'] }),
      { excludeDisabled: true },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.models).toEqual(['b']);
  });
});

describe('platformHasCapability', () => {
  it('有该能力(未禁用)模型为 true', () => {
    expect(platformHasCapability(P({ text2image_models: ['x'] }), 't2i')).toBe(true);
    expect(platformHasCapability(P({ text2image_models: ['x'] }), 'tts')).toBe(false);
  });
});

describe('listPlatformsCapabilities', () => {
  it('跨平台聚合 + 去重 + 按 CAP_ORDER 排序', () => {
    const metas = listPlatformsCapabilities([
      P({ text2image_models: ['x'] }),
      P({ llm_models: ['y'] }),
      P({ llm_models: ['z'] }),
    ]);
    expect(metas.map((m) => m.cap)).toEqual(['chat', 't2i']);
  });
});
