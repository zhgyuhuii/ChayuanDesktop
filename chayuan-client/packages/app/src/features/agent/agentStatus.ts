import type { AgentStatus } from '@chayuan/api';

export type AgentBranch = 'not_installed' | 'stopped' | 'running';
export type AgentTone = 'success' | 'idle' | 'muted';

export function branchOf(s: AgentStatus): AgentBranch {
  if (!s.installed) return 'not_installed';
  return s.running ? 'running' : 'stopped';
}

export function toneOf(s: AgentStatus): AgentTone {
  if (!s.installed) return 'muted';
  return s.running ? 'success' : 'idle';
}
