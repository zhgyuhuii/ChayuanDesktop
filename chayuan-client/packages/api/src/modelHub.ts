/**
 * 模型广场(Model Hub)客户端 — 在线浏览 ModelScope / HuggingFace 上的模型,
 * 看详情(文件清单)、卸载已装模型。
 *
 * 后端契约(字段名与服务端 snake_case 对齐):
 *   GET  /v1/model-hub/search   (query: source,query,capability,runnable_only,page,page_size,route,token)
 *        → HubSearchPage { items: HubModelCard[], page, page_size, has_more, total }
 *   GET  /v1/model-hub/detail   (query: source,model_id,revision,route,token)
 *        → HubFile[]
 *   POST /admin/models/uninstall  (body { source, repo_id, force? })
 *        → { ok, reason?, capability?, freed_bytes? }
 *
 * 这几个端点都不走 {code,msg,data} envelope(直接返回 dict / list),所以
 * 跟 serverModelsBootstrap 一样:request<T>(url) 后整 payload 落在 r.data 上,
 * 不用 raw + 拆壳。
 *
 * 注意:**安装(下载)不在此模块重写** —— 复用 modelPlatform.ts 的
 * serverModelsInstallModel.start/get/cancel(单一真源)。
 */

import { request } from './client';

/** 归一化模型卡片;字段与后端 NormalizedModelCard 一致。 */
export interface HubModelCard {
  source: string;
  model_id: string;
  display_name: string;
  owner: string;
  capability: string;
  param_size: string | null;
  file_size_bytes: number | null;
  format: string | null;
  runnable: boolean;
  serveable: boolean;
  downloads: number | null;
  likes: number | null;
  updated_at: string | null;
  tags: string[];
  /** 该 repo 是否已装到本地(后端比对 local_index)。 */
  installed: boolean;
  /** 是否为内置(bundled)模型 —— 不可卸载。仅已安装 tab 据 source_tag 填充。 */
  bundled?: boolean;
}

/** 仓库内单个文件;字段与后端 HubFile 一致。 */
export interface HubFile {
  rfilename: string;
  size_bytes: number | null;
  /** 该文件单独能否被本地 runtime 直接加载(如 *.gguf)。 */
  runnable: boolean;
}

/** 分页搜索结果;字段与后端 SearchPage 一致。 */
export interface HubSearchPage {
  items: HubModelCard[];
  page: number;
  page_size: number;
  has_more: boolean;
  total: number | null;
}

export interface UninstallResult {
  ok: boolean;
  reason?: string;
  capability?: string;
  freed_bytes?: number;
}

const HUB_SEARCH = '/v1/model-hub/search';
const HUB_DETAIL = '/v1/model-hub/detail';
const MODELS_UNINSTALL = '/admin/models/uninstall';

export const modelHub = {
  /**
   * 在线搜索模型(分页)。
   *
   * @param params.runnableOnly 只返回本地 runtime 能直接跑的(映射后端 runnable_only)。
   * @param params.route        可选检索路由提示。
   * @param params.token        可选源端 access token(私有仓 / 限流)。
   */
  async search(params: {
    source: string;
    query?: string;
    capability?: string;
    runnableOnly?: boolean;
    page: number;
    pageSize?: number;
    route?: string;
    token?: string;
  }): Promise<HubSearchPage> {
    const r = await request<HubSearchPage>(HUB_SEARCH, {
      query: {
        source: params.source,
        query: params.query,
        capability: params.capability,
        runnable_only: params.runnableOnly,
        page: params.page,
        page_size: params.pageSize,
        route: params.route,
        token: params.token,
      },
    });
    return (
      r.data ?? { items: [], page: params.page, page_size: params.pageSize ?? 0, has_more: false, total: null }
    );
  },

  /** 拉取指定仓库的文件清单(用户挑 quant 文件用)。 */
  async detail(params: {
    source: string;
    modelId: string;
    revision?: string;
    route?: string;
    token?: string;
  }): Promise<HubFile[]> {
    const r = await request<HubFile[]>(HUB_DETAIL, {
      query: {
        source: params.source,
        model_id: params.modelId,
        revision: params.revision,
        route: params.route,
        token: params.token,
      },
    });
    return r.data ?? [];
  },

  /**
   * 卸载已装模型(删除本地落地目录)。
   * @param body.force 即使该 repo 被某 capability default 引用也强删。
   */
  async uninstall(body: {
    source: string;
    repoId: string;
    force?: boolean;
  }): Promise<UninstallResult> {
    const r = await request<UninstallResult>(MODELS_UNINSTALL, {
      method: 'POST',
      body: {
        source: body.source,
        repo_id: body.repoId,
        force: body.force,
      },
    });
    return r.data ?? { ok: false };
  },
};
