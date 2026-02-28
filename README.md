# Airbnb Scraper

Scraper de listings do Airbnb para **"Espaço Inteiro"** no **Centro de Curitiba**, usando Playwright com técnicas anti-detecção.

## Setup

```bash
npm install
cp .env.example .env   # editar conforme necessário
npm run build
npm start
```

## Scripts

| Script | Comando | Descrição |
|--------|---------|-----------|
| `build` | `tsc` | Compila TypeScript para `dist/` |
| `start` | `node dist/index.js` | Executa o scraper |
| `dev` | `tsc && node dist/index.js` | Build + execução |
| `clean` | `rm -rf dist` | Remove build |

## Variáveis de Ambiente

| Variável | Default | Descrição |
|----------|---------|-----------|
| `PROXY_URL` | — | URL do proxy (opcional) |
| `MAX_PAGES` | 5 | Máximo de páginas de busca |
| `DELAY_MIN` | 4000 | Delay mínimo entre páginas (ms) |
| `DELAY_MAX` | 8000 | Delay máximo entre páginas (ms) |
| `LISTING_DELAY_MIN` | 3000 | Delay mínimo entre listings (ms) |
| `LISTING_DELAY_MAX` | 6000 | Delay máximo entre listings (ms) |
| `MAX_RETRIES` | 3 | Tentativas de retry por listing |
| `OUTPUT_FILE` | `data/listings.csv` | Arquivo de saída |

## Estrutura do Projeto

```
src/
  index.ts                    # Entry point
  scraper.ts                  # Orquestrador principal
  config.ts                   # Configurações + URL builder
  types.ts                    # Interfaces compartilhadas

  browser/
    index.ts                  # Barrel re-exports
    launcher.ts               # Init do browser, context, page
    stealth.ts                # Anti-detecção: delays, scroll

  extraction/
    index.ts                  # Barrel re-exports
    coordinates.ts            # Extração de lat/lng do mapa
    listing.ts                # Extração de dados de um listing
    search.ts                 # Parsing da página de busca + paginação

  output/
    csv-writer.ts             # Escrita incremental em CSV

  utils/
    retry.ts                  # Retry genérico com backoff exponencial
```

## Fluxo de Execução

```mermaid
flowchart TD
    A[index.ts - main] --> B[scraper.ts - run]

    B --> C[init]
    C --> C1[launcher.ts - initBrowser]
    C1 --> C2[launcher.ts - createContext]

    B --> D[warmup]
    D --> D1[launcher.ts - createPage]
    D1 --> D2[Navigate to homepage]
    D2 --> D3[stealth.ts - randomDelay + humanizedScroll]
    D3 --> D4[Page closed - cookies saved]

    B --> E[searchAndCollect]
    E --> E1[Loop: page 1 to MAX_PAGES]
    E1 --> E2[config.ts - getSearchUrl]
    E2 --> E3[Navigate to search URL]
    E3 --> E4[stealth.ts - randomDelay + humanizedScroll]
    E4 --> E5[search.ts - extractListingUrls]
    E5 --> E6[search.ts - extractTotalPages]
    E6 --> E7[search.ts - hasNextPage + extractNextCursor]
    E7 -->|has more| E1
    E7 -->|done| F

    F[visitAndExtract] --> F1[Loop: each unique listing URL]
    F1 --> F2[retry.ts - withRetry wraps visitListing]
    F2 --> F3[Navigate to listing URL]
    F3 --> F4[stealth.ts - randomDelay + humanizedScroll]
    F4 --> F5[listing.ts - extractListingData]
    F5 --> F6[coordinates.ts - extractMapCoordinates]
    F6 --> F7[csv-writer.ts - appendRow]
    F7 --> F8[stealth.ts - randomDelay]
    F8 --> F1

    F1 -->|all done| G[printStats]
    G --> H[close - shut down browser]
    H --> I[process.exit]
```

## Output

O scraper gera `data/listings.csv` com as colunas:

```
listing_id, url, titulo, localizacao, coordenadas, coletado_em
```

## Técnicas Anti-Detecção

- Browser stealth flags (`--disable-blink-features=AutomationControlled`)
- Warm-up session (homepage antes de buscar)
- Delays aleatórios entre páginas e listings
- Scroll humanizado (5 passos com delays)
- User-Agent realista (5 opções)
- Viewport aleatório (5 resoluções)
- Retry com backoff exponencial (30-60s)
- Persistent context (cookies entre páginas)
- Suporte a proxy (configurável)
