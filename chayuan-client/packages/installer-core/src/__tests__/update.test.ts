import { describe, it, expect } from 'vitest';
import { toReleasePlatform, decideUpdate } from '../update';

describe('toReleasePlatform', () => {
  it('layout 维度 → website 发布平台键', () => {
    expect(toReleasePlatform('win', 'x86_64')).toBe('windows-amd64');
    expect(toReleasePlatform('win', 'arm64')).toBe('windows-arm64');
    expect(toReleasePlatform('mac', 'x86_64')).toBe('mac-x64');
    expect(toReleasePlatform('mac', 'arm64')).toBe('mac-arm64');
    expect(toReleasePlatform('linux', 'x86_64')).toBe('linux-amd64');
    expect(toReleasePlatform('linux', 'arm64')).toBe('linux-arm64');
  });
});

const RESP = {
  product: 'desktop',
  latest: { version: '3.1.0' },
  platforms: {
    'windows-amd64': {
      version: '3.1.0', primaryUrl: '/downloads/desktop/win/a.exe',
      variants: [
        { variant: '集成版', primary: true, url: '/downloads/desktop/win/a.exe', notes: '' },
        { variant: '轻量版', primary: false, url: '/downloads/desktop/win/b.exe', notes: '' },
      ],
    },
    'mac-arm64': {
      version: '3.0.0', primaryUrl: '/downloads/desktop/mac/a.dmg',
      variants: [{ variant: '集成版', primary: true, url: '/downloads/desktop/mac/a.dmg', notes: '' }],
    },
  },
};

describe('decideUpdate', () => {
  it('本地旧 + 该平台有更新 → available + primaryUrl', () => {
    const r = decideUpdate(RESP, { currentVersion: '3.0.0', os: 'win', arch: 'x86_64' });
    expect(r.available).toBe(true);
    expect(r.latestVersion).toBe('3.1.0');
    expect(r.downloadUrl).toBe('/downloads/desktop/win/a.exe');
    expect(r.variant).toBe('集成版');
  });
  it('指定变体 → 取该变体 url', () => {
    const r = decideUpdate(RESP, { currentVersion: '3.0.0', os: 'win', arch: 'x86_64', preferVariant: '轻量版' });
    expect(r.available).toBe(true);
    expect(r.downloadUrl).toBe('/downloads/desktop/win/b.exe');
  });
  it('本地已是最新 → available=false', () => {
    const r = decideUpdate(RESP, { currentVersion: '3.1.0', os: 'win', arch: 'x86_64' });
    expect(r.available).toBe(false);
  });
  it('该平台无发布 → available=false', () => {
    const r = decideUpdate(RESP, { currentVersion: '1.0.0', os: 'linux', arch: 'x86_64' });
    expect(r.available).toBe(false);
  });
});
