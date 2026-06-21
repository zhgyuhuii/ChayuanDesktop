// packages/api/src/vectorStore.ts —— 向量库配置 admin REST(S2)。
// 后端 vs_config_routes 包装 config_panel/vs_config 的 7 种向量库选型 + 连接测试 + 写盘。
import { http } from './client';

export interface VsField {
  name: string;
  label: string;
  widget: 'text' | 'password' | 'number' | 'switch' | 'select' | 'textarea';
  default: unknown;
  choices: string[] | null;
  placeholder: string;
  help: string;
}
export interface VsTypeMeta {
  key: string;
  label: string;
  help: string;
  install_hint: string;
  fields: VsField[];
}
export interface VsSchema {
  types: VsTypeMeta[];
  default_type: string;
  values: Record<string, Record<string, unknown>>;
}
export interface VsTestResult {
  ok: boolean;
  message: string;
  detail: string;
}

export const vectorStore = {
  schema: () => http.get<VsSchema>('/api/v1/admin/vectorstore/schema'),
  test: (type: string, values: Record<string, unknown>) =>
    http.post<VsTestResult>('/api/v1/admin/vectorstore/test', { type, values }),
  save: (type: string, values: Record<string, unknown>, setAsDefault: boolean) =>
    http.post<{ changed: string[]; needs_restart: boolean }>('/api/v1/admin/vectorstore/save', {
      type,
      values,
      set_as_default: setAsDefault,
    }),
};
