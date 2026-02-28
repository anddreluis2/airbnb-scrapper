import { RetryConfig } from '../types.js';
import { randomDelay } from '../browser/stealth.js';

export function calculateBackoff(attempt: number, config: RetryConfig): number {
  const delay = config.initialDelay * Math.pow(config.multiplier, attempt - 1);
  return Math.min(delay, config.maxDelay);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  attempt: number = 1,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (attempt < config.maxRetries) {
      const backoffDelay = calculateBackoff(attempt, config);
      console.log(
        `    ! Erro (tentativa ${attempt}/${config.maxRetries}), aguardando ${backoffDelay}ms antes de retry...`,
      );
      await randomDelay(backoffDelay, backoffDelay + 5000);
      return withRetry(fn, config, attempt + 1);
    }
    throw error;
  }
}
