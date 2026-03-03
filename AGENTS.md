## Cursor Cloud specific instructions

This is a **TypeScript CLI scraper** (not a web app) that uses Playwright to scrape Airbnb listings. There is no web server, database, or multi-service architecture.

### Running the application

See `README.md` for all npm scripts. Key workflow: `npm run build` then `npm start`, or use `npm run dev` (build + run combined).

### Environment configuration

Copy `.env.example` to `.env` before running. For quick test runs, reduce `MAX_PAGES` to 1 and shorten delay values (e.g., `DELAY_MIN=1000`, `DELAY_MAX=2000`). Default delays (4-8s) are designed for anti-detection on Airbnb.

### Gotchas

- **Playwright browser required**: After `npm install`, you must run `npx playwright install --with-deps chromium` to install the Chromium binary and its OS-level dependencies. Without this, the scraper will fail at browser launch.
- **No lint/test scripts**: The project has no configured linter or test framework. The only validation is `npm run build` (TypeScript compilation with `strict: true`).
- **Output directory**: The scraper writes to `data/listings.csv`. The `data/` directory is created automatically by the CSV writer if it doesn't exist.
- **Network-dependent**: The scraper makes live HTTP requests to airbnb.com.br. Runs will fail without internet access. Airbnb may also block or rate-limit requests.
- **Long run times**: A full scrape (default `MAX_PAGES=5`) takes several minutes due to anti-detection delays. Use `MAX_PAGES=1` with reduced delays for quick verification.
