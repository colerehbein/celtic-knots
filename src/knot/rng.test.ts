import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng';

describe('mulberry32', () => {
  it('is deterministic: the same seed replays the same sequence', () => {
    const first = mulberry32(42);
    const second = mulberry32(42);
    const a = Array.from({ length: 32 }, () => first());
    const b = Array.from({ length: 32 }, () => second());
    expect(a).toEqual(b);
  });

  it('produces different sequences for different seeds', () => {
    const first = Array.from({ length: 32 }, mulberry32(1));
    const second = Array.from({ length: 32 }, mulberry32(2));
    expect(first).not.toEqual(second);
  });

  it('stays in [0, 1) for any seed', () => {
    for (const seed of [0, 1, 42, 1234, 0xffffffff, -7, 2 ** 31]) {
      const random = mulberry32(seed);
      for (let i = 0; i < 200; i++) {
        const value = random();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });

  it('is not constant: a stream has real spread', () => {
    const values = Array.from({ length: 64 }, mulberry32(9));
    expect(new Set(values).size).toBe(64);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.35);
    expect(mean).toBeLessThan(0.65);
  });
});
