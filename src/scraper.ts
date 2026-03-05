import { Browser, BrowserContext, Page } from 'playwright';
import { initBrowser, createContext, createPage } from './browser/launcher.js';
import { randomDelay, humanizedScroll, scrollToBottom } from './browser/stealth.js';
import {
  extractListingUrls,
  extractResultCount,
  hasNextPage,
  extractNextCursor,
} from './extraction/search.js';
import { extractListingData, extractListingIdFromUrl } from './extraction/listing.js';
import { CSVWriter } from './output/csv-writer.js';
import { withRetry } from './utils/retry.js';
import { CONFIG, getSearchUrl } from './config.js';
import {
  getSegmentLabel,
  parseResultCount,
  subdivideSegment,
  shouldSubdivide,
  computeEffectiveMaxPages,
} from './segmentation.js';
import { ScraperStats, ListingData, PriceSegment } from './types.js';
import { WorkerPool } from './worker-pool.js';

interface SegmentFirstPageResult {
  resultCount: number | null;
  urls: string[];
}

interface PaginatedCollectionResult {
  urls: string[];
  pagesProcessed: number;
  reachedLimit: boolean;
}

export class AirbnbScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pool: WorkerPool | null = null;
  private csvWriter: CSVWriter;
  private collectedById = new Map<string, string>();
  private scrapedIds: Set<string>;
  private segmentIndex = 0;
  private runStartTime = 0;
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
    this.scrapedIds = this.csvWriter.loadExistingIds();
    if (this.scrapedIds.size > 0) {
      console.log(`${this.timePrefix()} [RESUME] ${this.scrapedIds.size} listings já extraídos encontrados no CSV, serão ignorados`);
    }
  }

  async run(): Promise<void> {
    this.runStartTime = Date.now();
    try {
      await this.init();
      await this.warmup();

      await this.collectAllListingUrls();

      const pendingUrls = Array.from(this.collectedById.entries())
        .filter(([id]) => !this.scrapedIds.has(id))
        .map(([, url]) => url);

      this.stats.uniqueUrls = this.collectedById.size;
      const skipped = this.collectedById.size - pendingUrls.length;
      if (skipped > 0) {
        console.log(`${this.timePrefix()} [DEDUP] ${skipped} listings já extraídos, ${pendingUrls.length} pendentes`);
      }

      await this.visitAndExtract(pendingUrls);
      this.printStats();
    } catch (error) {
      console.error('Erro fatal durante o scraping:', error);
      throw error;
    } finally {
      await this.close();
    }
  }

  private async init(): Promise<void> {
    console.log(`${this.timePrefix()} Inicializando navegador com ${CONFIG.concurrency} workers...`);
    this.browser = await initBrowser({
      proxyUrl: CONFIG.proxy.url,
      headless: CONFIG.browser.headless,
    });

    this.pool = new WorkerPool(this.browser, CONFIG.concurrency);
    await this.pool.init();

    // Keep a single context for warmup
    this.context = await createContext(this.browser);
    console.log(`${this.timePrefix()} Navegador inicializado com ${CONFIG.concurrency} workers`);
  }

  private async close(): Promise<void> {
    try { if (this.pool) await this.pool.close(); } catch { /* already dead */ }
    try { if (this.context) await this.context.close(); } catch { /* already dead */ }
    try { if (this.browser) await this.browser.close(); } catch { /* already dead */ }
    this.pool = null;
    this.context = null;
    this.browser = null;
    console.log(`${this.timePrefix()} Navegador fechado`);
  }

  private async gotoWithRetry(
    page: Page,
    url: string,
    context?: string,
  ): Promise<void> {
    const maxRetries = CONFIG.retry.navigationRetries;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: CONFIG.timeouts.navigation,
        });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries) {
          const waitMs = 5000 * attempt;
          console.warn(`${this.timePrefix()}     ! Timeout/navegação (tentativa ${attempt}/${maxRetries})${context ? ` ${context}` : ''}, retry em ${waitMs}ms...`);
          await randomDelay(waitMs, waitMs + 2000);
        }
      }
    }
    throw lastError;
  }

  private async warmup(): Promise<void> {
    console.log(`\n${this.timePrefix()} [WARMUP] Visitando homepage para construir cookies...`);
    if (!this.context) throw new Error('Context não inicializado');

    const page = await createPage(this.context);
    try {
      await this.gotoWithRetry(page, CONFIG.airbnb.homeUrl);

      await randomDelay(2000, 4000);
      await humanizedScroll(page);
      console.log(`${this.timePrefix()} [WARMUP] Cookies construídos com sucesso`);
    } finally {
      await page.close();
    }
  }

  private async loadSegmentFirstPage(
    page: Page,
    segment: PriceSegment,
    indent: string,
  ): Promise<SegmentFirstPageResult | null> {
    const searchUrl = getSearchUrl(1, undefined, segment.min, segment.max);
    await this.gotoWithRetry(page, searchUrl, `página 1`);

    await randomDelay(CONFIG.delays.pageLoad.min, CONFIG.delays.pageLoad.max);
    await humanizedScroll(page);

    const resultText = await extractResultCount(page);
    const resultCount = parseResultCount(resultText);
    if (resultText) {
      const cleanText = resultText.replace(/\n/g, ' ').trim();
      console.log(`${this.timePrefix()} ${indent}  Resultados: ${cleanText}`);
    }

    const urls = await extractListingUrls(page);
    console.log(`${this.timePrefix()} ${indent}  Página 1: ${urls.length} listings`);

    if (urls.length === 0) {
      console.log(`${this.timePrefix()} ${indent}  Nenhum resultado, pulando segmento`);
      return null;
    }

    return { resultCount, urls };
  }

  private async awaitPaginationElement(page: Page): Promise<boolean> {
    try {
      await page.waitForSelector(CONFIG.selectors.pagination.nextButton, {
        timeout: CONFIG.timeouts.paginationWait,
        state: 'attached',
      });
    } catch {
      // no pagination element found
    }
    return hasNextPage(page);
  }

  private async collectPaginatedUrls(
    page: Page,
    segment: PriceSegment,
    effectiveMaxPages: number,
    indent: string,
  ): Promise<PaginatedCollectionResult> {
    const urls: string[] = [];
    let pageNum = 1;
    let successfulExtraPages = 0;

    await scrollToBottom(page);
    await randomDelay(CONFIG.delays.scrollSettle.min, CONFIG.delays.scrollSettle.max);

    let hasMore = await this.awaitPaginationElement(page);

    while (hasMore && pageNum < effectiveMaxPages) {
      const cursor = await extractNextCursor(page);
      pageNum++;

      const nextUrl = getSearchUrl(
        pageNum,
        cursor || undefined,
        segment.min,
        segment.max,
      );

      try {
        await this.gotoWithRetry(page, nextUrl, `página ${pageNum}`);

        await randomDelay(CONFIG.delays.pageLoad.min, CONFIG.delays.pageLoad.max);
        await humanizedScroll(page);

        const pageUrls = await extractListingUrls(page);
        console.log(`${this.timePrefix()} ${indent}  Página ${pageNum}: ${pageUrls.length} listings`);

        if (pageUrls.length === 0) break;

        urls.push(...pageUrls);
        successfulExtraPages++;

        await scrollToBottom(page);
        await randomDelay(CONFIG.delays.scrollSettle.min, CONFIG.delays.scrollSettle.max);

        hasMore = await this.awaitPaginationElement(page);

        if (hasMore && pageNum < effectiveMaxPages) {
          await randomDelay(CONFIG.delays.search.min, CONFIG.delays.search.max);
        }
      } catch (error) {
        console.error(`${this.timePrefix()} ${indent}  Erro na página ${pageNum}:`, error);
        break;
      }
    }

    return {
      urls,
      pagesProcessed: successfulExtraPages,
      reachedLimit: hasMore && pageNum >= effectiveMaxPages,
    };
  }

  private async collectAllListingUrls(): Promise<void> {
    const segments = CONFIG.priceSegments;

    console.log(`\n${this.timePrefix()} ${'='.repeat(60)}`);
    console.log(`${this.timePrefix()} BUSCA ADAPTATIVA POR FAIXA DE PRECO`);
    console.log(`${this.timePrefix()} Segmentos iniciais: ${segments.length}`);
    console.log(`${this.timePrefix()} Workers: ${CONFIG.concurrency}`);
    console.log(`${this.timePrefix()} Maximo de paginas por segmento: ${CONFIG.pagination.maxPages}`);
    console.log(`${this.timePrefix()} ${'='.repeat(60)}`);

    if (!this.pool) throw new Error('Pool nao inicializado');

    await this.pool.runAll(segments, async (ctx, segment, workerIdx) => {
      try {
        const urls = await this.processSegmentWithContext(ctx, segment, 0, workerIdx);
        for (const [id, url] of urls) {
          if (!this.collectedById.has(id)) {
            this.collectedById.set(id, url);
          }
        }
      } catch (error) {
        const label = getSegmentLabel(segment);
        console.error(`${this.timePrefix()} [W${workerIdx}][ERRO] Falha no segmento ${label}:`, error);
      }
    });

    console.log(`\n${this.timePrefix()} ${'='.repeat(60)}`);
    console.log(`${this.timePrefix()} RESULTADO DA BUSCA`);
    console.log(`${this.timePrefix()} Total de URLs unicas coletadas: ${this.collectedById.size}`);
    console.log(`${this.timePrefix()} Segmentos processados: ${this.stats.totalSegments}`);
    console.log(`${this.timePrefix()} Paginas de busca processadas: ${this.stats.totalPages}`);
    console.log(`${this.timePrefix()} ${'='.repeat(60)}`);
  }

  private async processSegmentWithContext(
    ctx: BrowserContext,
    segment: PriceSegment,
    depth: number,
    workerIdx: number,
  ): Promise<Map<string, string>> {
    const collected = new Map<string, string>();
    this.segmentIndex++;
    const label = getSegmentLabel(segment);
    const indent = '  '.repeat(depth);
    const prefix = `[W${workerIdx}]`;

    console.log(`\n${this.timePrefix()} ${prefix}${indent}[SEGMENTO] Faixa: ${label} (profundidade: ${depth})`);

    const page = await createPage(ctx);
    try {
      const firstPage = await this.loadSegmentFirstPage(page, segment, `${prefix}${indent}`);
      if (!firstPage) return collected;

      const { resultCount, urls: page1Urls } = firstPage;

      if (shouldSubdivide(resultCount, segment, depth)) {
        const subSegments = subdivideSegment(segment);
        const subLabels = subSegments.map((s) => getSegmentLabel(s)).join(', ');
        console.log(`${this.timePrefix()} ${prefix}${indent}  -> ${resultCount} resultados excedem o limite. Subdividindo em: ${subLabels}`);
        await page.close();

        for (const sub of subSegments) {
          const subResult = await this.processSegmentWithContext(ctx, sub, depth + 1, workerIdx);
          for (const [id, url] of subResult) collected.set(id, url);
          await randomDelay(CONFIG.delays.search.min, CONFIG.delays.search.max);
        }
        return collected;
      }

      const effectiveMaxPages = computeEffectiveMaxPages(resultCount);
      const paginated = await this.collectPaginatedUrls(page, segment, effectiveMaxPages, `${prefix}${indent}`);

      const segmentUrls = [...page1Urls, ...paginated.urls];
      this.stats.totalPages += 1 + paginated.pagesProcessed;
      this.stats.totalSegments++;

      for (const url of segmentUrls) {
        const id = extractListingIdFromUrl(url);
        collected.set(id, url);
      }

      console.log(
        `${this.timePrefix()} ${prefix}${indent}[SEGMENTO] ${segmentUrls.length} URLs, ${collected.size} novas (total acumulado: ${this.collectedById.size + collected.size})`,
      );

      return collected;
    } finally {
      if (!page.isClosed()) await page.close();
    }
  }

  private formatEta(ms: number): string {
    const totalSeconds = Math.ceil(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
    return `${s}s`;
  }

  private formatElapsed(): string {
    if (this.runStartTime === 0) return '0s';
    const ms = Date.now() - this.runStartTime;
    return this.formatEta(ms);
  }

  private timePrefix(remaining?: string): string {
    const elapsed = this.formatElapsed();
    const rem = remaining !== undefined && remaining !== null ? remaining : '--';
    return `[elapsed: ${elapsed} | remaining: ${rem}]`;
  }

  private async visitAndExtract(urls: string[]): Promise<void> {
    console.log(`\n${this.timePrefix()} [EXTRACAO] Iniciando visita a ${urls.length} listings com ${CONFIG.concurrency} workers...`);

    if (!this.pool) throw new Error('Pool nao inicializado');

    const startTime = Date.now();
    let processedCount = 0;

    await this.pool.runAll(urls, async (ctx, url, workerIdx) => {
      processedCount++;
      const currentCount = processedCount;
      const remaining = urls.length - currentCount;
      let remainingStr = '--';
      if (currentCount > CONFIG.concurrency) {
        const avgMs = (Date.now() - startTime) / (currentCount - 1);
        remainingStr = this.formatEta((avgMs * remaining) / CONFIG.concurrency);
      }

      const prefix = `[W${workerIdx}]`;
      console.log(`${this.timePrefix(remainingStr)} ${prefix}[${currentCount}/${urls.length}] Visitando: ${url}`);

      const page = await createPage(ctx);
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
          this.scrapedIds.add(data.listing_id);
          this.stats.successfulExtractions++;
          console.log(`${this.timePrefix()} ${prefix}  OK ${data.titulo} | ${data.listing_id}`);
        } else {
          this.stats.failedExtractions++;
          console.log(`${this.timePrefix()} ${prefix}  FAIL ao extrair dados`);
        }
      } catch (error) {
        this.stats.failedExtractions++;
        console.error(`${this.timePrefix()} ${prefix}  FAIL apos ${CONFIG.retry.maxRetries} tentativas`);
      } finally {
        if (!page.isClosed()) await page.close();
      }

      this.stats.totalListings++;

      await randomDelay(CONFIG.delays.listing.min, CONFIG.delays.listing.max);
    });
  }

  private async visitListing(page: Page, url: string): Promise<ListingData | null> {
    await this.gotoWithRetry(page, url);

    await randomDelay(CONFIG.delays.scrollSettle.min, CONFIG.delays.scrollSettle.max);
    await humanizedScroll(page);

    return extractListingData(page, url);
  }

  private printStats(): void {
    console.log(`\n${this.timePrefix('0s')} ${'='.repeat(60)}`);
    console.log(`${this.timePrefix('0s')} ESTATÍSTICAS DA COLETA`);
    console.log(`${this.timePrefix('0s')} ${'='.repeat(60)}`);
    console.log(`${this.timePrefix('0s')} Segmentos de preço processados: ${this.stats.totalSegments}`);
    console.log(`${this.timePrefix('0s')} Páginas de busca processadas: ${this.stats.totalPages}`);
    console.log(`${this.timePrefix('0s')} URLs únicas coletadas: ${this.stats.uniqueUrls}`);
    console.log(`${this.timePrefix('0s')} Total de listagens visitadas: ${this.stats.totalListings}`);
    console.log(`${this.timePrefix('0s')} Extrações bem-sucedidas: ${this.stats.successfulExtractions}`);
    console.log(`${this.timePrefix('0s')} Extrações falhadas: ${this.stats.failedExtractions}`);
    console.log(`${this.timePrefix('0s')} Taxa de sucesso: ${this.getSuccessRate().toFixed(1)}%`);
    console.log(`${this.timePrefix('0s')} Arquivo de saída: ${this.csvWriter.getFilePath()}`);
    console.log(`${this.timePrefix('0s')} Total de registros salvos: ${this.csvWriter.getRowCount()}`);
    console.log(`${this.timePrefix('0s')} ${'='.repeat(60)}`);
  }

  private getSuccessRate(): number {
    if (this.stats.totalListings === 0) return 0;
    return (this.stats.successfulExtractions / this.stats.totalListings) * 100;
  }
}
