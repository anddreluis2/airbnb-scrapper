import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { BrowserConfig } from '../types.js';

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1280, height: 720 },
];

const USER_AGENTS = [
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export async function initBrowser(config: BrowserConfig = {}): Promise<Browser> {
  const { proxyUrl, headless = true } = config;

  return chromium.launch({
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
    ...(proxyUrl && {
      proxy: { server: proxyUrl },
    }),
  });
}

export async function createContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    viewport: pickRandom(VIEWPORTS),
    userAgent: pickRandom(USER_AGENTS),
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
}

export async function createPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();

  page.on('dialog', async (dialog) => {
    await dialog.dismiss();
  });

  return page;
}
