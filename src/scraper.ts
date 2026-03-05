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
    console.log(`${this.timePrefix()} Inicializando navegador com modo stealth...`);
    this.browser = await initBrowser({
      proxyUrl: CONFIG.proxy.url,
      headless: CONFIG.browser.headless,
    });

    this.context = await createContext(this.browser);
    console.log(`${this.timePrefix()} Navegador inicializado com sucesso`);
  }

  private async close(): Promise<void> {
    try { if (this.context) await this.context.close(); } catch { /* already dead */ }
    try { if (this.browser) await this.browser.close(); } catch { /* already dead */ }
    this.context = null;
    this.browser = null;
    console.log(`${this.timePrefix()} Navegador fechado`);
  }

  private isBrowserDead(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return (
      msg.includes('Target closed') ||
      msg.includes('browser has been closed') ||
      msg.includes('Browser closed') ||
      msg.includes('Connection closed') ||
      msg.includes('Browser has been disconnected') ||
      msg.includes('Protocol error')
    );
  }

  private async ensureBrowser(): Promise<void> {
    if (this.browser?.isConnected() && this.context) return;

    console.log(`\n${this.timePrefix()} [RECOVERY] Navegador morto, reinicializando...`);
    await this.close();
    await this.init();
    await randomDelay(2000, 4000);
    console.log(`${this.timePrefix()} [RECOVERY] Navegador restaurado`);
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
    console.log(`${this.timePrefix()} BUSCA ADAPTATIVA POR FAIXA DE PREÇO`);
    console.log(`${this.timePrefix()} Segmentos iniciais: ${segments.length}`);
    console.log(`${this.timePrefix()} Máximo de páginas por segmento: ${CONFIG.pagination.maxPages}`);
    console.log(`${this.timePrefix()} Subdivisão automática para segmentos com >${CONFIG.segmentation.maxListingsPerSegment} resultados`);
    console.log(`${this.timePrefix()} ${'='.repeat(60)}`);

    for (const segment of segments) {
      try {
        await this.ensureBrowser();
        await this.processSegmentAdaptive(segment, 0);
      } catch (error) {
        const label = getSegmentLabel(segment);
        console.error(`${this.timePrefix()} [ERRO] Falha no segmento ${label}, continuando:`, error);
        if (this.isBrowserDead(error)) {
          await this.ensureBrowser();
        }
      }
    }

    console.log(`\n${this.timePrefix()} ${'='.repeat(60)}`);
    console.log(`${this.timePrefix()} RESULTADO DA BUSCA`);
    console.log(`${this.timePrefix()} Total de URLs únicas coletadas: ${this.collectedById.size}`);
    console.log(`${this.timePrefix()} Segmentos processados: ${this.stats.totalSegments}`);
    console.log(`${this.timePrefix()} Páginas de busca processadas: ${this.stats.totalPages}`);
    console.log(`${this.timePrefix()} ${'='.repeat(60)}`);
  }

  private async processSegmentAdaptive(segment: PriceSegment, depth: number): Promise<void> {
    if (!this.context) throw new Error('Context não inicializado');

    this.segmentIndex++;
    const label = getSegmentLabel(segment);
    const indent = '  '.repeat(depth);
    console.log(`\n${this.timePrefix()} ${indent}[SEGMENTO ${this.segmentIndex}] Faixa: ${label} (profundidade: ${depth})`);

    const page = await createPage(this.context);

    try {
      const firstPage = await this.loadSegmentFirstPage(page, segment, indent);
      if (!firstPage) return;

      const { resultCount, urls: page1Urls } = firstPage;

      if (shouldSubdivide(resultCount, segment, depth)) {
        const subSegments = subdivideSegment(segment);
        const subLabels = subSegments.map((s) => getSegmentLabel(s)).join(', ');
        console.log(`${this.timePrefix()} ${indent}  → ${resultCount} resultados excedem o limite. Subdividindo em: ${subLabels}`);
        await page.close();

        for (const sub of subSegments) {
          await this.processSegmentAdaptive(sub, depth + 1);
          await randomDelay(CONFIG.delays.search.min, CONFIG.delays.search.max);
        }
        return;
      }

      const effectiveMaxPages = computeEffectiveMaxPages(resultCount);

      const paginated = await this.collectPaginatedUrls(page, segment, effectiveMaxPages, indent);

      const segmentUrls = [...page1Urls, ...paginated.urls];
      this.stats.totalPages += 1 + paginated.pagesProcessed;

      let newCount = 0;
      for (const url of segmentUrls) {
        const id = extractListingIdFromUrl(url);
        if (!this.collectedById.has(id)) {
          this.collectedById.set(id, url);
          newCount++;
        }
      }
      this.stats.totalSegments++;

      console.log(
        `${this.timePrefix()} ${indent}[SEGMENTO] ${segmentUrls.length} URLs, ${newCount} novas (total: ${this.collectedById.size})`,
      );

      if (paginated.reachedLimit) {
        console.log(
          `${this.timePrefix()} ${indent}  ⚠ Atingiu limite de ${effectiveMaxPages} páginas para ${label}`,
        );
      }
    } finally {
      if (!page.isClosed()) {
        await page.close();
      }
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

  private async restartBrowser(): Promise<void> {
    console.log(`\n${this.timePrefix()} [RESTART] Reiniciando navegador preventivamente (limpeza de memória)...`);
    await this.close();
    await this.init();
    await randomDelay(2000, 4000);
    console.log(`${this.timePrefix()} [RESTART] Navegador reiniciado`);
  }

  private async visitAndExtract(urls: string[]): Promise<void> {
    console.log(`\n${this.timePrefix()} [EXTRAÇÃO] Iniciando visita a ${urls.length} listings únicos...`);

    const startTime = Date.now();
    let page: Page | null = null;
    let sinceRestart = 0;

    const getPage = async (): Promise<Page> => {
      if (
        CONFIG.browser.restartEvery > 0 &&
        sinceRestart >= CONFIG.browser.restartEvery
      ) {
        if (page && !page.isClosed()) await page.close();
        page = null;
        await this.restartBrowser();
        sinceRestart = 0;
      }

      await this.ensureBrowser();
      if (page && !page.isClosed()) return page;
      page = await createPage(this.context!);
      return page;
    };

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const remainingCount = urls.length - i;

      let remainingStr = '--';
      if (i > 0) {
        const avgMs = (Date.now() - startTime) / i;
        remainingStr = this.formatEta(avgMs * remainingCount);
      }

      console.log(`${this.timePrefix(remainingStr)} [${i + 1}/${urls.length}] Visitando: ${url}`);

      try {
        const currentPage = await getPage();
        const data = await withRetry(
          () => this.visitListing(currentPage, url),
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
          const rem = i < urls.length - 1 && i > 0
            ? this.formatEta(((Date.now() - startTime) / i) * (urls.length - i - 1))
            : '--';
          console.log(`${this.timePrefix(rem)}     ✓ ${data.titulo} | ${data.localizacao} | ID: ${data.listing_id}`);
        } else {
          this.stats.failedExtractions++;
          console.log(`${this.timePrefix()}     ✗ Falha ao extrair dados`);
        }
      } catch (error) {
        this.stats.failedExtractions++;
        console.error(`${this.timePrefix()}     ✗ Falha após ${CONFIG.retry.maxRetries} tentativas`);

        if (this.isBrowserDead(error)) {
          console.log(`${this.timePrefix()}     [RECOVERY] Browser morreu durante extração, recriando...`);
          page = null;
          sinceRestart = 0;
          await this.ensureBrowser();
          page = await createPage(this.context!);
        }
      }

      this.stats.totalListings++;
      sinceRestart++;

      if (i < urls.length - 1) {
        await randomDelay(CONFIG.delays.listing.min, CONFIG.delays.listing.max);
      }
    }

    if (page && !page.isClosed()) {
      await page.close();
    }
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
