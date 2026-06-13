// packages/publisher-core/src/__tests__/detect.test.ts
import { describe, it, expect } from 'vitest';
import { planDetection } from '../detect';

const scanned = [
  { path: '/b/chayuan-3.1.0-win-x86_64-pro.zip', filename: 'chayuan-3.1.0-win-x86_64-pro.zip', sizeBytes: 100 },
  { path: '/b/chayuan-3.1.0-linux-x86_64-lite.tar.gz', filename: 'chayuan-3.1.0-linux-x86_64-lite.tar.gz', sizeBytes: 50 },
];

describe('planDetection', () => {
  it('无线上数据时 status=no-online,buildVersion 取 git', () => {
    const p = planDetection({ scanned, gitVersion: '3.1.0' });
    expect(p.status).toBe('no-online');
    expect(p.buildVersion).toBe('3.1.0');
    expect(p.onlineVersion).toBeNull();
    expect(p.items).toHaveLength(2);
  });

  it('本地比线上新 → ahead,未发布项默认勾选', () => {
    const p = planDetection({
      scanned, gitVersion: '3.1.0',
      online: { latest: { version: '3.0.0' }, platforms: {} },
    });
    expect(p.status).toBe('ahead');
    expect(p.items.every((i) => i.selected)).toBe(true);
    expect(p.items.every((i) => i.onlineState === 'new')).toBe(true);
  });

  it('版本相同 → same', () => {
    const p = planDetection({ scanned, gitVersion: '3.1.0', online: { latest: { version: '3.1.0' }, platforms: {} } });
    expect(p.status).toBe('same');
  });

  it('本地比线上旧 → behind', () => {
    const p = planDetection({ scanned, gitVersion: '2.0.0', online: { latest: { version: '3.0.0' }, platforms: {} } });
    expect(p.status).toBe('behind');
  });

  it('已发布项 onlineState=published 且不默认勾选', () => {
    const p = planDetection({
      scanned, gitVersion: '3.1.0',
      adminReleases: [{ version: '3.1.0', platform: 'win-x86_64', variant: '全量版', published: true }],
    });
    const win = p.items.find((i) => i.platform === 'win-x86_64')!;
    expect(win.onlineState).toBe('published');
    expect(win.selected).toBe(false);
  });

  it('已上传未发布 onlineState=exists-unpublished(仍默认勾选)', () => {
    const p = planDetection({
      scanned, gitVersion: '3.1.0',
      adminReleases: [{ version: '3.1.0', platform: 'win-x86_64', variant: '全量版', published: false }],
    });
    const win = p.items.find((i) => i.platform === 'win-x86_64')!;
    expect(win.onlineState).toBe('exists-unpublished');
    expect(win.selected).toBe(true);
  });

  it('解析失败的文件标 needsManual 且不勾选', () => {
    const p = planDetection({ scanned: [{ path: '/b/weird.zip', filename: 'weird.zip', sizeBytes: 1 }] });
    expect(p.items[0].parsed).toBe('needsManual');
    expect(p.items[0].selected).toBe(false);
  });

  it('git 版本与文件版本不一致 → 诊断', () => {
    const p = planDetection({ scanned, gitVersion: '9.9.9' });
    expect(p.diagnostics.some((d) => d.includes('不一致'))).toBe(true);
  });
});
