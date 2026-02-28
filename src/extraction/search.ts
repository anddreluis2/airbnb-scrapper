import { Page } from 'playwright';
import { CONFIG } from '../config.js';

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

export async function extractTotalPages(page: Page): Promise<number | null> {
  try {
    const totalPages = await page.evaluate(() => {
      const pageLinks = Array.from(
        document.querySelectorAll('nav a[href*="cursor"], nav a[href*="items_offset"]'),
      );

      if (pageLinks.length > 0) {
        const pageNumbers = pageLinks
          .map((link) => {
            const text = link.textContent?.trim() || '';
            return parseInt(text, 10);
          })
          .filter((num) => !isNaN(num))
          .sort((a, b) => b - a);

        if (pageNumbers.length > 0) {
          return pageNumbers[0];
        }
      }

      const currentPageBtn = document.querySelector('a[aria-current="page"]');
      if (currentPageBtn) {
        const parent = currentPageBtn.closest('nav') || currentPageBtn.parentElement;
        if (parent) {
          const allLinks = Array.from(parent.querySelectorAll('a'));
          const pageNums = allLinks
            .map((link) => {
              const text = link.textContent?.trim() || '';
              return parseInt(text, 10);
            })
            .filter((num) => !isNaN(num))
            .sort((a, b) => b - a);

          if (pageNums.length > 0) {
            return pageNums[0];
          }
        }
      }

      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const content = script.textContent || '';
        if (content.includes('pagination') || content.includes('totalPages')) {
          const pageMatch = content.match(/"totalPages"\s*:\s*(\d+)/);
          if (pageMatch) {
            return parseInt(pageMatch[1], 10);
          }

          const lastPageMatch = content.match(/"pageCount"\s*:\s*(\d+)/);
          if (lastPageMatch) {
            return parseInt(lastPageMatch[1], 10);
          }
        }
      }

      return null;
    });

    return totalPages;
  } catch (error) {
    console.error('Erro ao extrair total de páginas:', error);
    return null;
  }
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
