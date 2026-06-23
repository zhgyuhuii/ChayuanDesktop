/**
 * 厂商卡片「按能力分类」桥接 —— 把 PlatformConfig 的 *_models 数组映射到对话窗口
 * 那套 ModalityCapability(复用 composer/modelCapabilityChip 的 inferCapability /
 * CAP_ORDER / getCapabilityMeta),给 ProviderCard 显示 + MarketplacePage 过滤共用。
 *
 * 为什么不用 marketplace/lib/modelTypes 的 ModelType:它缺图生视频(i2v)、把图像编辑
 * 叫图生图、文生/图生视频不分。对话窗口已有完整 11 类且按模型名前缀推断,需与之一致。
 *
 * 分类策略(后端数组为权威 + 名字细分):每个模型名按其所在字段给一个后端 model_type
 * 提示喂给 inferCapability —— inferCapability 先按模型名前缀判(wanx-i2v→视频、
 * qwen-image-edit→图像编辑),判不出才回退字段提示(gpt-4o 在 image2text → 视觉)。
 * 最后补一次 i2v 兜底:名字含 i2v/image2video 但仅被判成 t2v 的,归到图生视频。
 */
import type { PlatformConfig, RawModelItem } from '@chayuan/api';
import type { ModalityCapability } from '@chayuan/transport';
import {
  CAP_ORDER,
  type CapabilityChipMeta,
  getCapabilityMeta,
  inferCapability,
} from '../../composer/modelCapabilityChip';

/** 只读 PlatformConfig 里与「模型类型」相关的数组字段(其余字段本模块不关心)。 */
export type PlatformModelArrays = Pick<
  PlatformConfig,
  | 'llm_models'
  | 'embed_models'
  | 'rerank_models'
  | 'text2image_models'
  | 'text2video_models'
  | 'image2text_models'
  | 'image2image_models'
  | 'text2speech_models'
  | 'speech2text_models'
  | 'disabled_models'
>;

/** 字段 → 喂给 inferCapability 的后端 model_type 提示(名字判不出时的回退依据)。 */
const FIELD_HINTS: ReadonlyArray<readonly [keyof PlatformModelArrays, string]> = [
  ['llm_models', 'llm'],
  ['image2text_models', 'image2text'],
  ['text2image_models', 'text2image'],
  ['image2image_models', 'image_edit'],
  ['text2video_models', 'text2video'],
  ['text2speech_models', 'text2speech'],
  ['speech2text_models', 'speech2text'],
  ['embed_models', 'embed'],
  ['rerank_models', 'rerank'],
];

/** 单个模型(名 + 字段提示)→ capability。复用 inferCapability,再补 i2v 兜底。 */
function capOf(name: string, hint: string): ModalityCapability {
  const item = { id: name, object: 'model', model_type: hint } as RawModelItem;
  const cap = inferCapability(item);
  if (cap === 't2v' && /i2v|image2video|img2video/i.test(name)) return 'i2v';
  return cap;
}

export interface CapabilityGroup {
  cap: ModalityCapability;
  meta: CapabilityChipMeta;
  models: string[];
}

/** 一个平台按 capability 分组,按 CAP_ORDER 顺序、可扣除 disabled、空桶不返回。 */
export function groupModelsByCapability(
  p: PlatformModelArrays,
  options: { excludeDisabled?: boolean } = {},
): CapabilityGroup[] {
  const blacklist = options.excludeDisabled ? new Set(p.disabled_models ?? []) : null;
  const buckets = new Map<ModalityCapability, string[]>();
  for (const [field, hint] of FIELD_HINTS) {
    const arr = (p[field] as string[] | undefined) ?? [];
    for (const name of arr) {
      if (blacklist?.has(name)) continue;
      const cap = capOf(name, hint);
      const list = buckets.get(cap);
      if (list) {
        if (!list.includes(name)) list.push(name);
      } else {
        buckets.set(cap, [name]);
      }
    }
  }
  const out: CapabilityGroup[] = [];
  for (const cap of CAP_ORDER) {
    const models = buckets.get(cap);
    if (models && models.length > 0) {
      out.push({ cap, meta: getCapabilityMeta(cap), models });
    }
  }
  return out;
}

/** 平台是否提供某能力的(未禁用)模型。 */
export function platformHasCapability(
  p: PlatformModelArrays,
  cap: ModalityCapability,
): boolean {
  return groupModelsByCapability(p, { excludeDisabled: true }).some((g) => g.cap === cap);
}

/** 跨多个平台「实际存在」的能力清单,按 CAP_ORDER 排序(给页面级过滤条用)。 */
export function listPlatformsCapabilities(
  platforms: ReadonlyArray<PlatformModelArrays>,
): CapabilityChipMeta[] {
  const present = new Set<ModalityCapability>();
  for (const p of platforms) {
    for (const g of groupModelsByCapability(p, { excludeDisabled: true })) present.add(g.cap);
  }
  return CAP_ORDER.filter((cap) => present.has(cap)).map((cap) => getCapabilityMeta(cap));
}

/** 「全能力」哨兵 —— 不按能力过滤。 */
export const CAPABILITY_ANY = '__any__' as const;
export type CapabilityFilter = ModalityCapability | typeof CAPABILITY_ANY;
