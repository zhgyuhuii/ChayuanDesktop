import { describe, it, expect } from 'vitest';
import { inferCapability } from './modelCapabilityChip';

/**
 * 图像编辑(image_edit)能力点亮回归:
 *   - 后端 /v1/models 给图像编辑模型打的 model_type 是 "image2image"
 *     (= 配置字段 image2image_models 的短名),前端必须据此分到 image_edit 桶,
 *     否则首页「图像编辑」能力卡点不亮、误归 chat。
 *   - 名字能识别的(qwen-image-edit)走名字优先路径也应判 image_edit。
 */
describe('inferCapability — 图像编辑', () => {
  it('model_type=image2image 的泛型名模型 → image_edit', () => {
    expect(
      inferCapability({ id: 'some-img2img-v3', object: 'model', model_type: 'image2image' }),
    ).toBe('image_edit');
  });

  it('保留旧 image_edit model_type 取值', () => {
    expect(
      inferCapability({ id: 'whatever', object: 'model', model_type: 'image_edit' }),
    ).toBe('image_edit');
  });

  it('名字优先:qwen-image-edit 即使 model_type=image2image 也判 image_edit', () => {
    expect(
      inferCapability({ id: 'qwen-image-edit', object: 'model', model_type: 'image2image' }),
    ).toBe('image_edit');
  });

  it('text2image 仍判 t2i,不被误吞', () => {
    expect(
      inferCapability({ id: 'sd-xl-base', object: 'model', model_type: 'text2image' }),
    ).toBe('t2i');
  });
});
