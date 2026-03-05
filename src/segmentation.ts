import { PriceSegment } from './types.js';
import { CONFIG } from './config.js';

export function getSegmentLabel(segment: PriceSegment): string {
  return segment.max
    ? `R$${segment.min}-R$${segment.max}`
    : `R$${segment.min}+`;
}

export function parseResultCount(text: string | null): number | null {
  if (!text) return null;
  if (text.toLowerCase().includes('mais de mil') || text.includes('1.000+')) {
    return 1001;
  }
  const match = text.match(/(\d[\d.]*)\s*acomodaç/);
  if (match) {
    return parseInt(match[1].replace(/\./g, ''), 10);
  }
  return null;
}

export function canSubdivide(segment: PriceSegment): boolean {
  if (segment.max === undefined) return false;
  return segment.max - segment.min > CONFIG.segmentation.minSubdivisionRange;
}

export function subdivideSegment(segment: PriceSegment): PriceSegment[] {
  if (segment.max === undefined) return [segment];

  const range = segment.max - segment.min;
  const parts = range > CONFIG.segmentation.subdivisionThreshold ? 3 : 2;
  const step = Math.floor(range / parts);

  const subSegments: PriceSegment[] = [];
  for (let i = 0; i < parts; i++) {
    const min = segment.min + i * step;
    const max = i === parts - 1 ? segment.max : segment.min + (i + 1) * step;
    subSegments.push({ min, max });
  }

  return subSegments;
}

export function shouldSubdivide(
  count: number | null,
  segment: PriceSegment,
  depth: number,
): boolean {
  return (
    count !== null &&
    count > CONFIG.segmentation.maxListingsPerSegment &&
    canSubdivide(segment) &&
    depth < CONFIG.segmentation.maxSubdivisionDepth
  );
}

export function computeEffectiveMaxPages(count: number | null): number {
  if (count !== null && count <= CONFIG.segmentation.maxListingsPerSegment) {
    const estimated = Math.ceil(count / CONFIG.pagination.listingsPerPage) + 2;
    return Math.min(estimated, CONFIG.pagination.maxPages);
  }
  return CONFIG.pagination.maxPages;
}
