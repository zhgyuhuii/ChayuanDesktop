import * as React from 'react';
import { McpProfilePanel } from './McpProfilePanel';
import { McpConnectionList } from './McpConnectionList';

/** MCP 连接管理域(Profile + 连接列表)。 */
export const McpPage: React.FC = () => (
  <div className="space-y-6 p-4">
    <McpProfilePanel />
    <McpConnectionList />
  </div>
);
