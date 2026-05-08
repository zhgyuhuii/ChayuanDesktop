/**
 * 模型平台 admin API(后端 /api/admin/model_platforms*)。
 *
 * 后端契约:
 *   GET    /admin/model_platforms              → PlatformConfig[]
 *   POST   /admin/model_platforms              → PlatformConfig
 *   PATCH  /admin/model_platforms/{name}       → PlatformConfig
 *   DELETE /admin/model_platforms/{name}       → { code, msg }
 *   POST   /admin/model_platforms/{name}/test  → PlatformTestResult
 *
 * 写后热生效:repository.bump_platform_version() + 5s TTL 缓存按版本号失效;
 * 前端只需 mutation 成功后 invalidate ['marketplace.platforms'] 与 ['marketplace.models']。
 */

import { request } from './client';

export type PlatformType =
  | 'xinference'
  | 'ollama'
  | 'oneapi'
  | 'fastchat'
  | 'openai'
  | 'custom openai'
  | string;

export interface PlatformConfig {
  platform_name: string;
  platform_type: PlatformType;
  api_base_url: string;
  api_key: string;
  api_proxy: string;
  api_concurrencies: number;
  enabled: boolean;
  auto_detect_model: boolean;
  llm_models: string[];
  embed_models: string[];
  text2image_models: string[];
  image2text_models: string[];
  image2image_models: string[];
  rerank_models: string[];
  speech2text_models: string[];
  text2speech_models: string[];
  disabled_models: string[];
  description?: string;
  extra?: Record<string, unknown>;
  create_time?: string | null;
  update_time?: string | null;
  /**
   * 内置模型 baseline:key = PlatformConfig 字段名(llm_models / embed_models / ...)、
   * value = 该字段下 catalog 内置主流模型 id 列表。后端 ``get_all_platforms_with_state``
   * 从 ``PROVIDER_CATALOG.default_models`` 注入,用户自定义新增的 id **不在**此处。
   * 前端 UI 据此判断:在 ModelLineEditor 里隐藏 builtin id 行的"X 删除"按钮,
   * 防止误删 catalog 自带模型。空 dict / 缺字段 = 该厂商无 baseline 数据。
   */
  builtin_models?: Partial<Record<string, string[]>>;
}

/** 创建/更新时可省略未变字段;name 在 path 上,body 不再带 */
export type PlatformPatch = Partial<Omit<PlatformConfig, 'platform_name' | 'create_time' | 'update_time'>>;
export type PlatformCreate = Pick<PlatformConfig, 'platform_name'> & PlatformPatch;

/** 连通性测试结果(后端拼装) */
export interface PlatformTestResult {
  platform_name: string;
  platform_type: PlatformType;
  api_base_url: string;
  reachable: boolean;
  /** 探测到的可用模型清单,key 是 ModelKind 字段名(llm_models / embed_models / ...) */
  detected: Partial<Record<keyof PlatformConfig, string[]>> & Record<string, string[]>;
  error: string | null;
}

/** 标签:由后端 PROVIDER_CATALOG 给出 */
export type ProviderTag = '推荐' | '国内' | '国外' | '本地' | '聚合' | '自定义' | string;

/**
 * 厂商目录条目(/admin/model_platforms/catalog 返回)。
 * 把 PROVIDER_CATALOG 的元信息(默认 base / logo / 颜色 / 标签)与 DB 当前配置态(已配置/启用/已选模型)合并,
 * 前端按 tags 做类别 tabs 筛选;configured/enabled 决定卡片是否 dimmed。
 */
export interface ProviderCatalogEntry {
  pid: string;
  display_name: string;
  platform_type: PlatformType;
  default_api_base: string;
  /** 后端静态目录文件名,例如 "deepseek.png";前端拼到 baseURL+/static/model_logos/ 之前 */
  logo: string;
  color: string;
  tags: ProviderTag[];
  icon: string;
  configured: boolean;
  enabled: boolean;
  api_base_url: string;
  api_concurrencies: number;
  auto_detect_model: boolean;
  llm_models: string[];
  embed_models: string[];
  text2image_models: string[];
  image2text_models: string[];
  rerank_models: string[];
  speech2text_models: string[];
  text2speech_models: string[];
  disabled_models: string[];
  description: string;
  /** "申请 API Key" 跳转链接;空 = 不展示该按钮 */
  apply_key_url?: string;
  /** 本地推理服务的安装指南链接;优先级高于 apply_key_url(只对 tags 含 "本地" 时用) */
  install_guide_url?: string;
  /** 厂商官网首页(可选,卡片底部"了解更多") */
  website_url?: string;
  /**
   * catalog 内置的"该厂商主流模型"清单(2026-04 校验快照)。
   * - 未配置时,*_models 字段会自动用 default_models 填充供 UI 显示;
   * - 已配置且 DB 选过模型时,*_models 直接用 DB 值;
   * - 字段名严格对齐 PlatformConfig:llm_models / embed_models / ... / text2speech_models
   */
  default_models?: Partial<{
    llm_models: string[];
    embed_models: string[];
    rerank_models: string[];
    text2image_models: string[];
    image2text_models: string[];
    speech2text_models: string[];
    text2speech_models: string[];
  }>;
  /** 该厂商已写入 model_metadata 的所有模型元信息;key = model_id */
  model_metadata?: Record<string, ModelMetadata>;
  /** DB 里有但 catalog 没有 → 用户自定义的厂商 */
  _custom?: boolean;
}

/**
 * LLM 自动补全的模型元数据(也可手动维护)。
 * 对应后端 ``model_metadata`` 表 + ``ModelMetadataModel.to_dict()``。
 */
export interface ModelMetadata {
  platform_name: string;
  model_id: string;
  description: string;
  release_date: string;
  context_length: number | null;
  performance_note: string;
  source: string;
  source_model: string;
  update_time?: string | null;
}

export interface EnrichResult {
  updated: string[];
  skipped: string[];
  llm_used: string;
}

const BASE = '/admin/model_platforms';

export const modelPlatform = {
  /** 列出全部平台(含禁用) */
  async list(): Promise<PlatformConfig[]> {
    const r = await request<{ data: PlatformConfig[] }>(BASE, { raw: true });
    return r.data?.data ?? [];
  },

  /** 全量厂商目录(catalog),合并 PROVIDER_CATALOG 元数据 + DB 配置态 */
  async catalog(): Promise<ProviderCatalogEntry[]> {
    const r = await request<{ data: ProviderCatalogEntry[] }>(`${BASE}/catalog`, { raw: true });
    return r.data?.data ?? [];
  },

  /** 新建一个平台;后端会自动 bump_platform_version() */
  async create(payload: PlatformCreate): Promise<PlatformConfig> {
    const r = await request<{ data: PlatformConfig }>(BASE, {
      method: 'POST',
      body: payload,
      raw: true,
    });
    if (!r.data?.data) throw new Error('create 返回为空');
    return r.data.data;
  },

  /** 更新部分字段;name 在 path */
  async update(name: string, patch: PlatformPatch): Promise<PlatformConfig> {
    const r = await request<{ data: PlatformConfig }>(`${BASE}/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: patch,
      raw: true,
    });
    if (!r.data?.data) throw new Error('update 返回为空');
    return r.data.data;
  },

  /** 删除一行 DB(yaml seed 仍能兜底) */
  async delete(name: string): Promise<boolean> {
    const r = await request<{ code: number }>(`${BASE}/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      raw: true,
    });
    return r.data?.code === 0;
  },

  /** 连通性测试 + 自动探测可用模型;不修改任何配置 */
  async test(name: string): Promise<PlatformTestResult> {
    const r = await request<{ data: PlatformTestResult }>(
      `${BASE}/${encodeURIComponent(name)}/test`,
      { method: 'POST', raw: true },
    );
    if (!r.data?.data) throw new Error('test 返回为空');
    return r.data.data;
  },

  /** 用 LLM 给指定模型 id 生成简介 / 发布日期 / 上下文 / 性能短评,落 model_metadata。
   *  models 不传 = 默认拉该平台 *_models 全集再去重。 */
  async enrich(name: string, models?: string[]): Promise<EnrichResult> {
    const r = await request<{ data: EnrichResult }>(
      `${BASE}/${encodeURIComponent(name)}/enrich`,
      {
        method: 'POST',
        body: { models: models ?? null },
        raw: true,
      },
    );
    if (!r.data?.data) throw new Error('enrich 返回为空');
    return r.data.data;
  },

  /** 列出指定厂商已写入 model_metadata 的全部模型元信息 */
  async metadata(name: string): Promise<ModelMetadata[]> {
    const r = await request<{ data: ModelMetadata[] }>(
      `${BASE}/${encodeURIComponent(name)}/metadata`,
      { raw: true },
    );
    return r.data?.data ?? [];
  },
};
