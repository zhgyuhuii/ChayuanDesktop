import { afterEach, describe, expect, it } from 'vitest';
import { setActiveBrand } from '../../brand/registry';
import { resolveRoute } from './page-registry';

describe('resolveRoute + brand 注入', () => {
  afterEach(() => setActiveBrand(undefined));

  it('无 brand → /home 命中内置(察元不变)', () => {
    expect(resolveRoute('/home')).not.toBeNull();
    expect(resolveRoute('/command')).toBeNull(); // 未注入时无此路由
  });

  it('注入 /command 路由后可命中', () => {
    setActiveBrand({
      appName: 'ChaCMD',
      routeExtensions: [{ pattern: /^\/command$/, render: () => null, defaultTitle: 'ChaCMD' }],
    });
    expect(resolveRoute('/command')).not.toBeNull();
    expect(resolveRoute('/home')).not.toBeNull(); // 内置仍在
  });
});
