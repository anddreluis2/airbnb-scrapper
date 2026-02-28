import { Page } from 'playwright';
import { ListingData } from '../types.js';
import { extractMapCoordinates } from './coordinates.js';

export async function extractListingData(
  page: Page,
  url: string,
): Promise<ListingData | null> {
  try {
    const listingId = extractListingIdFromUrl(url);

    const titulo = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1?.textContent?.trim() || '';
    });

    let localizacao = await page.evaluate(() => {
      const locationButton = document.querySelector(
        '[data-testid="pdp-show-all-button"]',
      );
      if (locationButton) {
        return locationButton.textContent?.trim() || '';
      }

      const neighborhood = document.querySelector(
        '[data-testid="pdp-neighborhood"]',
      );
      if (neighborhood) {
        return neighborhood.textContent?.trim() || '';
      }

      const locationLink = document.querySelector(
        '[data-testid="pdp-location-link"]',
      );
      if (locationLink) {
        return locationLink.textContent?.trim() || '';
      }

      const allText = document.body.innerText;
      const lines = allText.split('\n');
      for (const line of lines) {
        if (
          (line.includes('Curitiba') || line.includes('Centro')) &&
          line.length > 5 &&
          line.length < 100
        ) {
          return line.trim();
        }
      }

      return '';
    });

    if (!localizacao) {
      localizacao = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          const content = script.textContent || '';
          if (content.includes('neighborhood') || content.includes('location')) {
            const match = content.match(/"neighborhood":"([^"]+)"/);
            if (match) {
              return match[1];
            }
          }
        }
        return '';
      });
    }

    const coordenadas = await extractMapCoordinates(page);
    const coletado_em = new Date().toISOString().split('T')[0];

    return {
      listing_id: listingId,
      url,
      titulo: titulo || 'N/A',
      localizacao: localizacao || 'N/A',
      coordenadas,
      coletado_em,
    };
  } catch (error) {
    console.error(`Erro ao extrair dados de ${url}:`, error);
    return null;
  }
}

export function extractListingIdFromUrl(url: string): string {
  const match = url.match(/\/rooms\/(\d+)/);
  return match ? match[1] : url.split('/').pop() || 'unknown';
}
