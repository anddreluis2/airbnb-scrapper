import 'dotenv/config';
import { AirbnbScraper } from './scraper.js';

async function main(): Promise<void> {
  const scraper = new AirbnbScraper();

  try {
    await scraper.run();
    console.log('\nScraping concluído com sucesso!');
    process.exit(0);
  } catch (error) {
    console.error('Erro durante o scraping:', error);
    process.exit(1);
  }
}

main();
