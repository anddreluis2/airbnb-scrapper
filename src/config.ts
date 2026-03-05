import { PriceSegment } from './types.js';

function isValidSegment(seg: unknown): seg is PriceSegment {
  if (typeof seg !== 'object' || seg === null) return false;
  const s = seg as Record<string, unknown>;
  if (typeof s.min !== 'number' || s.min < 0) return false;
  if (s.max !== undefined && (typeof s.max !== 'number' || s.max <= s.min)) return false;
  return true;
}

function parsePriceSegments(): PriceSegment[] {
  const envSegments = process.env.PRICE_SEGMENTS;
  if (envSegments) {
    try {
      const parsed = JSON.parse(envSegments);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        console.warn('PRICE_SEGMENTS deve ser um array não-vazio, usando segmentos padrão');
      } else {
        const valid = parsed.every(isValidSegment);
        if (!valid) {
          console.warn('PRICE_SEGMENTS contém segmentos inválidos (min >= 0 obrigatório, max > min quando presente), usando segmentos padrão');
        } else {
          return parsed;
        }
      }
    } catch {
      console.warn('PRICE_SEGMENTS JSON inválido, usando segmentos padrão');
    }
  }

  return [
    { min: 0, max: 100 },
    { min: 100, max: 150 },
    { min: 150, max: 200 },
    { min: 200, max: 300 },
    { min: 300, max: 500 },
    { min: 500, max: 800 },
    { min: 800, max: 1500 },
    { min: 1500, max: 3000 },
    { min: 3000 },
  ];
}

function parseProxyUrl(): string | undefined {
  const url = process.env.PROXY_URL;
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'socks5:', 'socks4:'].includes(parsed.protocol)) {
      console.warn(`PROXY_URL com protocolo não suportado (${parsed.protocol}), ignorando`);
      return undefined;
    }
    return url;
  } catch {
    console.warn('PROXY_URL inválido, ignorando');
    return undefined;
  }
}

export const CONFIG = {
  concurrency: parseInt(process.env.CONCURRENCY || '4'),

  airbnb: {
    baseUrl: 'https://www.airbnb.com.br',
    homeUrl: 'https://www.airbnb.com.br/',
    searchUrl: 'https://www.airbnb.com.br/s/Centro--Curitiba--Paran%C3%A1/homes',
    searchParams: {
      tab_id: 'home_tab',
      room_types: 'Entire home/apt',
      search_type: 'autocomplete_click',
    },
  },

  selectors: {
    listings: {
      item: 'a[href*="/rooms/"], a[href*="/stay/"]',
    },
    pagination: {
      nextButton:
        'a[aria-label*="próxima"], a[aria-label*="Próxima"], a[aria-label*="Next"], a[aria-label*="next"]',
      nextButtonFallbacks: [
        'a[aria-label*="próxima"]',
        'a[aria-label*="Próxima"]',
        'a[aria-label*="próxima página"]',
        'a[aria-label*="Próxima página"]',
        'a[aria-label*="Next"]',
        'a[aria-label*="next"]',
        'button[aria-label*="próxima"]',
        'button[aria-label*="Próxima"]',
        'nav a[href*="cursor"]:last-of-type',
        'nav a:last-of-type:not([aria-label*="anterior"]):not([aria-label*="Anterior"])',
      ],
    },
  },

  delays: {
    search: {
      min: parseInt(process.env.DELAY_MIN || '1500'),
      max: parseInt(process.env.DELAY_MAX || '2500'),
    },
    listing: {
      min: parseInt(process.env.LISTING_DELAY_MIN || '1000'),
      max: parseInt(process.env.LISTING_DELAY_MAX || '2000'),
    },
    pageLoad: {
      min: parseInt(process.env.PAGE_LOAD_MIN || '800'),
      max: parseInt(process.env.PAGE_LOAD_MAX || '1500'),
    },
    scrollSettle: {
      min: parseInt(process.env.SCROLL_SETTLE_MIN || '400'),
      max: parseInt(process.env.SCROLL_SETTLE_MAX || '800'),
    },
    retryBackoff: {
      initialDelay: 10000,
      maxDelay: 30000,
      multiplier: 1.5,
    },
  },

  pagination: {
    maxPages: parseInt(process.env.MAX_PAGES || '50'),
    listingsPerPage: 18,
  },

  segmentation: {
    maxListingsPerSegment: 270,
    maxSubdivisionDepth: 6,
    minSubdivisionRange: 3,
    subdivisionThreshold: 40,
  },

  retry: {
    maxRetries: parseInt(process.env.MAX_RETRIES || '5'),
    navigationRetries: parseInt(process.env.NAVIGATION_RETRIES || '3'),
  },

  output: {
    filePath: process.env.OUTPUT_FILE || 'data/listings.csv',
    headers: ['listing_id', 'url', 'titulo', 'localizacao', 'anfitriao', 'coordenadas', 'coletado_em'],
  },

  proxy: {
    url: parseProxyUrl(),
  },

  browser: {
    headless: true,
    restartEvery: parseInt(process.env.BROWSER_RESTART_EVERY || '100'),
  },

  timeouts: {
    navigation: parseInt(process.env.NAVIGATION_TIMEOUT || '180000'),
    paginationWait: parseInt(process.env.PAGINATION_WAIT || '30000'),
    defaultAction: parseInt(process.env.DEFAULT_ACTION_TIMEOUT || '180000'),
  },

  priceSegments: parsePriceSegments(),
};

export function getSearchUrl(
  pageNum?: number,
  cursor?: string,
  priceMin?: number,
  priceMax?: number,
): string {
  const url = new URL(CONFIG.airbnb.searchUrl);

  Object.entries(CONFIG.airbnb.searchParams).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  if (priceMin !== undefined) {
    url.searchParams.set('price_min', String(priceMin));
  }
  if (priceMax !== undefined) {
    url.searchParams.set('price_max', String(priceMax));
  }

  if (cursor) {
    url.searchParams.set('cursor', cursor);
  } else if (pageNum && pageNum > 1) {
    url.searchParams.set('items_offset', String((pageNum - 1) * CONFIG.pagination.listingsPerPage));
  }

  return url.toString();
}
