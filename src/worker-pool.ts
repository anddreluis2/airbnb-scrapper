import { Browser, BrowserContext } from 'playwright';
import { createContext } from './browser/launcher.js';
import { randomDelay } from './browser/stealth.js';

export class WorkerPool {
  private browser: Browser;
  private concurrency: number;
  private contexts: BrowserContext[] = [];

  constructor(browser: Browser, concurrency: number) {
    this.browser = browser;
    this.concurrency = concurrency;
  }

  async init(): Promise<void> {
    for (let i = 0; i < this.concurrency; i++) {
      const ctx = await createContext(this.browser);
      this.contexts.push(ctx);
    }
  }

  async runAll<T>(
    tasks: T[],
    taskFn: (ctx: BrowserContext, task: T, workerIndex: number) => Promise<void>,
  ): Promise<void> {
    let queueIndex = 0;

    const workerLoop = async (workerIndex: number): Promise<void> => {
      // Stagger start: 500ms per worker
      if (workerIndex > 0) {
        await randomDelay(workerIndex * 500, workerIndex * 500 + 200);
      }

      const ctx = this.contexts[workerIndex];

      while (true) {
        const taskIndex = queueIndex++;
        if (taskIndex >= tasks.length) break;

        await taskFn(ctx, tasks[taskIndex], workerIndex);
      }
    };

    const workers = Array.from({ length: this.concurrency }, (_, i) => workerLoop(i));
    await Promise.all(workers);
  }

  getContext(index: number): BrowserContext {
    return this.contexts[index];
  }

  async close(): Promise<void> {
    for (const ctx of this.contexts) {
      try { await ctx.close(); } catch { /* already dead */ }
    }
    this.contexts = [];
  }
}
