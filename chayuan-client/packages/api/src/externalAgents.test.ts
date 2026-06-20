import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client', () => ({
  request: vi.fn(),
  getClientConfig: () => ({ baseURL: 'http://x', authMode: 'bearer' as const }),
}));

import { request } from './client';
import { externalAgents } from './externalAgents';

const mockRequest = request as unknown as ReturnType<typeof vi.fn>;

describe('externalAgents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('status() GET /status', async () => {
    mockRequest.mockResolvedValue({ data: { installed: true, running: false, health: 'unknown', detail: '' } });
    const s = await externalAgents.status('openclaw');
    expect(s.installed).toBe(true);
    expect(s.running).toBe(false);
    const [path, opts] = mockRequest.mock.calls[0]!;
    expect(path).toBe('/external-agents/openclaw/status');
    expect(opts?.method ?? 'GET').toBe('GET');
  });

  it('start() POST /start', async () => {
    mockRequest.mockResolvedValue({ data: { installed: true, running: true, health: 'ok', detail: '' } });
    const s = await externalAgents.start('hermes');
    expect(s.running).toBe(true);
    const [path, opts] = mockRequest.mock.calls[0]!;
    expect(path).toBe('/external-agents/hermes/start');
    expect(opts.method).toBe('POST');
  });

  it('stop() POST /stop', async () => {
    mockRequest.mockResolvedValue({ data: { installed: true, running: false, health: 'unknown', detail: '' } });
    await externalAgents.stop('openclaw');
    const [path, opts] = mockRequest.mock.calls[0]!;
    expect(path).toBe('/external-agents/openclaw/stop');
    expect(opts.method).toBe('POST');
  });

  it('restart() POST /restart', async () => {
    mockRequest.mockResolvedValue({ data: { installed: true, running: true, health: 'ok', detail: '' } });
    await externalAgents.restart('openclaw');
    expect(mockRequest.mock.calls[0]![0]).toBe('/external-agents/openclaw/restart');
    expect(mockRequest.mock.calls[0]![1].method).toBe('POST');
  });

  it('uninstall() POST /uninstall', async () => {
    mockRequest.mockResolvedValue({ data: { installed: false, running: false, health: 'unknown', detail: '' } });
    await externalAgents.uninstall('openclaw');
    expect(mockRequest.mock.calls[0]![0]).toBe('/external-agents/openclaw/uninstall');
    expect(mockRequest.mock.calls[0]![1].method).toBe('POST');
  });

  it('getConfig() GET /config', async () => {
    mockRequest.mockResolvedValue({ data: { raw: 'a: 1', soul: 'be nice', format: 'yaml' } });
    const c = await externalAgents.getConfig('openclaw');
    expect(c.raw).toBe('a: 1');
    expect(c.format).toBe('yaml');
    expect(mockRequest.mock.calls[0]![0]).toBe('/external-agents/openclaw/config');
  });

  it('setConfig() PUT /config with body', async () => {
    mockRequest.mockResolvedValue({ data: { raw: 'x: 2', format: 'yaml' } });
    await externalAgents.setConfig('openclaw', { raw: 'x: 2', soul: 'kind', format: 'yaml' });
    const [path, opts] = mockRequest.mock.calls[0]!;
    expect(path).toBe('/external-agents/openclaw/config');
    expect(opts.method).toBe('PUT');
    expect(opts.body).toEqual({ raw: 'x: 2', soul: 'kind', format: 'yaml' });
  });

  it('listSkills() GET /skills', async () => {
    mockRequest.mockResolvedValue({ data: [{ id: 's1', name: 'S1', version: '1.0', description: 'd', permissions: [], installed: true, publisher: 'p', verified: false, readme: '' }] });
    const list = await externalAgents.listSkills('openclaw');
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('s1');
    expect(mockRequest.mock.calls[0]![0]).toBe('/external-agents/openclaw/skills');
  });

  it('searchSkills() GET /skills/search?q=', async () => {
    mockRequest.mockResolvedValue({ data: [] });
    await externalAgents.searchSkills('openclaw', 'weather');
    const [path, opts] = mockRequest.mock.calls[0]!;
    expect(path).toBe('/external-agents/openclaw/skills/search');
    expect(opts.query).toEqual({ q: 'weather' });
  });

  it('uninstallSkill() POST /skills/{id}/uninstall', async () => {
    mockRequest.mockResolvedValue({ data: { ok: true } });
    await externalAgents.uninstallSkill('openclaw', 'sk 1');
    const [path, opts] = mockRequest.mock.calls[0]!;
    expect(path).toBe('/external-agents/openclaw/skills/sk%201/uninstall');
    expect(opts.method).toBe('POST');
  });

  it('translate() GET /skills/{id}/translate returns .translated string', async () => {
    mockRequest.mockResolvedValue({ data: { translated: '你好' } });
    const t = await externalAgents.translate('openclaw', { skillId: 'sk1', field: 'readme', version: '1.0', text: 'hello', lang: 'zh' });
    expect(t).toBe('你好');
    const [path, opts] = mockRequest.mock.calls[0]!;
    expect(path).toBe('/external-agents/openclaw/skills/sk1/translate');
    expect(opts.query).toEqual({ field: 'readme', version: '1.0', text: 'hello', lang: 'zh' });
  });
});
