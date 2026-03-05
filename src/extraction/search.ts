import { Page } from 'playwright';
import { CONFIG } from '../config.js';

export async function extractResultCount(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]'));
      for (let i = 0; i < headings.length; i++) {
        const text = headings[i].textContent?.trim() || '';
        if (
          text.includes('acomodaç') ||
          text.includes('acomodação') ||
          text.includes('places') ||
          text.includes('accommodation')
        ) {
          return text;
        }
      }
      return null;
    });
  } catch {
    return null;
  }
}

export async function extractListingUrls(page: Page): Promise<string[]> {
  const urls = await page.evaluate((selector) => {
    const links = document.querySelectorAll<HTMLAnchorElement>(selector);
    const validUrls = Array.from(links)
      .map((link) => link.href)
      .filter((href) => href && (href.includes('/rooms/') || href.includes('/stay/')));

    return Array.from(new Set(validUrls));
  }, CONFIG.selectors.listings.item);

  return urls;
}

export async function hasNextPage(page: Page): Promise<boolean> {
  try {
    const fallbacks = CONFIG.selectors.pagination.nextButtonFallbacks;

    for (const selector of fallbacks) {
      const nextButton = await page.$(selector);
      if (nextButton !== null) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

export async function extractNextCursor(page: Page): Promise<string | null> {
  try {
    const fallbacks = CONFIG.selectors.pagination.nextButtonFallbacks;

    const cursor = await page.evaluate((selectors) => {
      for (const selector of selectors) {
        const nextButton = document.querySelector(selector);
        if (nextButton) {
          const href = nextButton.getAttribute('href') || '';

          if (!href) continue;

          const cursorMatch = href.match(/cursor=([^&]+)/);
          if (cursorMatch) {
            return { type: 'cursor', value: decodeURIComponent(cursorMatch[1]) };
          }

          const offsetMatch = href.match(/items_offset=(\d+)/);
          if (offsetMatch) {
            return { type: 'offset', value: offsetMatch[1] };
          }
        }
      }

      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const content = script.textContent || '';
        if (content.includes('cursor')) {
          const match = content.match(/"cursor"\s*:\s*"([^"]+)"/);
          if (match) {
            return { type: 'cursor', value: match[1] };
          }
        }
      }

      return null;
    }, fallbacks);

    if (!cursor) {
      return null;
    }

    if (cursor.type === 'cursor') {
      return cursor.value;
    }

    return null;
  } catch (error) {
    console.error('Erro ao extrair cursor:', error);
    return null;
  }
}
