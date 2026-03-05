# Parallel Scraping Design

## Problem

The scraper processes everything sequentially: segments one at a time, listings one at a time. With 1000+ listings and 2-4s delays per action, a full run takes ~2.5 hours.

## Solution

Worker pool pattern with N parallel browser contexts, each with unique user agent and viewport. Both phases (segment collection and listing extraction) run in parallel.

## Architecture

```
Orchestrator (AirbnbScraper)
  └── WorkerPool (manages N workers)
        ├── Worker 1 (BrowserContext: UA1 + VP1)
        ├── Worker 2 (BrowserContext: UA2 + VP2)
        ├── Worker 3 (BrowserContext: UA3 + VP3)
        └── Worker N ...
              └── pulls from shared Queue (segments or URLs)
```

### Phase 1: Segment Collection (parallel)
- Segments queued, distributed across workers
- Each worker processes a segment independently
- URLs merged into shared Map after each segment completes
- Subdivision works recursively within each worker

### Phase 2: Listing Extraction (parallel)
- Unique URLs split into chunks, one per worker
- Each worker processes its chunk sequentially with reduced delays
- CSVWriter uses a write lock for concurrent appends
- Browser restart logic applies per worker

## New File: `src/worker-pool.ts`
- Creates N contexts from single browser instance
- Unique UA + viewport per context (no repeats)
- `runAll(tasks, taskFn)` distributes tasks across workers
- Workers reused across both phases
- Staggered start (500ms apart)

## Delay Reductions

| Parameter | Before | After |
|-----------|--------|-------|
| Page load delay | 1000-1800ms | 800-1500ms |
| Listing delay | 2000-4000ms | 1000-2000ms |
| Scroll steps | 5 | 3 |
| Scroll step delay | 300-800ms | 200-500ms |
| Search delay | 2000-4000ms | 1500-2500ms |
| Retry backoff | 30-60s | 10-30s |

## New Config

```
CONCURRENCY=4          # parallel workers (default)
DELAY_MIN=1500
DELAY_MAX=2500
LISTING_DELAY_MIN=1000
LISTING_DELAY_MAX=2000
```

## Expected Performance

With 4 workers and reduced delays: ~6-8x speedup. A 1000-listing run drops from ~2.5 hours to ~20-30 minutes.

## Detection Risk

Moderate. Mitigations:
- Each context has unique fingerprint (UA + viewport)
- Staggered request timing
- Still using humanized scroll (reduced)
- Same IP but multiple "users" is normal household behavior
- No proxy needed for this scale
