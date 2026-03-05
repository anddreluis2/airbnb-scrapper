import { describe, it, expect } from 'vitest';
import {
  getSegmentLabel,
  parseResultCount,
  canSubdivide,
  subdivideSegment,
  shouldSubdivide,
  computeEffectiveMaxPages,
} from '../src/segmentation.js';

describe('getSegmentLabel', () => {
  it('formats bounded segment', () => {
    expect(getSegmentLabel({ min: 100, max: 200 })).toBe('R$100-R$200');
  });

  it('formats unbounded segment', () => {
    expect(getSegmentLabel({ min: 3000 })).toBe('R$3000+');
  });

  it('formats zero-based segment', () => {
    expect(getSegmentLabel({ min: 0, max: 100 })).toBe('R$0-R$100');
  });
});

describe('parseResultCount', () => {
  it('returns null for null input', () => {
    expect(parseResultCount(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseResultCount('')).toBeNull();
  });

  it('parses "mais de mil" as 1001', () => {
    expect(parseResultCount('Mais de mil acomodações')).toBe(1001);
  });

  it('parses "1.000+" as 1001', () => {
    expect(parseResultCount('1.000+ acomodações')).toBe(1001);
  });

  it('parses simple number', () => {
    expect(parseResultCount('150 acomodações')).toBe(150);
  });

  it('parses number with dot separator', () => {
    expect(parseResultCount('1.234 acomodações')).toBe(1234);
  });

  it('returns null for unrecognized text', () => {
    expect(parseResultCount('Buscar hospedagens')).toBeNull();
  });
});

describe('canSubdivide', () => {
  it('returns false for unbounded segment', () => {
    expect(canSubdivide({ min: 3000 })).toBe(false);
  });

  it('returns false for tiny range', () => {
    expect(canSubdivide({ min: 100, max: 103 })).toBe(false);
  });

  it('returns true for range greater than minSubdivisionRange', () => {
    expect(canSubdivide({ min: 100, max: 200 })).toBe(true);
  });

  it('returns true for range just above threshold', () => {
    expect(canSubdivide({ min: 0, max: 4 })).toBe(true);
  });
});

describe('subdivideSegment', () => {
  it('returns original segment if no max', () => {
    const result = subdivideSegment({ min: 3000 });
    expect(result).toEqual([{ min: 3000 }]);
  });

  it('splits small range into 2 parts', () => {
    const result = subdivideSegment({ min: 100, max: 130 });
    expect(result).toHaveLength(2);
    expect(result[0].min).toBe(100);
    expect(result[result.length - 1].max).toBe(130);
  });

  it('splits large range (>40) into 3 parts', () => {
    const result = subdivideSegment({ min: 0, max: 100 });
    expect(result).toHaveLength(3);
    expect(result[0].min).toBe(0);
    expect(result[result.length - 1].max).toBe(100);
  });

  it('produces contiguous sub-segments', () => {
    const result = subdivideSegment({ min: 200, max: 300 });
    for (let i = 1; i < result.length; i++) {
      expect(result[i].min).toBe(result[i - 1].max);
    }
  });
});

describe('shouldSubdivide', () => {
  it('returns false when count is null', () => {
    expect(shouldSubdivide(null, { min: 100, max: 200 }, 0)).toBe(false);
  });

  it('returns false when count is below threshold', () => {
    expect(shouldSubdivide(100, { min: 100, max: 200 }, 0)).toBe(false);
  });

  it('returns true when count exceeds threshold and segment can subdivide', () => {
    expect(shouldSubdivide(500, { min: 100, max: 200 }, 0)).toBe(true);
  });

  it('returns false when at max depth', () => {
    expect(shouldSubdivide(500, { min: 100, max: 200 }, 6)).toBe(false);
  });

  it('returns false for unbounded segment even with high count', () => {
    expect(shouldSubdivide(500, { min: 3000 }, 0)).toBe(false);
  });
});

describe('computeEffectiveMaxPages', () => {
  it('returns maxPages when count is null', () => {
    const result = computeEffectiveMaxPages(null);
    expect(result).toBeGreaterThan(0);
  });

  it('returns maxPages when count exceeds maxListingsPerSegment', () => {
    const result = computeEffectiveMaxPages(500);
    expect(result).toBeGreaterThan(0);
  });

  it('estimates pages for small count', () => {
    const result = computeEffectiveMaxPages(36);
    expect(result).toBe(4);
  });

  it('caps at maxPages for moderate count', () => {
    const result = computeEffectiveMaxPages(270);
    expect(result).toBeLessThanOrEqual(50);
  });
});
