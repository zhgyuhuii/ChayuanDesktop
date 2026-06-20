import { describe, it, expect } from 'vitest';
import type { AgentStatus } from '@chayuan/api';
import { branchOf, toneOf } from './agentStatus';

function mk(installed: boolean, running: boolean): AgentStatus {
  return { installed, running, health: 'unknown', detail: '' };
}

describe('agentStatus helpers', () => {
  it('branchOf: not installed', () => {
    expect(branchOf(mk(false, false))).toBe('not_installed');
    expect(branchOf(mk(false, true))).toBe('not_installed');
  });

  it('branchOf: stopped', () => {
    expect(branchOf(mk(true, false))).toBe('stopped');
  });

  it('branchOf: running', () => {
    expect(branchOf(mk(true, true))).toBe('running');
  });

  it('toneOf: muted when not installed', () => {
    expect(toneOf(mk(false, false))).toBe('muted');
  });

  it('toneOf: idle when stopped', () => {
    expect(toneOf(mk(true, false))).toBe('idle');
  });

  it('toneOf: success when running', () => {
    expect(toneOf(mk(true, true))).toBe('success');
  });
});
