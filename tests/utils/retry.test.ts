import { describe, it, expect, vi } from 'vitest';
import { calculateBackoff, withRetry } from '../../src/utils/retry.js';
import { RetryConfig } from '../../src/types.js';

const baseConfig: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 5000,
  multiplier: 2,
};

describe('calculateBackoff', () => {
  it('returns initialDelay on first attempt', () => {
    expect(calculateBackoff(1, baseConfig)).toBe(1000);
  });

  it('applies multiplier on second attempt', () => {
    expect(calculateBackoff(2, baseConfig)).toBe(2000);
  });

  it('applies multiplier exponentially on third attempt', () => {
    expect(calculateBackoff(3, baseConfig)).toBe(4000);
  });

  it('caps at maxDelay', () => {
    expect(calculateBackoff(10, baseConfig)).toBe(5000);
  });

  it('works with fractional multiplier', () => {
    const config: RetryConfig = { ...baseConfig, multiplier: 1.5 };
    expect(calculateBackoff(2, config)).toBe(1500);
  });
});

describe('withRetry', () => {
  it('returns result on first successful call', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn, baseConfig);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockResolvedValue('recovered');

    const fastConfig: RetryConfig = {
      ...baseConfig,
      initialDelay: 10,
      maxDelay: 20,
    };

    const result = await withRetry(fn, fastConfig);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permanent failure'));

    const fastConfig: RetryConfig = {
      ...baseConfig,
      maxRetries: 2,
      initialDelay: 10,
      maxDelay: 20,
    };

    await expect(withRetry(fn, fastConfig)).rejects.toThrow('permanent failure');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('preserves original error on final throw', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('specific error'));

    const fastConfig: RetryConfig = {
      ...baseConfig,
      maxRetries: 1,
      initialDelay: 10,
      maxDelay: 20,
    };

    await expect(withRetry(fn, fastConfig)).rejects.toThrow('specific error');
  });
});
