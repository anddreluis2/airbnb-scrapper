import { describe, it, expect } from 'vitest';
import { extractListingIdFromUrl } from '../../src/extraction/listing.js';

describe('extractListingIdFromUrl', () => {
  it('extracts numeric ID from /rooms/ URL', () => {
    expect(
      extractListingIdFromUrl('https://www.airbnb.com.br/rooms/12345678'),
    ).toBe('12345678');
  });

  it('extracts ID when URL has query params', () => {
    expect(
      extractListingIdFromUrl('https://www.airbnb.com.br/rooms/99887766?check_in=2024-01-01'),
    ).toBe('99887766');
  });

  it('extracts ID from URL with trailing slash', () => {
    expect(
      extractListingIdFromUrl('https://www.airbnb.com.br/rooms/55512345/'),
    ).toBe('55512345');
  });

  it('falls back to last path segment for non-rooms URL', () => {
    expect(
      extractListingIdFromUrl('https://www.airbnb.com.br/stay/abc-def'),
    ).toBe('abc-def');
  });

  it('returns "unknown" for empty URL', () => {
    expect(extractListingIdFromUrl('')).toBe('unknown');
  });

  it('handles URL with long numeric ID', () => {
    expect(
      extractListingIdFromUrl('https://www.airbnb.com.br/rooms/123456789012345'),
    ).toBe('123456789012345');
  });
});
