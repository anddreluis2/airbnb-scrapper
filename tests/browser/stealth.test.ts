import { describe, it, expect } from 'vitest';
import { getRandomDelay } from '../../src/browser/stealth.js';

describe('getRandomDelay', () => {
  it('returns a value within [min, max]', () => {
    for (let i = 0; i < 100; i++) {
      const delay = getRandomDelay(1000, 2000);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(2000);
    }
  });

  it('returns exact value when min === max', () => {
    expect(getRandomDelay(500, 500)).toBe(500);
  });

  it('returns integer values', () => {
    for (let i = 0; i < 50; i++) {
      const delay = getRandomDelay(100, 999);
      expect(Number.isInteger(delay)).toBe(true);
    }
  });

  it('handles small ranges', () => {
    for (let i = 0; i < 50; i++) {
      const delay = getRandomDelay(10, 11);
      expect(delay === 10 || delay === 11).toBe(true);
    }
  });
});
