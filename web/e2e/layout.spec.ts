import type { Page } from '@playwright/test';
import { pages } from './fixtures/pages';
import { expect, test } from './fixtures/server';

interface Screen {
  name: string;
  path: string;
  heading: string | RegExp;
}

const SCREENS: readonly Screen[] = [
  { name: 'Board', path: '/board', heading: 'Board' },
  { name: 'Ticket', path: '/tickets/T-12', heading: /./ },
  { name: 'Mission Control', path: '/mission-control', heading: 'Mission Control' },
  { name: 'Agent', path: '/agents/alpha', heading: /./ },
  { name: 'Usage & Cost', path: '/usage', heading: 'Usage & Cost' },
  { name: 'Session Log', path: '/sessions/S-0412', heading: /./ },
];

async function open(page: Page, screen: Screen): Promise<void> {
  await page.goto(screen.path);
  await page.getByRole('heading', { level: 1, name: screen.heading }).first().waitFor();
  await page.waitForLoadState('networkidle');
}

/** Visible interactive elements shorter than `min` px, as `<role> "<name>" <height>px`. */
async function shortControls(page: Page, min: number, rootSelector = 'body'): Promise<string[]> {
  return page.evaluate(
    ([minHeight, root]) => {
      const selector =
        'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [tabindex="0"]';
      const found: string[] = [];
      for (const el of document
        .querySelector(root as string)!
        .querySelectorAll<HTMLElement>(selector)) {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (box.width === 0 || box.height === 0 || style.visibility === 'hidden') continue;
        // A checkbox/radio input is hit through its wrapping label.
        const target = el instanceof HTMLInputElement && el.labels?.[0] ? el.labels[0] : el;
        const height = target.getBoundingClientRect().height;
        if (height < (minHeight as number)) {
          const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40);
          found.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(height)}px`);
        }
      }
      return found;
    },
    [min, rootSelector] as const,
  );
}

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('1280 px viewport', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('every screen fits without horizontal scrolling and keeps side panels beside the main content (AC-137)', async ({
    page,
  }) => {
    for (const screen of SCREENS) {
      await open(page, screen);
      // Contract: at 1280 px the page itself never scrolls sideways.
      expect(await pageOverflow(page), `${screen.name} overflows at 1280 px`).toBeLessThanOrEqual(
        0,
      );
    }

    await open(page, SCREENS[1]!);
    const main = page.getByRole('heading', { level: 1 }).first();
    const aside = page.getByRole('complementary').first();
    // Contract: at >= 1180 px the Ticket side panel sits beside the main column, not under it.
    const mainBox = (await main.boundingBox())!;
    const asideBox = (await aside.boundingBox())!;
    expect(asideBox.x).toBeGreaterThan(mainBox.x + 200);

    await open(page, SCREENS[2]!);
    const log = page.getByRole('complementary', { name: 'Event Log' });
    const firstCard = page.getByRole('heading', { level: 1, name: 'Mission Control' });
    // Contract: the Event Log stays to the right of the agent grid.
    expect((await log.boundingBox())!.x).toBeGreaterThan((await firstCard.boundingBox())!.x + 400);
  });
});

test.describe('1024 px viewport', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('the Board scrolls horizontally inside its own area and the page does not (AC-137)', async ({
    page,
  }) => {
    await pages.openBoard(page);
    const backlog = pages.column(page, 'Backlog');
    const done = pages.column(page, 'Done');
    await expect(backlog).toBeVisible();

    // Contract: below 1180 px the five columns keep a 1180 px minimum width, so the last column is
    // pushed out of the viewport and reachable only by scrolling.
    const doneBox = (await done.boundingBox())!;
    expect(doneBox.x + doneBox.width).toBeGreaterThan(1024);
    const scrolled = await page.evaluate(() => {
      const before = window.scrollX;
      window.scrollTo(2000, 0);
      return { before, after: window.scrollX };
    });
    const scrollable =
      scrolled.after > scrolled.before ||
      (await page.getByRole('region', { name: 'Done', exact: true }).evaluate((el) => {
        for (let n: HTMLElement | null = el.parentElement; n; n = n.parentElement) {
          if (n.scrollWidth > n.clientWidth && getComputedStyle(n).overflowX !== 'visible')
            return true;
        }
        return false;
      }));
    expect(scrollable).toBe(true);
    await done.scrollIntoViewIfNeeded();
    await expect(done).toBeInViewport();
  });

  test('the Ticket side panel and the Session Log side panel wrap under the main content (AC-137)', async ({
    page,
  }) => {
    await open(page, SCREENS[1]!);
    const title = page.getByRole('heading', { level: 1 }).first();
    const aside = page.getByRole('complementary').first();
    const titleBox = (await title.boundingBox())!;
    const asideBox = (await aside.boundingBox())!;
    // Contract: below 1180 px the Ticket aside is below the title block, not beside it.
    expect(asideBox.y).toBeGreaterThan(titleBox.y + titleBox.height);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

    await open(page, SCREENS[5]!);
    const logAside = page.getByRole('complementary').first();
    const logTitle = page.getByRole('heading', { level: 1 }).first();
    // Contract: the Session Log side panel also wraps below the main column.
    expect((await logAside.boundingBox())!.y).toBeGreaterThan(
      (await logTitle.boundingBox())!.y + (await logTitle.boundingBox())!.height,
    );
  });

  test('the Mission Control Event Log wraps under the agent grid (AC-137)', async ({ page }) => {
    await open(page, SCREENS[2]!);
    const log = page.getByRole('complementary', { name: 'Event Log' });
    const lastCard = page.getByRole('article').last();
    // Contract: below 1180 px the Event Log starts below the agent cards.
    expect((await log.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await lastCard.boundingBox())!.y + (await lastCard.boundingBox())!.height - 1,
    );
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('hit areas (AC-133, U-18)', () => {
  test('header controls (nav, simulation panel, theme toggle) are at least 40 px high', async ({
    page,
  }) => {
    await pages.openBoard(page);
    // Contract: the shared header controls meet the 40 px minimum on every screen.
    expect(await shortControls(page, 40, 'header')).toEqual([]);
  });

  for (const screen of SCREENS) {
    test(`${screen.name}: every interactive element is at least 40 px high`, async ({ page }) => {
      await open(page, screen);
      // Contract: the hit area of every interactive element is >= 40 px high.
      expect(await shortControls(page, 40)).toEqual([]);
    });
  }

  test('primary actions are at least 44 px high', async ({ page }) => {
    await pages.openBoard(page);
    // Contract: the primary "+ New ticket" action is >= 44 px high.
    const box = (await page.getByRole('button', { name: '+ New ticket' }).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  });
});

const simulation = (page: Page) => page.getByRole('group', { name: 'Simulation' });

/** The running-tool square pulses only while auto-play is on (AC-98), so play, sample, then pause. */
async function pulsingWhilePlaying(page: Page): Promise<string[]> {
  await open(page, SCREENS[2]!);
  const play = simulation(page).getByRole('button', { name: /PLAY|PAUSE/ });
  await play.click();
  try {
    await expect(play).toHaveAttribute('aria-pressed', 'true');
    // Let the pulse (and any slide-in) start before sampling.
    await page.waitForTimeout(500);
    return await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running')
        .map((a) => (a as CSSAnimation).animationName ?? a.constructor.name),
    );
  } finally {
    await play.click();
    await expect(play).toHaveAttribute('aria-pressed', 'false');
  }
}

test.describe('motion is on by default (control for AC-135)', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('a running agent pulses while auto-play is on, so the reduced-motion check can fail', async ({
    page,
  }) => {
    // Contract: without the OS request the pulse animation runs on a running agent card.
    expect((await pulsingWhilePlaying(page)).some((name) => name.includes('pulse'))).toBe(true);
  });
});

test.describe('reduced motion (AC-135)', () => {
  test.use({ reducedMotion: 'reduce' });

  test('no animation runs, even with auto-play on and an agent running', async ({ page }) => {
    // Contract: with the OS asking for reduced motion, no CSS animation is running (pulse, toast slide).
    expect(await pulsingWhilePlaying(page)).toEqual([]);
  });
});
