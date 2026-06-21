/**
 * LangfuseConfig —— 聚焦的 Langfuse 链路追踪配置(只暴露 4 个 Langfuse 字段)。
 * 用户反馈:点拓扑 Langfuse 节点不该打开整个基础配置(太复杂、与原版不一致)。
 * 复用 SchemaForm + onlyPaths,只渲染 host/public_key/secret_key/一键禁用。
 */
import * as React from 'react';
import { SchemaForm } from './SchemaForm';

const LANGFUSE_PATHS = [
  'LANGFUSE_HOST',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'CHAYUAN_LANGFUSE_DISABLE',
];

export const LangfuseConfig: React.FC = () => (
  <SchemaForm
    file="basic_settings"
    title="Langfuse 链路追踪"
    intro="LLM 链路观测(可选)。host + public/secret key 同时填写方可启用;留空 = 禁用,对业务无影响。"
    onlyPaths={LANGFUSE_PATHS}
  />
);
