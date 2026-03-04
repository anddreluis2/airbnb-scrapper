import { PriceSegment } from './types.js';

function parsePriceSegments(): PriceSegment[] {
  const envSegments = process.env.PRICE_SEGMENTS;
  if (envSegments) {
    try {
      return JSON.parse(envSegments);
    } catch {
      console.warn('PRICE_SEGMENTS inválido, usando segmentos padrão');
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

export const CONFIG = {
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
      min: parseInt(process.env.DELAY_MIN || '4000'),
      max: parseInt(process.env.DELAY_MAX || '8000'),
    },
    listing: {
      min: parseInt(process.env.LISTING_DELAY_MIN || '3000'),
      max: parseInt(process.env.LISTING_DELAY_MAX || '6000'),
    },
    pageLoad: { min: 1500, max: 2500 },
    scrollSettle: { min: 800, max: 1500 },
    retryBackoff: {
      initialDelay: 30000,
      maxDelay: 60000,
      multiplier: 1.5,
    },
  },

  pagination: {
    maxPages: parseInt(process.env.MAX_PAGES || '15'),
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
  },

  output: {
    filePath: process.env.OUTPUT_FILE || 'data/listings.csv',
    headers: ['listing_id', 'url', 'titulo', 'localizacao', 'anfitriao', 'coordenadas', 'coletado_em'],
  },

  proxy: {
    url: process.env.PROXY_URL,
  },

  browser: {
    headless: true,
    restartEvery: parseInt(process.env.BROWSER_RESTART_EVERY || '100'),
  },

  timeouts: {
    navigation: 90000,
    paginationWait: 20000,
    defaultAction: 120000,
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
    url.searchParams.set('items_offset', String((pageNum - 1) * 20));
  }

  return url.toString();
}
