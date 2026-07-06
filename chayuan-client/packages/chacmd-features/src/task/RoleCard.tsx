import * as React from 'react';

/** L1 角色卡（§3.2）：每个参与者一张——role/scope/tools/permissions/handoff + 是否 supervisor + 路由理由。 */
export interface RoleCardData {
  nickname: string;
  role: string;
  scope?: string;
  tools?: string[];
  permissions?: string[];
  handoffRule?: string;
  isSupervisor?: boolean;
  routeReason?: string;
}

const Line: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.7 }}>
    <span style={{ color: '#64748b', minWidth: 56 }}>{label}</span>
    <span style={{ color: '#cbd5e1' }}>{children}</span>
  </div>
);

export const RoleCard: React.FC<{ data: RoleCardData }> = ({ data }) => (
  <div
    data-testid={`role-card-${data.nickname}`}
    style={{
      width: 260,
      background: 'rgba(15,23,42,0.92)',
      border: `1px solid ${data.isSupervisor ? '#a855f7' : 'rgba(148,163,184,0.3)'}`,
      borderRadius: 12,
      padding: 14,
      color: '#e5e7eb',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <strong>{data.nickname}</strong>
      <span style={{ color: '#94a3b8', fontSize: 12 }}>{data.role}</span>
      {data.isSupervisor ? (
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#a855f7' }}>Supervisor</span>
      ) : null}
    </div>
    {data.scope ? <Line label="范围">{data.scope}</Line> : null}
    {data.tools?.length ? <Line label="工具">{data.tools.join('、')}</Line> : null}
    {data.permissions?.length ? <Line label="权限">{data.permissions.join('、')}</Line> : null}
    {data.handoffRule ? <Line label="交接">{data.handoffRule}</Line> : null}
    {data.routeReason ? <Line label="路由">{data.routeReason}</Line> : null}
  </div>
);
