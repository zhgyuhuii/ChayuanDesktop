/**
 * BasicSettingsPage —— 管理控制台「基础配置」域(S1)。
 * 复用 S0 的 SchemaForm 渲染 basic_settings.yaml 全部 section(运行时 / 服务器绑定 /
 * 性能可扩展性 / 可观测性[含 Langfuse] / 多用户鉴权 / 异步入库 / 语义缓存)。
 * 额外:顶部 Langfuse 连通检测横幅(#12),复用 /admin/health。
 */
import * as React from 'react';
import { SchemaForm } from './SchemaForm';
import { useLfHealth } from '../useLfApi';
import { RefreshCw, CheckCircle2, XCircle } from 'lucide-react';

const LangfuseProbe: React.FC = () => {
  const { data, isFetching, refetch } = useLfHealth();
  const reachable = data?.reachable;
  return (
    <div className="mx-auto mt-6 max-w-3xl px-6">
      <div
        className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${
          reachable === undefined
            ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'
            : reachable
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
              : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
        }`}
      >
        {reachable ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        <span>
          Langfuse 检测：
          {reachable === undefined
            ? '未知'
            : reachable
              ? `可达${data?.status ? `(HTTP ${data.status})` : ''}`
              : '不可达 — 请检查下方 LANGFUSE_HOST / KEY 配置后重启服务'}
        </span>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 opacity-60 hover:opacity-100"
          onClick={() => void refetch()}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} /> 重新检测
        </button>
      </div>
    </div>
  );
};

export const BasicSettingsPage: React.FC = () => {
  return (
    <div>
      <LangfuseProbe />
      <SchemaForm file="basic_settings" />
    </div>
  );
};
