import { Page } from 'playwright';

export function getRandomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function randomDelay(min: number, max: number): Promise<void> {
  const delay = getRandomDelay(min, max);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

export async function humanizedScroll(page: Page): Promise<void> {
  const scrollDistance = await page.evaluate(() => {
    return document.documentElement.scrollHeight - window.innerHeight;
  });

  if (scrollDistance <= 0) return;

  const scrollSteps = 3;
  const stepSize = scrollDistance / scrollSteps;

  for (let i = 0; i < scrollSteps; i++) {
    await page.evaluate((distance) => {
      window.scrollBy(0, distance);
    }, stepSize);

    await randomDelay(200, 500);
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
}

export async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
}
