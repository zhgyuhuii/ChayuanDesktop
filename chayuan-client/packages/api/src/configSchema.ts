// packages/api/src/configSchema.ts —— Schema 驱动配置 admin REST(S0)。
// 后端把 config_panel/schema.py 的 ALL_SCHEMAS 以 JSON 暴露,前端 <SchemaForm> 通用渲染。
// 覆盖 5 个 yaml 配置域:basic_settings / kb_settings / model_settings / tool_settings / prompt_settings。
import { http } from './client';

export type ConfigWidget =
  | 'switch'
  | 'number'
  | 'text'
  | 'password'
  | 'textarea'
  | 'select'
  | 'yaml';

export interface ConfigField {
  path: string;
  label: string;
  widget: ConfigWidget;
  help: string;
  needs_restart: boolean;
  choices: (string | number)[] | null;
  placeholder: string;
  min: number | null;
  max: number | null;
  step: number | null;
  rows: number;
  password_toggle: boolean;
}
export interface ConfigSection {
  title: string;
  description: string;
  fields: ConfigField[];
}
export interface ConfigSchema {
  filename: string;
  title: string;
  description: string;
  raw_editor: boolean;
  sections: ConfigSection[];
}
export interface ConfigValues {
  filename: string;
  exists: boolean;
  values: Record<string, unknown>;
  masked: Record<string, boolean>;
  raw_text: string | null;
}
export interface ConfigSaveResult {
  changed: string[];
  rejected: string[];
  needs_restart: boolean;
}

// 已知配置域(对应 schema.py ALL_SCHEMAS)
export type ConfigFile =
  | 'basic_settings'
  | 'kb_settings'
  | 'model_settings'
  | 'tool_settings'
  | 'prompt_settings';

export const configApi = {
  list: () =>
    http.get<{ files: { filename: string; title: string; description: string }[] }>(
      '/api/v1/admin/config/',
    ),
  schema: (file: ConfigFile) =>
    http.get<ConfigSchema>(`/api/v1/admin/config/${file}/schema`),
  values: (file: ConfigFile) =>
    http.get<ConfigValues>(`/api/v1/admin/config/${file}/values`),
  save: (file: ConfigFile, values: Record<string, unknown>) =>
    http.post<ConfigSaveResult>(`/api/v1/admin/config/${file}`, { values }),
  saveRaw: (file: ConfigFile, text: string) =>
    http.post<{ needs_restart: boolean }>(`/api/v1/admin/config/${file}/raw`, { text }),
};
