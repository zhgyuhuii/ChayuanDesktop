/**
 * 业务封装层：把 chayuan-server 的端点包成强类型函数。
 *
 * 这层会被 `pnpm gen:api` 生成的 generated/types.ts 替代/增强；
 * 在那之前先手写一份与后端契约对齐（依据 chayuan-server/api_server/*.py 的实际签名）。
 *
 * 设计：每个端点都返回干净的 data 对象（http.* 已拆壳），错误统一为 BizError。
 */

import { http, request } from './client';
import { setTokens, clearTokens } from './auth-store';

// ──────────────────────────────────────────────────────────────
// Auth
// ──────────────────────────────────────────────────────────────

export interface UserInfo {
  id: number;
  username: string;
  email?: string | null;
  role: string;
  active?: boolean;
  create_time?: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: UserInfo;
}

export interface AuthConfig {
  auth_required: boolean;
  auth_allow_registration: boolean;
}

export const auth = {
  async config(): Promise<AuthConfig> {
    // 公开端点,不需要 token;失败软降级:当作非强制登录,游客模式可用
    try {
      const r = await request<AuthConfig>('/auth/config', { raw: true });
      return r.data ?? { auth_required: false, auth_allow_registration: true };
    } catch {
      return { auth_required: false, auth_allow_registration: true };
    }
  },

  async login(username: string, password: string): Promise<TokenPair> {
    // /auth/login 直接返回对象，没有 envelope
    const data = await request<TokenPair>('/auth/login', {
      method: 'POST',
      body: { username, password },
      raw: true,
    });
    await setTokens(data.data.access_token, data.data.refresh_token);
    return data.data;
  },

  async logout(): Promise<void> {
    try {
      await http.post('/auth/logout');
    } finally {
      await clearTokens();
    }
  },

  async me(): Promise<UserInfo> {
    return (await request<UserInfo>('/auth/me', { raw: true })).data;
  },

  async meSummary(): Promise<UserInfo & { conv_count?: number; kb_count?: number }> {
    return (await request<UserInfo & { conv_count?: number; kb_count?: number }>('/auth/me/summary', { raw: true })).data;
  },

  async register(body: { username: string; password: string; email?: string }): Promise<UserInfo> {
    return (await request<UserInfo>('/auth/register', { method: 'POST', body, raw: true })).data;
  },

  async changePassword(userId: number, body: { new_password: string; old_password?: string }): Promise<void> {
    await http.patch<void>(`/auth/users/${userId}/password`, body);
  },
};

// ──────────────────────────────────────────────────────────────
// Models
// ──────────────────────────────────────────────────────────────

export interface RawModelItem {
  id: string;
  object: string;
  owned_by?: string;
  platform_name?: string;
  /**
   * 82 题:厂商友好显示名(中英文,如 "深度求索 DeepSeek")。
   * 后端从 PROVIDER_CATALOG 的 ProviderMeta.display_name 查;
   * 老后端不返此字段时,前端 fallback 到 platform_name。
   */
  platform_display_name?: string;
  created?: number;
  /**
   * 后端按 MODEL_PLATFORMS 配置打的分类标签:
   * 'llm' / 'embed' / 'rerank' / 'image2text' / 'text2image' / ...
   * 老版本后端可能不返回此字段,前端按 undefined 视为未知。
   */
  model_type?: string;
  /** check_access=true 时后端返回;false 表示已经探测确认不可用。 */
  available?: boolean;
  /** 不可用原因,用于 tooltip / 辅助说明。 */
  reason?: string;
}

export const models = {
  async list(opts: { checkAccess?: boolean; type?: string } = {}): Promise<RawModelItem[]> {
    const r = await request<{ data: RawModelItem[] }>('/v1/models', {
      raw: true,
      query:
        opts.checkAccess || opts.type
          ? {
              ...(opts.checkAccess ? { check_access: true } : {}),
              ...(opts.type ? { type: opts.type } : {}),
            }
          : undefined,
    });
    return r.data?.data ?? [];
  },

  /** 后端 /img/model_logos/logos-manifest.json：返回 { lower_name: 'png'|'svg'|'jpg' } */
  async logosManifest(): Promise<Record<string, string>> {
    try {
      const r = await request<Record<string, string>>(
        '/img/model_logos/logos-manifest.json',
        { raw: true },
      );
      return r.data ?? {};
    } catch {
      return {};
    }
  },
};

// ──────────────────────────────────────────────────────────────
// Conversations
// ──────────────────────────────────────────────────────────────

export interface ServerConversation {
  id: string;
  name: string;
  chat_type?: string;
  user_id?: number | null;
  create_time?: string | null;
}

export const conversations = {
  list: (limit = 100, offset = 0) =>
    http.get<ServerConversation[]>('/chat/conversations', { query: { limit, offset } }),
  delete: (id: string) => http.del<void>(`/chat/conversations/${encodeURIComponent(id)}`),
  rename: (id: string, name: string) =>
    http.patch<void>(`/chat/conversations/${encodeURIComponent(id)}`, { name }),
};

// ──────────────────────────────────────────────────────────────
// Tools
// ──────────────────────────────────────────────────────────────

export interface ToolInfo {
  name: string;
  title: string;
  description: string;
  args?: unknown;
  config?: Record<string, unknown>;
}

export const tools = {
  async listEnabled(): Promise<ToolInfo[]> {
    const data = await http.get<Record<string, ToolInfo>>('/tools', { query: { enabled: true } });
    return Object.values(data ?? {});
  },
  async listAll(): Promise<ToolInfo[]> {
    const data = await http.get<Record<string, ToolInfo>>('/tools', { query: { enabled: false } });
    return Object.values(data ?? {});
  },
  call: (name: string, toolInput: Record<string, unknown>) =>
    http.post<unknown>('/tools/call', { name, tool_input: toolInput }),
};

// ──────────────────────────────────────────────────────────────
// MCP
// ──────────────────────────────────────────────────────────────

export interface McpConnection {
  id: string;
  server_name: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string | null;
  transport: 'stdio' | 'sse' | string;
  timeout: number;
  enabled: boolean;
  description?: string | null;
  config: Record<string, unknown>;
  create_time: string;
  update_time?: string | null;
}

export interface McpConnectionInput {
  server_name: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  transport?: 'stdio' | 'sse';
  timeout?: number;
  enabled?: boolean;
  description?: string;
  config?: Record<string, unknown>;
}

export const mcp = {
  async list(opts?: { enabled?: boolean; transport?: string; limit?: number }): Promise<McpConnection[]> {
    const r = await request<{ connections: McpConnection[]; total: number }>('/api/v1/mcp_connections/', {
      query: opts,
      raw: true,
    });
    return r.data?.connections ?? [];
  },
  async create(body: McpConnectionInput): Promise<McpConnection> {
    const r = await request<McpConnection>('/api/v1/mcp_connections/', {
      method: 'POST',
      body,
      raw: true,
    });
    return r.data;
  },
  async detail(id: string): Promise<McpConnection> {
    const r = await request<McpConnection>(`/api/v1/mcp_connections/${encodeURIComponent(id)}`, { raw: true });
    return r.data;
  },
  async update(id: string, body: McpConnectionInput): Promise<McpConnection> {
    const r = await request<McpConnection>(`/api/v1/mcp_connections/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body,
      raw: true,
    });
    return r.data;
  },
  async delete(id: string): Promise<void> {
    await request(`/api/v1/mcp_connections/${encodeURIComponent(id)}`, { method: 'DELETE', raw: true });
  },
  async enable(id: string): Promise<void> {
    await request(`/api/v1/mcp_connections/${encodeURIComponent(id)}/enable`, { method: 'POST', raw: true });
  },
  async disable(id: string): Promise<void> {
    await request(`/api/v1/mcp_connections/${encodeURIComponent(id)}/disable`, { method: 'POST', raw: true });
  },
};

// ──────────────────────────────────────────────────────────────
// Files (OpenAI 兼容 /v1/files)
// ──────────────────────────────────────────────────────────────

export interface UploadedFile {
  id: string;
  filename: string;
  bytes: number;
  created_at: number;
  object: 'file';
  purpose: string;
  /** 后端额外字段：相对 URL，前端拼 baseURL 后可直接给 vision */
  url: string;
}

export const files = {
  /**
   * 通用文件上传；返回 url 可直接当 vision image_url 用。
   * purpose: 'vision' | 'assistants'（默认）。
   */
  async upload(file: File, purpose: 'vision' | 'assistants' = 'vision'): Promise<UploadedFile> {
    const form = new FormData();
    form.append('file', file);
    form.append('purpose', purpose);
    return await http.post<UploadedFile>('/v1/files', form);
  },
  remove: (fileId: string) => http.del<{ id: string; deleted: boolean }>(`/v1/files/${encodeURIComponent(fileId)}`),
};

// ──────────────────────────────────────────────────────────────
// Knowledge Base
// ──────────────────────────────────────────────────────────────

export interface KnowledgeBase {
  id: number;
  kb_name: string;
  kb_info?: string | null;
  vs_type?: string | null;
  embed_model?: string | null;
  file_count?: number | null;
  owner_id?: number | null;
  visibility?: 'private' | 'public' | string | null;
  storage_backend?: string | null;
  create_time?: string | null;
}

export interface UploadTempDocsResult {
  id: string;
  failed_files?: Array<Record<string, string>>;
}

export interface KbFile {
  No?: number;
  file_name: string;
  file_ext?: string;
  file_size?: number;
  in_db?: boolean;
  in_folder?: boolean;
  doc_count?: number;
}

export interface KbFileChunk {
  chunk_index: number;
  chunk_id: string;
  text: string;
  metadata: Record<string, unknown>;
}

export interface KbFileChunksResponse {
  knowledge_base_name: string;
  file_name: string;
  chunk_count: number;
  editable: boolean;
  chunks: KbFileChunk[];
}

export const kb = {
  list: () => http.get<KnowledgeBase[]>('/knowledge_base/list_knowledge_bases'),

  /** 文件预览配置 — kkfileview_url 非空时,前端预览统一走 kkFileView 旁车 */
  getPreviewConfig: () =>
    http.get<{ kkfileview_url: string }>('/knowledge_base/preview-config'),

  async uploadTempDocs(files: File[], prevId?: string): Promise<UploadTempDocsResult> {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    if (prevId) form.append('prev_id', prevId);
    return await http.post<UploadTempDocsResult>('/knowledge_base/upload_temp_docs', form);
  },

  /** 创建知识库 */
  create: (body: {
    knowledge_base_name: string;
    vector_store_type?: string;
    kb_info?: string;
    embed_model?: string;
    visibility?: 'private' | 'public';
    storage_backend?: '' | 'local' | 'minio';
  }) => http.post<{ code?: number; msg?: string }>('/knowledge_base/create_knowledge_base', body),

  /** 删除知识库 */
  delete: (knowledge_base_name: string) =>
    http.post<{ code?: number; msg?: string }>('/knowledge_base/delete_knowledge_base', { knowledge_base_name }),

  /** 列文件 */
  listFiles: (knowledge_base_name: string) =>
    http.get<KbFile[]>('/knowledge_base/list_files', { query: { knowledge_base_name } }),

  /** 上传文件到 KB；同时向量化。
   *  支持可选的 onProgress 回调:走 XHR + xhr.upload.onprogress 拿到真实进度。
   *  Tauri / 非主线程环境(无 XHR)自动退化为 0% → 100% 两段事件。
   */
  async uploadDocs(opts: {
    files: File[];
    knowledge_base_name: string;
    override?: boolean;
    to_vector_store?: boolean;
    chunk_size?: number;
    chunk_overlap?: number;
    onProgress?: (ev: { loaded: number; total: number; ratio: number }) => void;
    signal?: AbortSignal;
  }): Promise<{ code?: number; msg?: string; data?: {
    saved_files?: string[];
    failed_saves?: Record<string, string>;
    task_id?: string | null;
    queue?: string;
  } }> {
    const form = new FormData();
    for (const f of opts.files) {
      // webkitRelativePath 在文件夹上传场景非空(浏览器 input[webkitdirectory]
      // / Tauri pickDirectory 都填),作为 multipart filename 透传给后端;
      // 后端 KnowledgeFile 自带 Path(filename).as_posix(),get_file_path 用
      // resolve() 解嵌套 + 拒绝 ../,自然落到 KB/content/<rel>。
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
      const name = rel && rel.length ? rel : f.name;
      form.append('files', f, name);
    }
    form.append('knowledge_base_name', opts.knowledge_base_name);
    form.append('override', String(opts.override ?? false));
    form.append('to_vector_store', String(opts.to_vector_store ?? true));
    if (opts.chunk_size != null) form.append('chunk_size', String(opts.chunk_size));
    if (opts.chunk_overlap != null) form.append('chunk_overlap', String(opts.chunk_overlap));

    if (opts.onProgress || opts.signal) {
      // 走 XHR-based upload 拿真实进度
      const { uploadWithProgress } = await import('./uploadProgress');
      const r = await uploadWithProgress<{ code?: number; msg?: string; data?: {
        saved_files?: string[];
        failed_saves?: Record<string, string>;
        task_id?: string | null;
        queue?: string;
      } }>(
        '/knowledge_base/upload_docs',
        form,
        { onProgress: opts.onProgress, signal: opts.signal },
      );
      return (typeof r.payload === 'object' && r.payload !== null
        ? (r.payload as { code?: number; msg?: string; data?: {
          saved_files?: string[];
          failed_saves?: Record<string, string>;
          task_id?: string | null;
          queue?: string;
        } })
        : { code: r.status, msg: String(r.payload) });
    }
    return await http.post('/knowledge_base/upload_docs', form);
  },

  checkDuplicates: (body: {
    knowledge_base_name?: string;
    scope?: 'accessible' | 'current_kb';
    items: Array<{ file_name: string; file_size: number; sha256: string }>;
  }) => http.post<Array<{
      file_name: string;
      file_size: number;
      sha256: string;
      duplicate_count: number;
      duplicates: Array<{
        kb_name: string;
        file_name: string;
        file_size: number;
        uploader_id?: number | null;
        uploader_name?: string;
        upload_time?: string;
      }>;
    }>>('/knowledge_base/check_duplicates', body),

  /** 删 KB 内文件 */
  deleteDocs: (body: { knowledge_base_name: string; file_names: string[]; delete_content?: boolean }) =>
    http.post<{ code?: number; msg?: string }>('/knowledge_base/delete_docs', body),

  /** 查看文件当前入库切片 */
  listFileChunks: (body: { knowledge_base_name: string; file_name: string }) =>
    http.get<KbFileChunksResponse>('/knowledge_base/file_chunks', { query: body }),

  /** 管理员保存切片并重新向量化该文件 */
  saveFileChunks: (body: {
    knowledge_base_name: string;
    file_name: string;
    chunks: Array<{ chunk_id?: string; text: string; metadata?: Record<string, unknown> }>;
  }) => http.post<{ code?: number; msg?: string; data?: unknown }>('/knowledge_base/admin/file_chunks', body),

  /** 重新生成指定文件的向量数据:删除旧向量后从源文件重新切片入库 */
  reindexDocs: (body: {
    knowledge_base_name: string;
    file_names: string[];
    async_task?: boolean;
  }) => http.post<{ code?: number; msg?: string; data?: { task_id?: string; queue?: string; file_count?: number } }>(
    '/knowledge_base/reindex_docs',
    body,
  ),

  taskStatus: (task_id: string) => http.get<{
    task_id?: string;
    name?: string;
    queue?: string;
    priority?: number;
    idempotency_key?: string;
    state?: string;
    kind?: string;
    kb_name?: string;
    file_count?: number;
    processed?: number;
    ok_count?: number;
    current_file?: string;
    failed_files?: Record<string, string>;
    error?: string;
    elapsed_s?: number;
    payload_summary?: { file_count?: number; kb_name?: string; user_id?: number };
  }>(`/knowledge_base/tasks/${encodeURIComponent(task_id)}`, { raw: true }),

  cancelTask: (task_id: string, reason = 'user_cancelled') =>
    http.post<{ code?: number; msg?: string; data?: { task_id: string } }>(
      `/knowledge_base/tasks/${encodeURIComponent(task_id)}/cancel`,
      { reason },
    ),

  /** 检索调试 */
  searchDocs: (body: {
    query: string;
    knowledge_base_name: string;
    top_k?: number;
    score_threshold?: number;
    file_name?: string;
  }) =>
    http.post<Array<{ page_content?: string; score?: number; metadata?: Record<string, unknown> }>>(
      '/knowledge_base/search_docs',
      body,
      { raw: true },
    ),

  /** 更新 KB 介绍 */
  updateInfo: (body: { knowledge_base_name: string; kb_info: string }) =>
    http.post<{ code?: number; msg?: string }>('/knowledge_base/update_info', body),
};

// ──────────────────────────────────────────────────────────────
// Feedback (写入 Langfuse score 的入口)
// ──────────────────────────────────────────────────────────────

export interface FeedbackBody {
  /** trace_id（与发送时生成的一致），后端按此挂分到 Langfuse */
  trace_id: string;
  message_id?: string;
  conversation_id?: string;
  /** 1 / -1 / [0,1] 评分；后端 v2 不限制范围 */
  score: number;
  /** thumbs/comment/quality_* */
  name?: string;
  comment?: string;
}

/** 走后端 /chat/feedback/v2，由后端用 secret key 写 Langfuse score */
export const feedback = {
  submit: (body: FeedbackBody) => http.post<void>('/chat/feedback/v2', body),
};
