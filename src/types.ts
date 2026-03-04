export interface ListingData {
  listing_id: string;
  url: string;
  titulo: string;
  localizacao: string;
  anfitriao: string;
  coordenadas: string | null;
  coletado_em: string;
}

export interface ScraperStats {
  totalListings: number;
  successfulExtractions: number;
  failedExtractions: number;
  totalPages: number;
  totalSegments: number;
  uniqueUrls: number;
}

export interface BrowserConfig {
  proxyUrl?: string;
  headless?: boolean;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  multiplier: number;
}

export interface PriceSegment {
  min: number;
  max?: number;
}
