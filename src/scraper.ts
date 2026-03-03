import { Browser, BrowserContext, Page } from 'playwright';
import { initBrowser, createContext, createPage } from './browser/launcher.js';
import { randomDelay, humanizedScroll, scrollToBottom } from './browser/stealth.js';
import {
  extractListingUrls,
  extractListingData,
  extractResultCount,
  hasNextPage,
  extractNextCursor,
} from './extraction/index.js';
import { CSVWriter } from './output/csv-writer.js';
import { withRetry } from './utils/retry.js';
import { CONFIG, getSearchUrl } from './config.js';
import { ScraperStats, ListingData, PriceSegment } from './types.js';

const MAX_LISTINGS_PER_SEGMENT = 270;
const MAX_SUBDIVISION_DEPTH = 6;

export class AirbnbScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private csvWriter: CSVWriter;
  private allUrlsSet = new Set<string>();
  private segmentIndex = 0;
  private stats: ScraperStats = {
    totalListings: 0,
    successfulExtractions: 0,
    failedExtractions: 0,
    totalPages: 0,
    totalSegments: 0,
    uniqueUrls: 0,
  };

  constructor() {
    this.csvWriter = new CSVWriter();
  }

  async run(): Promise<void> {
    try {
      await this.init();
      await this.warmup();

      await this.collectAllListingUrls();
      this.stats.uniqueUrls = this.allUrlsSet.size;

      const uniqueUrls = Array.from(this.allUrlsSet);
      await this.visitAndExtract(uniqueUrls);
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

  private getSegmentLabel(segment: PriceSegment): string {
    return segment.max
      ? `R$${segment.min}-R$${segment.max}`
      : `R$${segment.min}+`;
  }

  private parseResultCount(text: string | null): number | null {
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

  private canSubdivide(segment: PriceSegment): boolean {
    if (segment.max === undefined) return false;
    return segment.max - segment.min > 3;
  }

  private subdivideSegment(segment: PriceSegment): PriceSegment[] {
    if (segment.max === undefined) return [segment];

    const range = segment.max - segment.min;
    const parts = range > 40 ? 3 : 2;
    const step = Math.floor(range / parts);

    const subSegments: PriceSegment[] = [];
    for (let i = 0; i < parts; i++) {
      const min = segment.min + i * step;
      const max = i === parts - 1 ? segment.max : segment.min + (i + 1) * step;
      subSegments.push({ min, max });
    }

    return subSegments;
  }

  private async collectAllListingUrls(): Promise<void> {
    const segments = CONFIG.priceSegments;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`BUSCA ADAPTATIVA POR FAIXA DE PREÇO`);
    console.log(`Segmentos iniciais: ${segments.length}`);
    console.log(`Máximo de páginas por segmento: ${CONFIG.pagination.maxPages}`);
    console.log(`Subdivisão automática para segmentos com >${MAX_LISTINGS_PER_SEGMENT} resultados`);
    console.log(`${'='.repeat(60)}`);

    for (const segment of segments) {
      await this.processSegmentAdaptive(segment, 0);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`RESULTADO DA BUSCA`);
    console.log(`Total de URLs únicas coletadas: ${this.allUrlsSet.size}`);
    console.log(`Segmentos processados: ${this.stats.totalSegments}`);
    console.log(`Páginas de busca processadas: ${this.stats.totalPages}`);
    console.log(`${'='.repeat(60)}`);
  }

  private async processSegmentAdaptive(segment: PriceSegment, depth: number): Promise<void> {
    if (!this.context) throw new Error('Context não inicializado');

    this.segmentIndex++;
    const label = this.getSegmentLabel(segment);
    const indent = '  '.repeat(depth);
    console.log(`\n${indent}[SEGMENTO ${this.segmentIndex}] Faixa: ${label} (profundidade: ${depth})`);

    const page = await createPage(this.context);

    try {
      const searchUrl = getSearchUrl(1, undefined, segment.min, segment.max);
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.timeouts.navigation,
      });

      await randomDelay(1500, 2500);
      await humanizedScroll(page);

      const resultText = await extractResultCount(page);
      const count = this.parseResultCount(resultText);
      if (resultText) {
        const cleanText = resultText.replace(/\n/g, ' ').trim();
        console.log(`${indent}  Resultados: ${cleanText}`);
      }

      const page1Urls = await extractListingUrls(page);
      console.log(`${indent}  Página 1: ${page1Urls.length} listings`);

      if (page1Urls.length === 0) {
        console.log(`${indent}  Nenhum resultado, pulando segmento`);
        return;
      }

      if (
        count !== null &&
        count > MAX_LISTINGS_PER_SEGMENT &&
        this.canSubdivide(segment) &&
        depth < MAX_SUBDIVISION_DEPTH
      ) {
        const subSegments = this.subdivideSegment(segment);
        const subLabels = subSegments.map((s) => this.getSegmentLabel(s)).join(', ');
        console.log(`${indent}  → ${count} resultados excedem o limite. Subdividindo em: ${subLabels}`);
        await page.close();

        for (const sub of subSegments) {
          await this.processSegmentAdaptive(sub, depth + 1);
          await randomDelay(CONFIG.delays.search.min, CONFIG.delays.search.max);
        }
        return;
      }

      const segmentUrls: string[] = [...page1Urls];
      this.stats.totalPages++;

      let effectiveMaxPages = CONFIG.pagination.maxPages;
      if (count !== null && count <= MAX_LISTINGS_PER_SEGMENT) {
        effectiveMaxPages = Math.min(Math.ceil(count / 18) + 2, CONFIG.pagination.maxPages);
      }

      await scrollToBottom(page);
      await randomDelay(800, 1500);

      let pageNum = 1;
      let cursor: string | null = null;

      try {
        await page.waitForSelector(CONFIG.selectors.pagination.nextButton, {
          timeout: 10000,
          state: 'attached',
        });
      } catch {
        // no pagination
      }

      let hasMore = await hasNextPage(page);

      while (hasMore && pageNum < effectiveMaxPages) {
        cursor = await extractNextCursor(page);
        pageNum++;

        const nextUrl = getSearchUrl(
          pageNum,
          cursor || undefined,
          segment.min,
          segment.max,
        );

        try {
          await page.goto(nextUrl, {
            waitUntil: 'domcontentloaded',
            timeout: CONFIG.timeouts.navigation,
          });

          await randomDelay(1500, 2500);
          await humanizedScroll(page);

          const pageUrls = await extractListingUrls(page);
          console.log(`${indent}  Página ${pageNum}: ${pageUrls.length} listings`);

          if (pageUrls.length === 0) break;

          segmentUrls.push(...pageUrls);
          this.stats.totalPages++;

          await scrollToBottom(page);
          await randomDelay(800, 1500);

          try {
            await page.waitForSelector(CONFIG.selectors.pagination.nextButton, {
              timeout: 10000,
              state: 'attached',
            });
          } catch {
            // no pagination
          }

          hasMore = await hasNextPage(page);

          if (hasMore && pageNum < effectiveMaxPages) {
            await randomDelay(CONFIG.delays.search.min, CONFIG.delays.search.max);
          }
        } catch (error) {
          console.error(`${indent}  Erro na página ${pageNum}:`, error);
          break;
        }
      }

      const newUrls = segmentUrls.filter((url) => !this.allUrlsSet.has(url));
      for (const url of segmentUrls) {
        this.allUrlsSet.add(url);
      }
      this.stats.totalSegments++;

      console.log(
        `${indent}[SEGMENTO] ${segmentUrls.length} URLs, ${newUrls.length} novas (total: ${this.allUrlsSet.size})`,
      );

      if (hasMore && pageNum >= effectiveMaxPages) {
        console.log(
          `${indent}  ⚠ Atingiu limite de ${effectiveMaxPages} páginas para ${label}`,
        );
      }
    } finally {
      if (!page.isClosed()) {
        await page.close();
      }
    }
  }

  private async visitAndExtract(urls: string[]): Promise<void> {
    if (!this.context) throw new Error('Context não inicializado');

    console.log(`\n[EXTRAÇÃO] Iniciando visita a ${urls.length} listings únicos...`);

    const page = await createPage(this.context);

    try {
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
            console.log(`    ✓ ${data.titulo} | ${data.localizacao} | ID: ${data.listing_id}`);
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
    } finally {
      await page.close();
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
    console.log(`Segmentos de preço processados: ${this.stats.totalSegments}`);
    console.log(`Páginas de busca processadas: ${this.stats.totalPages}`);
    console.log(`URLs únicas coletadas: ${this.stats.uniqueUrls}`);
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
