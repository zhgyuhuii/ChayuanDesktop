/**
 * 外部 agent 集成 API（与 chayuan-server `/api/v1/external-agents/{system_id}/...` 对齐）。
 *
 * 覆盖 OpenClaw / Hermes 共用的生命周期、配置、技能（skill）与 SSE 流：
 *   - 生命周期：status / start / stop / restart / uninstall
 *   - 配置：config(GET) / config(PUT)
 *   - 技能：skills / skills/search / skills/{id}/uninstall / skills/{id}/translate
 *   - SSE：install / skills/{id}/install / logs/stream
 *
 * SSE 在 web/desktop 平台行为有差异，参照 runtime.ts 的 `subscribeEvents`：
 * 用原生 EventSource 包一层，返回 unsubscribe()。
 */

import { request, getClientConfig } from './client';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface AgentStatus {
  installed: boolean;
  running: boolean;
  version?: string;
  uptime_seconds?: number;
  pid?: number;
  /** 健康态：后端字符串（如 'ok' / 'unhealthy' / 'unknown'） */
  health: string;
  /** 人类可读的状态描述 */
  detail: string;
}

export interface AgentConfigBundle {
  /** 原始配置文本（yaml/json/toml 等） */
  raw: string;
  /** 「灵魂 / 人设」字段（可选；部分 agent 单独抽出） */
  soul?: string;
  /** 配置格式，如 'yaml' / 'json' / 'toml' */
  format: string;
}

export interface Skill {
  id: string;
  name: string;
  version: string;
  description: string;
  permissions: string[];
  installed: boolean;
  publisher: string;
  verified: boolean;
  readme: string;
}

export interface SetConfigInput {
  raw: string;
  soul?: string;
  format?: string;
}

export interface TranslateInput {
  skillId: string;
  field: string;
  version: string;
  text: string;
  lang?: string;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function base(systemId: string): string {
  return `/external-agents/${encodeURIComponent(systemId)}`;
}

/** 构造 SSE URL（拼 baseURL + path），与 runtime.ts 一致。 */
function sseUrl(path: string): string {
  const cfg = getClientConfig();
  return `${cfg.baseURL.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
}

function openEventSource(
  path: string,
  bind: (es: EventSource) => void,
  onError?: (err: unknown) => void,
): () => void {
  const cfg = getClientConfig();
  let es: EventSource | null = null;
  try {
    es = new EventSource(sseUrl(path), { withCredentials: cfg.authMode === 'cookie' });
  } catch (e) {
    onError?.(e);
    return () => undefined;
  }
  bind(es);
  es.onerror = (ev) => onError?.(ev);
  return () => {
    try {
      es?.close();
    } catch {
      // noop
    }
  };
}

function parse<T = unknown>(ev: Event): T {
  return JSON.parse((ev as MessageEvent).data) as T;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const externalAgents = {
  async status(systemId: string): Promise<AgentStatus> {
    return (await request<AgentStatus>(`${base(systemId)}/status`)).data;
  },

  async start(systemId: string): Promise<AgentStatus> {
    return (await request<AgentStatus>(`${base(systemId)}/start`, { method: 'POST' })).data;
  },

  async stop(systemId: string): Promise<AgentStatus> {
    return (await request<AgentStatus>(`${base(systemId)}/stop`, { method: 'POST' })).data;
  },

  async restart(systemId: string): Promise<AgentStatus> {
    return (await request<AgentStatus>(`${base(systemId)}/restart`, { method: 'POST' })).data;
  },

  async uninstall(systemId: string): Promise<AgentStatus> {
    return (await request<AgentStatus>(`${base(systemId)}/uninstall`, { method: 'POST' })).data;
  },

  async getConfig(systemId: string): Promise<AgentConfigBundle> {
    return (await request<AgentConfigBundle>(`${base(systemId)}/config`)).data;
  },

  async setConfig(systemId: string, input: SetConfigInput): Promise<AgentConfigBundle> {
    return (
      await request<AgentConfigBundle>(`${base(systemId)}/config`, {
        method: 'PUT',
        body: { raw: input.raw, soul: input.soul, format: input.format },
      })
    ).data;
  },

  async listSkills(systemId: string): Promise<Skill[]> {
    return (await request<Skill[]>(`${base(systemId)}/skills`)).data;
  },

  async searchSkills(systemId: string, q: string): Promise<Skill[]> {
    return (await request<Skill[]>(`${base(systemId)}/skills/search`, { query: { q } })).data;
  },

  async uninstallSkill(systemId: string, skillId: string): Promise<void> {
    await request(`${base(systemId)}/skills/${encodeURIComponent(skillId)}/uninstall`, {
      method: 'POST',
    });
  },

  async translate(systemId: string, input: TranslateInput): Promise<string> {
    const r = await request<{ translated: string }>(
      `${base(systemId)}/skills/${encodeURIComponent(input.skillId)}/translate`,
      {
        query: {
          field: input.field,
          version: input.version,
          text: input.text,
          lang: input.lang,
        },
      },
    );
    return r.data.translated;
  },

  /**
   * 订阅 agent 安装 SSE（`/install`）。
   *   - `agent.install.info`：日志行（data.line）
   *   - `agent.install.done`：安装完成
   * 返回 unsubscribe()。
   */
  subscribeInstall(
    systemId: string,
    handlers: {
      onLog?: (line: string) => void;
      onDone?: () => void;
      onError?: (err: unknown) => void;
    },
  ): () => void {
    return openEventSource(
      `${base(systemId)}/install`,
      (es) => {
        es.addEventListener('agent.install.info', (ev) => {
          try {
            handlers.onLog?.(parse<{ line: string }>(ev).line);
          } catch (e) {
            handlers.onError?.(e);
          }
        });
        es.addEventListener('agent.install.done', () => handlers.onDone?.());
      },
      handlers.onError,
    );
  },

  /**
   * 订阅 skill 安装 SSE（`/skills/{id}/install`）。
   *   - `agent.install.info`：日志行（data.line）
   *   - `agent.install.done`：安装完成
   * 返回 unsubscribe()。
   */
  subscribeSkillInstall(
    systemId: string,
    skillId: string,
    handlers: {
      onLog?: (line: string) => void;
      onDone?: () => void;
      onError?: (err: unknown) => void;
    },
  ): () => void {
    return openEventSource(
      `${base(systemId)}/skills/${encodeURIComponent(skillId)}/install`,
      (es) => {
        es.addEventListener('agent.install.info', (ev) => {
          try {
            handlers.onLog?.(parse<{ line: string }>(ev).line);
          } catch (e) {
            handlers.onError?.(e);
          }
        });
        es.addEventListener('agent.install.done', () => handlers.onDone?.());
      },
      handlers.onError,
    );
  },

  /**
   * 订阅运行日志 SSE（`/logs/stream`）。
   *   - `agent.log`：一行日志（data.line）
   * 返回 unsubscribe()。
   */
  subscribeLogs(
    systemId: string,
    handlers: {
      onLine?: (line: string) => void;
      onError?: (err: unknown) => void;
    },
  ): () => void {
    return openEventSource(
      `${base(systemId)}/logs/stream`,
      (es) => {
        es.addEventListener('agent.log', (ev) => {
          try {
            handlers.onLine?.(parse<{ line: string }>(ev).line);
          } catch (e) {
            handlers.onError?.(e);
          }
        });
      },
      handlers.onError,
    );
  },
};
