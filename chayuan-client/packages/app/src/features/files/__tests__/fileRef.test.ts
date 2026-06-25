import { describe, it, expect, vi } from 'vitest';

vi.mock('@chayuan/api', () => ({
  getClientConfig: () => ({ baseURL: 'https://h' }),
  getAccessToken: vi.fn(async () => 'TOK'),
}));

import { resolveFileUrl } from '../fileRef';

describe('resolveFileUrl', () => {
  it('kb-doc 拼 /api/v1/files?kind=kb-doc + token', async () => {
    const u = await resolveFileUrl({ kind: 'kb-doc', kb: 'KB', file: 'a.pdf' });
    expect(u).toContain('https://h/api/v1/files?');
    expect(u).toContain('kind=kb-doc');
    expect(u).toContain('kb=KB');
    expect(u).toContain('file=a.pdf');
    expect(u).toContain('token=TOK');
    expect(u).not.toContain('download=1');
  });

  it('download=true 加 download=1', async () => {
    const u = await resolveFileUrl({ kind: 'artifact', name: 'x.png' }, { download: true });
    expect(u).toContain('kind=artifact');
    expect(u).toContain('name=x.png');
    expect(u).toContain('download=1');
  });

  it('image 用 source_id/image_id', async () => {
    const u = await resolveFileUrl({ kind: 'image', sourceId: 7, imageId: 'i1' });
    expect(u).toContain('kind=image');
    expect(u).toContain('source_id=7');
    expect(u).toContain('image_id=i1');
  });
});
