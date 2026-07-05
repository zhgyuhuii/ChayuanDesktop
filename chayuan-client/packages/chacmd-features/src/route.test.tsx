import { describe, expect, it } from 'vitest';
import { chacmdBrand, commandRoute } from './route';

describe('chacmdBrand / commandRoute', () => {
  it('landing 指向 /command, 品牌名 ChaCMD', () => {
    expect(chacmdBrand.landingPath).toBe('/command');
    expect(chacmdBrand.appName).toBe('ChaCMD 指挥台');
  });

  it('routeExtensions 含 /command 大屏路由', () => {
    const patterns = (chacmdBrand.routeExtensions ?? []).map((r) => r.pattern.source);
    expect(patterns).toContain(/^\/command$/.source);
  });

  it('commandRoute.pattern 匹配 /command、不匹配 /home', () => {
    expect(commandRoute.pattern.test('/command')).toBe(true);
    expect(commandRoute.pattern.test('/home')).toBe(false);
  });

  it('commandRoute.render 返回节点(不抛)', () => {
    expect(() => commandRoute.render({}, '/command')).not.toThrow();
  });
});
