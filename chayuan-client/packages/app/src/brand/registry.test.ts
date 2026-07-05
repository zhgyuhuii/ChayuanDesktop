import { beforeEach, describe, expect, it } from 'vitest';
import { getActiveBrand, resolveLandingPath, setActiveBrand } from './registry';

describe('brand registry', () => {
  beforeEach(() => setActiveBrand(undefined));

  it('默认无 brand', () => {
    expect(getActiveBrand()).toBeUndefined();
  });

  it('set 后可取回', () => {
    setActiveBrand({ appName: 'ChaCMD 指挥台' });
    expect(getActiveBrand()?.appName).toBe('ChaCMD 指挥台');
  });

  it('landing 默认 /home', () => {
    expect(resolveLandingPath(undefined)).toBe('/home');
    expect(resolveLandingPath({ appName: 'x' })).toBe('/home');
  });

  it('landing 可被 brand 覆盖', () => {
    expect(resolveLandingPath({ appName: 'x', landingPath: '/command' })).toBe('/command');
  });
});
