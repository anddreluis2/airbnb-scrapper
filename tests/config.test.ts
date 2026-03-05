import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSearchUrl, CONFIG } from '../src/config.js';

describe('CONFIG defaults', () => {
  it('has correct base Airbnb URLs', () => {
    expect(CONFIG.airbnb.baseUrl).toBe('https://www.airbnb.com.br');
    expect(CONFIG.airbnb.homeUrl).toBe('https://www.airbnb.com.br/');
    expect(CONFIG.airbnb.searchUrl).toContain('Centro--Curitiba');
  });

  it('has room_types set to Entire home/apt', () => {
    expect(CONFIG.airbnb.searchParams.room_types).toBe('Entire home/apt');
  });

  it('has default price segments covering full range', () => {
    expect(CONFIG.priceSegments.length).toBeGreaterThanOrEqual(1);
    expect(CONFIG.priceSegments[0].min).toBe(0);

    const lastSegment = CONFIG.priceSegments[CONFIG.priceSegments.length - 1];
    expect(lastSegment.max).toBeUndefined();
  });

  it('has segmentation constants', () => {
    expect(CONFIG.segmentation.maxListingsPerSegment).toBe(270);
    expect(CONFIG.segmentation.maxSubdivisionDepth).toBe(6);
    expect(CONFIG.segmentation.minSubdivisionRange).toBe(3);
    expect(CONFIG.segmentation.subdivisionThreshold).toBe(40);
  });

  it('has pagination defaults', () => {
    expect(CONFIG.pagination.listingsPerPage).toBe(18);
    expect(CONFIG.pagination.maxPages).toBeGreaterThan(0);
  });

  it('has timeout values', () => {
    expect(CONFIG.timeouts.navigation).toBe(180000);
    expect(CONFIG.timeouts.paginationWait).toBe(30000);
    expect(CONFIG.timeouts.defaultAction).toBe(180000);
  });

  it('has delay ranges', () => {
    expect(CONFIG.delays.pageLoad.min).toBeLessThan(CONFIG.delays.pageLoad.max);
    expect(CONFIG.delays.scrollSettle.min).toBeLessThan(CONFIG.delays.scrollSettle.max);
    expect(CONFIG.delays.search.min).toBeLessThan(CONFIG.delays.search.max);
    expect(CONFIG.delays.listing.min).toBeLessThan(CONFIG.delays.listing.max);
  });

  it('has CSV output headers', () => {
    expect(CONFIG.output.headers).toContain('listing_id');
    expect(CONFIG.output.headers).toContain('url');
    expect(CONFIG.output.headers).toContain('titulo');
    expect(CONFIG.output.headers).toContain('localizacao');
    expect(CONFIG.output.headers).toContain('anfitriao');
    expect(CONFIG.output.headers).toContain('coordenadas');
    expect(CONFIG.output.headers).toContain('coletado_em');
  });
});

describe('getSearchUrl', () => {
  it('returns base URL with default search params when called with no args', () => {
    const url = getSearchUrl();
    expect(url).toContain('Centro--Curitiba');
    expect(url).toContain('tab_id=home_tab');
    expect(url).toContain('room_types=Entire+home%2Fapt');
    expect(url).toContain('search_type=autocomplete_click');
  });

  it('does not include items_offset for page 1', () => {
    const url = getSearchUrl(1);
    expect(url).not.toContain('items_offset');
  });

  it('adds items_offset for page > 1 when no cursor', () => {
    const url = getSearchUrl(3);
    expect(url).toContain('items_offset=36');
  });

  it('calculates offset as (pageNum - 1) * listingsPerPage', () => {
    expect(getSearchUrl(2)).toContain('items_offset=18');
    expect(getSearchUrl(5)).toContain('items_offset=72');
  });

  it('uses cursor instead of offset when cursor is provided', () => {
    const url = getSearchUrl(3, 'abc123');
    expect(url).toContain('cursor=abc123');
    expect(url).not.toContain('items_offset');
  });

  it('adds price_min when provided', () => {
    const url = getSearchUrl(1, undefined, 100);
    expect(url).toContain('price_min=100');
  });

  it('adds price_max when provided', () => {
    const url = getSearchUrl(1, undefined, undefined, 500);
    expect(url).toContain('price_max=500');
  });

  it('adds both price_min and price_max', () => {
    const url = getSearchUrl(1, undefined, 100, 500);
    expect(url).toContain('price_min=100');
    expect(url).toContain('price_max=500');
  });

  it('handles price_min of 0', () => {
    const url = getSearchUrl(1, undefined, 0);
    expect(url).toContain('price_min=0');
  });
});
