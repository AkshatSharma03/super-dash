import { describe, expect, it, vi } from 'vitest';
import { LRUCache } from './lru.js';

describe('LRUCache', () => {
  it('evicts the least recently used entry in O(1) order', () => {
    const cache = new LRUCache(2);
    cache.put('a', 1);
    cache.put('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.put('c', 3);

    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.stats().evictions).toBe(1);
  });

  it('expires stale entries and tracks hit/miss statistics', () => {
    vi.useFakeTimers();
    try {
      const cache = new LRUCache(2, { defaultTtlMs: 100 });
      cache.put('a', 1);
      expect(cache.get('a')).toBe(1);
      vi.advanceTimersByTime(101);
      expect(cache.get('a')).toBeNull();

      expect(cache.stats()).toMatchObject({
        size: 0,
        hits: 1,
        misses: 1,
        expirations: 1,
        hitRate: 0.5,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports explicit delete, clear, and pruning', () => {
    vi.useFakeTimers();
    try {
      const cache = new LRUCache(3);
      cache.put('a', 1, 50);
      cache.put('b', 2, 500);
      expect(cache.delete('missing')).toBe(false);
      expect(cache.delete('b')).toBe(true);
      vi.advanceTimersByTime(60);
      expect(cache.pruneExpired()).toBe(1);
      expect(cache.size).toBe(0);
      cache.put('c', 3);
      cache.clear();
      expect(cache.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects invalid capacities', () => {
    expect(() => new LRUCache(0)).toThrow('positive integer');
    expect(() => new LRUCache(1.5)).toThrow('positive integer');
  });
});
