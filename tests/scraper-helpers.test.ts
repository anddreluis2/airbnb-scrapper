import { describe, it, expect } from 'vitest';
import { AirbnbScraper } from '../src/scraper.js';

function createScraper(): InstanceType<typeof AirbnbScraper> {
  return new AirbnbScraper();
}

function call(scraper: AirbnbScraper, method: string, ...args: unknown[]): unknown {
  return (scraper as Record<string, Function>)[method](...args);
}

describe('getSegmentLabel', () => {
  const scraper = createScraper();

  it('formats bounded segment', () => {
    expect(call(scraper, 'getSegmentLabel', { min: 100, max: 200 })).toBe('R$100-R$200');
  });

  it('formats unbounded segment', () => {
    expect(call(scraper, 'getSegmentLabel', { min: 3000 })).toBe('R$3000+');
  });

  it('formats zero-based segment', () => {
    expect(call(scraper, 'getSegmentLabel', { min: 0, max: 100 })).toBe('R$0-R$100');
  });
});

describe('parseResultCount', () => {
  const scraper = createScraper();

  it('returns null for null input', () => {
    expect(call(scraper, 'parseResultCount', null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(call(scraper, 'parseResultCount', '')).toBeNull();
  });

  it('parses "mais de mil" as 1001', () => {
    expect(call(scraper, 'parseResultCount', 'Mais de mil acomodações')).toBe(1001);
  });

  it('parses "1.000+" as 1001', () => {
    expect(call(scraper, 'parseResultCount', '1.000+ acomodações')).toBe(1001);
  });

  it('parses simple number', () => {
    expect(call(scraper, 'parseResultCount', '150 acomodações')).toBe(150);
  });

  it('parses number with dot separator', () => {
    expect(call(scraper, 'parseResultCount', '1.234 acomodações')).toBe(1234);
  });

  it('returns null for unrecognized text', () => {
    expect(call(scraper, 'parseResultCount', 'Buscar hospedagens')).toBeNull();
  });
});

describe('canSubdivide', () => {
  const scraper = createScraper();

  it('returns false for unbounded segment', () => {
    expect(call(scraper, 'canSubdivide', { min: 3000 })).toBe(false);
  });

  it('returns false for tiny range', () => {
    expect(call(scraper, 'canSubdivide', { min: 100, max: 103 })).toBe(false);
  });

  it('returns true for range greater than minSubdivisionRange', () => {
    expect(call(scraper, 'canSubdivide', { min: 100, max: 200 })).toBe(true);
  });

  it('returns true for range just above threshold', () => {
    expect(call(scraper, 'canSubdivide', { min: 0, max: 4 })).toBe(true);
  });
});

describe('subdivideSegment', () => {
  const scraper = createScraper();

  it('returns original segment if no max', () => {
    const result = call(scraper, 'subdivideSegment', { min: 3000 });
    expect(result).toEqual([{ min: 3000 }]);
  });

  it('splits small range into 2 parts', () => {
    const result = call(scraper, 'subdivideSegment', { min: 100, max: 130 }) as Array<{
      min: number;
      max: number;
    }>;
    expect(result).toHaveLength(2);
    expect(result[0].min).toBe(100);
    expect(result[result.length - 1].max).toBe(130);
  });

  it('splits large range (>40) into 3 parts', () => {
    const result = call(scraper, 'subdivideSegment', { min: 0, max: 100 }) as Array<{
      min: number;
      max: number;
    }>;
    expect(result).toHaveLength(3);
    expect(result[0].min).toBe(0);
    expect(result[result.length - 1].max).toBe(100);
  });

  it('produces contiguous sub-segments', () => {
    const result = call(scraper, 'subdivideSegment', { min: 200, max: 300 }) as Array<{
      min: number;
      max: number;
    }>;
    for (let i = 1; i < result.length; i++) {
      expect(result[i].min).toBe(result[i - 1].max);
    }
  });
});

describe('shouldSubdivide', () => {
  const scraper = createScraper();

  it('returns false when count is null', () => {
    expect(call(scraper, 'shouldSubdivide', null, { min: 100, max: 200 }, 0)).toBe(false);
  });

  it('returns false when count is below threshold', () => {
    expect(call(scraper, 'shouldSubdivide', 100, { min: 100, max: 200 }, 0)).toBe(false);
  });

  it('returns true when count exceeds threshold and segment can subdivide', () => {
    expect(call(scraper, 'shouldSubdivide', 500, { min: 100, max: 200 }, 0)).toBe(true);
  });

  it('returns false when at max depth', () => {
    expect(call(scraper, 'shouldSubdivide', 500, { min: 100, max: 200 }, 6)).toBe(false);
  });

  it('returns false for unbounded segment even with high count', () => {
    expect(call(scraper, 'shouldSubdivide', 500, { min: 3000 }, 0)).toBe(false);
  });
});

describe('computeEffectiveMaxPages', () => {
  const scraper = createScraper();

  it('returns maxPages when count is null', () => {
    const result = call(scraper, 'computeEffectiveMaxPages', null);
    expect(result).toBeGreaterThan(0);
  });

  it('returns maxPages when count exceeds maxListingsPerSegment', () => {
    const result = call(scraper, 'computeEffectiveMaxPages', 500);
    expect(result).toBeGreaterThan(0);
  });

  it('estimates pages for small count', () => {
    const result = call(scraper, 'computeEffectiveMaxPages', 36) as number;
    expect(result).toBe(4);
  });

  it('caps at maxPages for moderate count', () => {
    const result = call(scraper, 'computeEffectiveMaxPages', 270) as number;
    expect(result).toBeLessThanOrEqual(15);
  });
});
