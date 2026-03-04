import { Browser, BrowserContext, Page } from 'playwright';
import { initBrowser, createContext, createPage } from './browser/launcher.js';
import { randomDelay, humanizedScroll, scrollToBottom } from './browser/stealth.js';
import {
  extractListingUrls,
  extractListingData,
  extractListingIdFromUrl,
  extractResultCount,
  hasNextPage,
  extractNextCursor,
} from './extraction/index.js';
import { CSVWriter } from './output/csv-writer.js';
import { withRetry } from './utils/retry.js';
import { CONFIG, getSearchUrl } from './config.js';
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
      console.log(`[RESUME] ${this.scrapedIds.size} listings já extraídos encontrados no CSV, serão ignorados`);
    }
  }

  async run(): Promise<void> {
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
        console.log(`[DEDUP] ${skipped} listings já extraídos, ${pendingUrls.length} pendentes`);
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
    console.log('Inicializando navegador com modo stealth...');
    this.browser = await initBrowser({
      proxyUrl: CONFIG.proxy.url,
      headless: CONFIG.browser.headless,
    });

    this.context = await createContext(this.browser);
    console.log('Navegador inicializado com sucesso');
  }

  private async close(): Promise<void> {
    try { if (this.context) await this.context.close(); } catch { /* already dead */ }
    try { if (this.browser) await this.browser.close(); } catch { /* already dead */ }
    this.context = null;
    this.browser = null;
    console.log('Navegador fechado');
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

    console.log('\n[RECOVERY] Navegador morto, reinicializando...');
    await this.close();
    await this.init();
    await randomDelay(2000, 4000);
    console.log('[RECOVERY] Navegador restaurado');
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
    return segment.max - segment.min > CONFIG.segmentation.minSubdivisionRange;
  }

  private subdivideSegment(segment: PriceSegment): PriceSegment[] {
    if (segment.max === undefined) return [segment];

    const range = segment.max - segment.min;
    const parts = range > CONFIG.segmentation.subdivisionThreshold ? 3 : 2;
    const step = Math.floor(range / parts);

    const subSegments: PriceSegment[] = [];
    for (let i = 0; i < parts; i++) {
      const min = segment.min + i * step;
      const max = i === parts - 1 ? segment.max : segment.min + (i + 1) * step;
      subSegments.push({ min, max });
    }

    return subSegments;
  }

  private shouldSubdivide(
    count: number | null,
    segment: PriceSegment,
    depth: number,
  ): boolean {
    return (
      count !== null &&
      count > CONFIG.segmentation.maxListingsPerSegment &&
      this.canSubdivide(segment) &&
      depth < CONFIG.segmentation.maxSubdivisionDepth
    );
  }

  private computeEffectiveMaxPages(count: number | null): number {
    if (count !== null && count <= CONFIG.segmentation.maxListingsPerSegment) {
      const estimated = Math.ceil(count / CONFIG.pagination.listingsPerPage) + 2;
      return Math.min(estimated, CONFIG.pagination.maxPages);
    }
    return CONFIG.pagination.maxPages;
  }

  private async loadSegmentFirstPage(
    page: Page,
    segment: PriceSegment,
    indent: string,
  ): Promise<SegmentFirstPageResult | null> {
    const searchUrl = getSearchUrl(1, undefined, segment.min, segment.max);
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.timeouts.navigation,
    });

    await randomDelay(CONFIG.delays.pageLoad.min, CONFIG.delays.pageLoad.max);
    await humanizedScroll(page);

    const resultText = await extractResultCount(page);
    const resultCount = this.parseResultCount(resultText);
    if (resultText) {
      const cleanText = resultText.replace(/\n/g, ' ').trim();
      console.log(`${indent}  Resultados: ${cleanText}`);
    }

    const urls = await extractListingUrls(page);
    console.log(`${indent}  Página 1: ${urls.length} listings`);

    if (urls.length === 0) {
      console.log(`${indent}  Nenhum resultado, pulando segmento`);
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
        await page.goto(nextUrl, {
          waitUntil: 'domcontentloaded',
          timeout: CONFIG.timeouts.navigation,
        });

        await randomDelay(CONFIG.delays.pageLoad.min, CONFIG.delays.pageLoad.max);
        await humanizedScroll(page);

        const pageUrls = await extractListingUrls(page);
        console.log(`${indent}  Página ${pageNum}: ${pageUrls.length} listings`);

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
        console.error(`${indent}  Erro na página ${pageNum}:`, error);
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

    console.log(`\n${'='.repeat(60)}`);
    console.log(`BUSCA ADAPTATIVA POR FAIXA DE PREÇO`);
    console.log(`Segmentos iniciais: ${segments.length}`);
    console.log(`Máximo de páginas por segmento: ${CONFIG.pagination.maxPages}`);
    console.log(`Subdivisão automática para segmentos com >${CONFIG.segmentation.maxListingsPerSegment} resultados`);
    console.log(`${'='.repeat(60)}`);

    for (const segment of segments) {
      try {
        await this.ensureBrowser();
        await this.processSegmentAdaptive(segment, 0);
      } catch (error) {
        const label = this.getSegmentLabel(segment);
        console.error(`[ERRO] Falha no segmento ${label}, continuando:`, error);
        if (this.isBrowserDead(error)) {
          await this.ensureBrowser();
        }
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`RESULTADO DA BUSCA`);
    console.log(`Total de URLs únicas coletadas: ${this.collectedById.size}`);
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
      const firstPage = await this.loadSegmentFirstPage(page, segment, indent);
      if (!firstPage) return;

      const { resultCount, urls: page1Urls } = firstPage;

      if (this.shouldSubdivide(resultCount, segment, depth)) {
        const subSegments = this.subdivideSegment(segment);
        const subLabels = subSegments.map((s) => this.getSegmentLabel(s)).join(', ');
        console.log(`${indent}  → ${resultCount} resultados excedem o limite. Subdividindo em: ${subLabels}`);
        await page.close();

        for (const sub of subSegments) {
          await this.processSegmentAdaptive(sub, depth + 1);
          await randomDelay(CONFIG.delays.search.min, CONFIG.delays.search.max);
        }
        return;
      }

      const effectiveMaxPages = this.computeEffectiveMaxPages(resultCount);

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
        `${indent}[SEGMENTO] ${segmentUrls.length} URLs, ${newCount} novas (total: ${this.collectedById.size})`,
      );

      if (paginated.reachedLimit) {
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

  private formatEta(ms: number): string {
    const totalSeconds = Math.ceil(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
    return `${s}s`;
  }

  private async restartBrowser(): Promise<void> {
    console.log('\n[RESTART] Reiniciando navegador preventivamente (limpeza de memória)...');
    await this.close();
    await this.init();
    await randomDelay(2000, 4000);
    console.log('[RESTART] Navegador reiniciado');
  }

  private async visitAndExtract(urls: string[]): Promise<void> {
    console.log(`\n[EXTRAÇÃO] Iniciando visita a ${urls.length} listings únicos...`);

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
      const remaining = urls.length - i;

      let eta = '';
      if (i > 0) {
        const avgMs = (Date.now() - startTime) / i;
        eta = ` | ETA: ${this.formatEta(avgMs * remaining)}`;
      }

      console.log(`[${i + 1}/${urls.length}] Visitando: ${url}${eta}`);

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
          console.log(`    ✓ ${data.titulo} | ${data.localizacao} | ID: ${data.listing_id}`);
        } else {
          this.stats.failedExtractions++;
          console.log('    ✗ Falha ao extrair dados');
        }
      } catch (error) {
        this.stats.failedExtractions++;
        console.error(`    ✗ Falha após ${CONFIG.retry.maxRetries} tentativas`);

        if (this.isBrowserDead(error)) {
          console.log('    [RECOVERY] Browser morreu durante extração, recriando...');
          page = null;
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
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.timeouts.navigation,
    });

    await randomDelay(CONFIG.delays.scrollSettle.min, CONFIG.delays.scrollSettle.max);
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
