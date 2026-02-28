import { Browser, BrowserContext, Page } from 'playwright';
import { initBrowser, createContext, createPage } from './browser/launcher.js';
import { randomDelay, humanizedScroll, scrollToBottom } from './browser/stealth.js';
import {
  extractListingUrls,
  extractListingData,
  hasNextPage,
  extractNextCursor,
  extractTotalPages,
} from './extraction/index.js';
import { CSVWriter } from './output/csv-writer.js';
import { withRetry } from './utils/retry.js';
import { CONFIG, getSearchUrl } from './config.js';
import { ScraperStats, ListingData } from './types.js';

export class AirbnbScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private csvWriter: CSVWriter;
  private stats: ScraperStats = {
    totalListings: 0,
    successfulExtractions: 0,
    failedExtractions: 0,
    totalPages: 0,
  };

  constructor() {
    this.csvWriter = new CSVWriter();
  }

  async run(): Promise<void> {
    try {
      await this.init();
      await this.warmup();
      await this.searchAndCollect();
      this.printStats();
    } catch (error) {
      console.error('Erro fatal durante o scraping:', error);
      throw error;
    } finally {
      await this.close();
    }
  }

  private async init(): Promise<void> {
    console.log('Inicializando navegador com modo stealth...');
    this.browser = await initBrowser({
      proxyUrl: CONFIG.proxy.url,
      headless: CONFIG.browser.headless,
    });

    this.context = await createContext(this.browser);
    console.log('Navegador inicializado com sucesso');
  }

  private async close(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    console.log('Navegador fechado');
  }

  private async warmup(): Promise<void> {
    console.log('\n[WARMUP] Visitando homepage para construir cookies...');
    if (!this.context) throw new Error('Context não inicializado');

    const page = await createPage(this.context);
    try {
      await page.goto(CONFIG.airbnb.homeUrl, {
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.timeouts.navigation,
      });

      await randomDelay(2000, 4000);
      await humanizedScroll(page);
      console.log('[WARMUP] Cookies construídos com sucesso');
    } finally {
      await page.close();
    }
  }

  private async searchAndCollect(): Promise<void> {
    console.log('\n[BUSCA] Iniciando coleta de listagens...');
    if (!this.context) throw new Error('Context não inicializado');

    const page = await createPage(this.context);
    const allUrls: string[] = [];

    try {
      let pageNum = 1;
      let cursor: string | null = null;
      let hasMore = true;

      while (hasMore && pageNum <= CONFIG.pagination.maxPages) {
        console.log(`\n[PÁGINA ${pageNum}] Navegando para página de busca...`);
        const searchUrl = getSearchUrl(pageNum, cursor || undefined);

        try {
          await page.goto(searchUrl, {
            waitUntil: 'domcontentloaded',
            timeout: CONFIG.timeouts.navigation,
          });

          await randomDelay(1500, 2500);
          await humanizedScroll(page);

          const urls = await extractListingUrls(page);
          console.log(`[PÁGINA ${pageNum}] Encontrados ${urls.length} listings`);

          allUrls.push(...urls);
          this.stats.totalPages++;

          if (pageNum === 1) {
            const totalAvailablePages = await extractTotalPages(page);
            if (totalAvailablePages) {
              console.log(
                `[BUSCA] Total de páginas disponíveis na busca: ${totalAvailablePages}`,
              );
            }
          }

          await scrollToBottom(page);
          await randomDelay(800, 1500);

          try {
            await page.waitForSelector(CONFIG.selectors.pagination.nextButton, {
              timeout: 10000,
              state: 'attached',
            });
          } catch {
            // pagination button not found, will check hasNextPage
          }

          hasMore = await hasNextPage(page);
          if (hasMore && pageNum < CONFIG.pagination.maxPages) {
            console.log(`[PÁGINA ${pageNum}] Extraindo cursor para próxima página...`);
            cursor = await extractNextCursor(page);
            if (!cursor) {
              console.log(
                `[PÁGINA ${pageNum}] Cursor não encontrado, usando offset-based pagination`,
              );
            }
            console.log(`[PÁGINA ${pageNum}] Aguardando antes da próxima página...`);
            await randomDelay(CONFIG.delays.search.min, CONFIG.delays.search.max);
            pageNum++;
          } else {
            hasMore = false;
          }
        } catch (error) {
          console.error(`Erro ao processar página ${pageNum}:`, error);
          break;
        }
      }

      const uniqueUrls = Array.from(new Set(allUrls));
      console.log(`\n[COLETA] Total de URLs únicas encontradas: ${uniqueUrls.length}`);
      console.log(`[COLETA] Total de páginas processadas: ${pageNum}`);

      await this.visitAndExtract(page, uniqueUrls);
    } finally {
      await page.close();
    }
  }

  private async visitAndExtract(page: Page, urls: string[]): Promise<void> {
    console.log('\n[EXTRAÇÃO] Iniciando visita aos listings...');

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const progress = `[${i + 1}/${urls.length}]`;

      console.log(`${progress} Visitando: ${url}`);

      try {
        const data = await withRetry(
          () => this.visitListing(page, url),
          {
            maxRetries: CONFIG.retry.maxRetries,
            initialDelay: CONFIG.delays.retryBackoff.initialDelay,
            maxDelay: CONFIG.delays.retryBackoff.maxDelay,
            multiplier: CONFIG.delays.retryBackoff.multiplier,
          },
        );

        if (data) {
          await this.csvWriter.appendRow(data);
          this.stats.successfulExtractions++;
          console.log(`    ✓ Localização: ${data.localizacao} | ID: ${data.listing_id}`);
        } else {
          this.stats.failedExtractions++;
          console.log('    ✗ Falha ao extrair dados');
        }
      } catch {
        this.stats.failedExtractions++;
        console.error(`    ✗ Falha após ${CONFIG.retry.maxRetries} tentativas`);
      }

      this.stats.totalListings++;

      if (i < urls.length - 1) {
        await randomDelay(CONFIG.delays.listing.min, CONFIG.delays.listing.max);
      }
    }
  }

  private async visitListing(page: Page, url: string): Promise<ListingData | null> {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.timeouts.navigation,
    });

    await randomDelay(800, 1500);
    await humanizedScroll(page);

    return extractListingData(page, url);
  }

  private printStats(): void {
    console.log('\n' + '='.repeat(60));
    console.log('ESTATÍSTICAS DA COLETA');
    console.log('='.repeat(60));
    console.log(`Páginas de busca processadas: ${this.stats.totalPages}`);
    console.log(`Total de listagens visitadas: ${this.stats.totalListings}`);
    console.log(`Extrações bem-sucedidas: ${this.stats.successfulExtractions}`);
    console.log(`Extrações falhadas: ${this.stats.failedExtractions}`);
    console.log(`Taxa de sucesso: ${this.getSuccessRate().toFixed(1)}%`);
    console.log(`Arquivo de saída: ${this.csvWriter.getFilePath()}`);
    console.log(`Total de registros salvos: ${this.csvWriter.getRowCount()}`);
    console.log('='.repeat(60));
  }

  private getSuccessRate(): number {
    if (this.stats.totalListings === 0) return 0;
    return (this.stats.successfulExtractions / this.stats.totalListings) * 100;
  }
}
