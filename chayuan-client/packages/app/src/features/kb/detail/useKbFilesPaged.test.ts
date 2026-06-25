import { describe, it, expect } from 'vitest';
import { nextPageParam } from './useKbFilesPaged';

describe('nextPageParam', () => {
  it('returns next page when has_more', () => {
    expect(nextPageParam({ items: [], total: 30, page: 0, page_size: 20, has_more: true })).toBe(1);
  });
  it('returns undefined when no more', () => {
    expect(nextPageParam({ items: [], total: 20, page: 0, page_size: 20, has_more: false })).toBeUndefined();
  });
  it('advances from a non-zero page', () => {
    expect(nextPageParam({ items: [], total: 100, page: 2, page_size: 20, has_more: true })).toBe(3);
  });
});
