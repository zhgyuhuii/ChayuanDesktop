import * as React from 'react';
import { McpConnectionList } from './McpConnectionList';

/** MCP 连接管理域(#6):连接列表 + 工具栏「通用配置」弹窗 / 「新建连接」;改删走卡片弹窗。 */
export const McpPage: React.FC = () => (
  <div className="space-y-4 p-4">
    <McpConnectionList />
  </div>
);
