import { describe, it, expect, vi } from 'vitest';
import { WorkerPool } from '../src/worker-pool.js';

// Mock the browser/launcher module so we don't need real Playwright
vi.mock('../src/browser/launcher.js', () => ({
  createContext: vi.fn().mockImplementation(async () => ({
    newPage: vi.fn().mockResolvedValue({ close: vi.fn(), isClosed: () => false }),
    close: vi.fn(),
  })),
}));

// Mock stealth to avoid real delays in tests
vi.mock('../src/browser/stealth.js', () => ({
  randomDelay: vi.fn().mockResolvedValue(undefined),
}));

function createMockBrowser() {
  return {
    isConnected: () => true,
    close: vi.fn(),
  } as any;
}

describe('WorkerPool', () => {
  it('distributes tasks across workers and processes all', async () => {
    const pool = new WorkerPool(createMockBrowser(), 2);
    await pool.init();

    const results: number[] = [];
    const tasks = [1, 2, 3, 4, 5];

    await pool.runAll(tasks, async (_ctx, task) => {
      results.push(task * 2);
    });

    expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
    await pool.close();
  });

  it('works with single worker', async () => {
    const pool = new WorkerPool(createMockBrowser(), 1);
    await pool.init();

    const results: number[] = [];
    await pool.runAll([10, 20], async (_ctx, task) => {
      results.push(task);
    });

    expect(results).toEqual([10, 20]);
    await pool.close();
  });

  it('handles empty task list', async () => {
    const pool = new WorkerPool(createMockBrowser(), 3);
    await pool.init();

    const results: string[] = [];
    await pool.runAll([], async (_ctx, task: string) => {
      results.push(task);
    });

    expect(results).toEqual([]);
    await pool.close();
  });

  it('close() closes all contexts', async () => {
    const pool = new WorkerPool(createMockBrowser(), 2);
    await pool.init();

    const ctx0 = pool.getContext(0);
    const ctx1 = pool.getContext(1);

    await pool.close();

    expect(ctx0.close).toHaveBeenCalled();
    expect(ctx1.close).toHaveBeenCalled();
  });

  it('passes correct workerIndex to taskFn', async () => {
    const pool = new WorkerPool(createMockBrowser(), 3);
    await pool.init();

    const workerIndices: number[] = [];
    // Give enough tasks so all workers get one
    await pool.runAll([1, 2, 3, 4, 5, 6], async (_ctx, _task, workerIndex) => {
      workerIndices.push(workerIndex);
    });

    // All workers should have been used
    expect(new Set(workerIndices).size).toBeGreaterThanOrEqual(2);
    await pool.close();
  });
});
