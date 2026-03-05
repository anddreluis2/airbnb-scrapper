import 'dotenv/config';
import { AirbnbScraper } from './scraper.js';

function formatDuration(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const scraper = new AirbnbScraper();

  try {
    await scraper.run();
    const elapsed = formatDuration(Date.now() - startTime);
    console.log(`\n[elapsed: ${elapsed} | remaining: 0s] Scraping concluído com sucesso!`);
    process.exit(0);
  } catch (error) {
    const elapsed = formatDuration(Date.now() - startTime);
    console.error(`[elapsed: ${elapsed} | remaining: --] Erro durante o scraping:`, error);
    process.exit(1);
  }
}

main();
