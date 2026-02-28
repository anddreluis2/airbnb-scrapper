import { Page } from 'playwright';

export async function extractMapCoordinates(page: Page): Promise<string | null> {
  try {
    const coordinates = await page.evaluate(() => {
      const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
      for (const iframe of iframes) {
        const src = iframe.getAttribute('src') || '';

        const centerMatch = src.match(/center=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (centerMatch) {
          return `${centerMatch[1]},${centerMatch[2]}`;
        }

        const llMatch = src.match(/ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (llMatch) {
          return `${llMatch[1]},${llMatch[2]}`;
        }
      }

      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const content = script.textContent || '';
        if (content.includes('latitude') && content.includes('longitude')) {
          const latMatch = content.match(/"latitude"\s*:\s*(-?\d+\.?\d+)/);
          const lngMatch = content.match(/"longitude"\s*:\s*(-?\d+\.?\d+)/);

          if (latMatch && lngMatch) {
            return `${latMatch[1]},${lngMatch[1]}`;
          }
        }
      }

      const mapContainer = document.querySelector(
        '[data-testid*="map"], [data-latitude], [data-longitude]',
      );
      if (mapContainer) {
        const lat = mapContainer.getAttribute('data-latitude');
        const lng = mapContainer.getAttribute('data-longitude');
        if (lat && lng) {
          return `${lat},${lng}`;
        }
      }

      return null;
    });

    return coordinates;
  } catch (error) {
    console.error('Erro ao extrair coordenadas do mapa:', error);
    return null;
  }
}
