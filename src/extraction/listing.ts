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

    const anfitriao = await extractHostName(page);
    const coordenadas = await extractMapCoordinates(page);
    const coletado_em = new Date().toISOString().split('T')[0];

    return {
      listing_id: listingId,
      url,
      titulo: titulo || 'N/A',
      localizacao: localizacao || 'N/A',
      anfitriao: anfitriao || 'N/A',
      coordenadas,
      coletado_em,
    };
  } catch (error) {
    console.error(`Erro ao extrair dados de ${url}:`, error);
    return null;
  }
}

async function extractHostName(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      const hostHeading = Array.from(
        document.querySelectorAll('h2, h3, [data-testid*="host"]'),
      );
      for (const el of hostHeading) {
        const text = el.textContent?.trim() || '';
        const match = text.match(
          /(?:Anfitri(?:ão|ã)|Hosted by|Host[ea]do por)[:\s]+(.+)/i,
        );
        if (match) return match[1].trim();
      }

      const hostSection = document.querySelector(
        '[data-testid="host-profile"]',
      );
      if (hostSection) {
        const name = hostSection.querySelector('h2, h3, [class*="name"]');
        if (name?.textContent?.trim()) return name.textContent.trim();
      }

      const allText = document.body.innerText;
      const lines = allText.split('\n');
      for (const line of lines) {
        const match = line.match(
          /(?:Anfitri(?:ão|ã)|Hosted by|Host[ea]do por)[:\s]+(.+)/i,
        );
        if (match) return match[1].trim();
      }

      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const content = script.textContent || '';
        if (content.includes('hostName') || content.includes('host_name')) {
          const m =
            content.match(/"hostName"\s*:\s*"([^"]+)"/) ||
            content.match(/"host_name"\s*:\s*"([^"]+)"/);
          if (m) return m[1];
        }
      }

      return null;
    });
  } catch {
    return null;
  }
}

export function extractListingIdFromUrl(url: string): string {
  const match = url.match(/\/rooms\/(\d+)/);
  return match ? match[1] : url.split('/').pop() || 'unknown';
}
