import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@chayuan/api', () => ({
  licenseStatus: vi.fn(),
  licenseActivate: vi.fn(),
  licenseActivateToken: vi.fn(),
}));

import { licenseActivate, licenseActivateToken, licenseStatus } from '@chayuan/api';
import { useLicenseStore } from '../licenseStore';

const mocked = {
  status: licenseStatus as unknown as ReturnType<typeof vi.fn>,
  activate: licenseActivate as unknown as ReturnType<typeof vi.fn>,
  activateToken: licenseActivateToken as unknown as ReturnType<typeof vi.fn>,
};

beforeEach(() => {
  useLicenseStore.getState().reset();
  vi.clearAllMocks();
});

describe('licenseStore', () => {
  it('refresh 写入 status 并置 ready', async () => {
    mocked.status.mockResolvedValue({ licensed: true, app: 'video', expireAt: '2026-07-01T00:00:00.000Z' });
    const s = await useLicenseStore.getState().refresh('video');
    expect(s.licensed).toBe(true);
    expect(useLicenseStore.getState().isLicensed('video')).toBe(true);
    expect(useLicenseStore.getState().isReady('video')).toBe(true);
  });

  it('refresh 网络异常 → fail-closed（licensed=false）但仍 ready', async () => {
    mocked.status.mockRejectedValue(new Error('network'));
    const s = await useLicenseStore.getState().refresh('video');
    expect(s.licensed).toBe(false);
    expect(s.reason).toBe('none');
    expect(useLicenseStore.getState().isLicensed('video')).toBe(false);
    expect(useLicenseStore.getState().isReady('video')).toBe(true);
  });

  it('activateSerial 成功后 isLicensed=true', async () => {
    mocked.activate.mockResolvedValue({ licensed: true, app: 'video', expireAt: '2026-07-01T00:00:00.000Z' });
    const s = await useLicenseStore.getState().activateSerial('video', '2101W-0JWN1-MN2JP-9V4QW-MSGJ');
    expect(s.licensed).toBe(true);
    expect(mocked.activate).toHaveBeenCalledWith('video', '2101W-0JWN1-MN2JP-9V4QW-MSGJ');
    expect(useLicenseStore.getState().isLicensed('video')).toBe(true);
  });

  it('activateToken 失败保留 reason', async () => {
    mocked.activateToken.mockResolvedValue({ licensed: false, app: 'video', reason: 'mismatch' });
    const s = await useLicenseStore.getState().activateToken('video', 'tok');
    expect(s.licensed).toBe(false);
    expect(s.reason).toBe('mismatch');
    expect(mocked.activateToken).toHaveBeenCalledWith('video', 'tok');
  });

  it('未刷新前 isLicensed=false 且 isReady=false', () => {
    expect(useLicenseStore.getState().isLicensed('video')).toBe(false);
    expect(useLicenseStore.getState().isReady('video')).toBe(false);
  });
});
