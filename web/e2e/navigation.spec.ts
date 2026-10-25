import type { Page } from '@playwright/test';
import { pages } from './fixtures/pages';
import { expect, test } from './fixtures/server';

const simulation = (page: Page) => page.getByRole('group', { name: 'Simulation' });
const backButton = (page: Page, label: string) =>
  page.getByRole('button', { name: `← BACK TO ${label}` });
const heading = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 1, name });
const navLink = (page: Page, name: RegExp) => pages.primaryNav(page).getByRole('link', { name });
const clock = (page: Page) => simulation(page).locator('time');

async function step(page: Page): Promise<void> {
  const before = await clock(page).innerText();
  await simulation(page).getByRole('button', { name: 'STEP' }).click();
  await expect.poll(() => clock(page).innerText()).not.toBe(before);
}

test.describe('history and deep links', () => {
  test('Board -> T-12 -> alpha -> S-0412, then Back three times retraces the visits (AC-11)', async ({
    page,
  }) => {
    await pages.openBoard(page);
    await pages
      .column(page, 'In Progress')
      .getByRole('article', { name: /^T-12 / })
      .waitFor();
    await page
      .getByRole('article', { name: /^T-12 / })
      .getByRole('link')
      .first()
      .click();
    await expect(page).toHaveURL(/\/tickets\/T-12$/);
    // Contract (AC-10): the Back label names the previous screen.
    await expect(backButton(page, 'BOARD')).toBeVisible();

    await page.getByRole('complementary').getByRole('link', { name: 'alpha' }).first().click();
    await expect(page).toHaveURL(/\/agents\/alpha$/);
    await expect(backButton(page, 'T-12')).toBeVisible();

    await page.getByRole('link', { name: 'S-0412', exact: true }).first().click();
    await expect(page).toHaveURL(/\/sessions\/S-0412$/);
    await expect(backButton(page, 'ALPHA')).toBeVisible();

    // Contract (AC-11): each Back opens the previous entry of the in-app history.
    await backButton(page, 'ALPHA').click();
    await expect(page).toHaveURL(/\/agents\/alpha$/);
    await backButton(page, 'T-12').click();
    await expect(page).toHaveURL(/\/tickets\/T-12$/);
    await backButton(page, 'BOARD').click();
    await expect(page).toHaveURL(/\/board$/);
  });

  test('Back with no history (deep link) opens the Board (AC-11)', async ({ page }) => {
    await page.goto('/tickets/T-12');
    await heading(page, /./).first().waitFor();
    // Contract: an empty in-app history falls back to /board.
    await page.getByRole('button', { name: /^← BACK TO / }).click();
    await expect(page).toHaveURL(/\/board$/);
  });

  test('breadcrumb links go to their screens (AC-13)', async ({ page }) => {
    await page.goto('/agents/alpha');
    await heading(page, /./).first().waitFor();
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'MISSION CONTROL' })
      .click();
    await expect(page).toHaveURL(/\/mission-control$/);
  });

  test('an unknown path shows "Page not found." and Go to Board returns home (AC-16)', async ({
    page,
  }) => {
    await page.goto('/nope');
    // Contract: unknown paths never render a blank or broken screen.
    await expect(heading(page, 'Page not found.')).toBeVisible();
    await page.getByRole('link', { name: 'Go to Board' }).click();
    await expect(page).toHaveURL(/\/board$/);
    await expect(heading(page, 'Board')).toBeVisible();
  });

  test('unknown ticket, agent and session ids say so and link back to the right screen (AC-17)', async ({
    page,
  }) => {
    await page.goto('/tickets/T-999');
    await expect(heading(page, "Ticket T-999 doesn't exist.")).toBeVisible();
    await expect(page.getByRole('link', { name: '← BACK TO BOARD' })).toBeVisible();

    await page.goto('/agents/ghost');
    await expect(heading(page, "Agent ghost doesn't exist.")).toBeVisible();
    await expect(page.getByRole('link', { name: '← BACK TO MISSION CONTROL' })).toBeVisible();

    await page.goto('/sessions/S-9999');
    await expect(heading(page, "Session S-9999 doesn't exist.")).toBeVisible();
    await page.getByRole('link', { name: '← BACK TO MISSION CONTROL' }).click();
    await expect(page).toHaveURL(/\/mission-control$/);
  });
});

test.describe('filters survive navigation and events (AC-14)', () => {
  test('Board filters stay set after leaving the Board and after simulation steps', async ({
    page,
  }) => {
    await pages.openBoard(page);
    await page.getByLabel('Agent', { exact: true }).selectOption('alpha');
    await page.getByRole('checkbox', { name: 'Blocked only' }).check();

    await navLink(page, /^02 Mission Control/).click();
    await expect(heading(page, 'Mission Control')).toBeVisible();
    await step(page);
    await navLink(page, /^01 Board/).click();
    await expect(heading(page, 'Board')).toBeVisible();

    // Contract: neither navigation nor an incoming event changes a filter; only the Operator does.
    await expect(page.getByLabel('Agent', { exact: true })).toHaveValue('alpha');
    await expect(page.getByRole('checkbox', { name: 'Blocked only' })).toBeChecked();
    await step(page);
    await expect(page.getByLabel('Agent', { exact: true })).toHaveValue('alpha');
    await expect(page.getByRole('checkbox', { name: 'Blocked only' })).toBeChecked();
  });

  test('Event Log filters stay set after visiting an agent page and after steps', async ({
    page,
  }) => {
    await page.goto('/mission-control');
    await expect(heading(page, 'Mission Control')).toBeVisible();
    const log = page.getByRole('complementary', { name: 'Event Log' });
    await log.getByRole('group', { name: 'Source' }).getByRole('button').nth(1).click();
    const pressedSource = await log
      .getByRole('group', { name: 'Source' })
      .getByRole('button', { pressed: true })
      .innerText();
    const category = log.getByLabel('Category');
    const options = await category.locator('option').allInnerTexts();
    await category.selectOption({ index: Math.min(2, options.length - 1) });
    const chosenCategory = await category.inputValue();

    await page.getByRole('link', { name: 'alpha' }).first().click();
    await expect(page).toHaveURL(/\/agents\/alpha$/);
    await backButton(page, 'MISSION CONTROL').click();
    await expect(heading(page, 'Mission Control')).toBeVisible();
    await step(page);

    // Contract: Event Log source and category survive navigation, Back and incoming events.
    await expect(
      log.getByRole('group', { name: 'Source' }).getByRole('button', { pressed: true }),
    ).toHaveText(pressedSource);
    await expect(log.getByLabel('Category')).toHaveValue(chosenCategory);
  });

  test('Usage period survives opening a session and going Back (AC-111, AC-120)', async ({
    page,
  }) => {
    await page.goto('/usage');
    await expect(heading(page, 'Usage & Cost')).toBeVisible();
    const period = page.getByRole('group', { name: 'Period' });
    await period.getByRole('button', { name: '7 DAYS' }).click();
    // Contract (AC-111): the period change recomputes the screen (sub-line names the period).
    await expect(period.getByRole('button', { name: '7 DAYS' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('LAST 7 DAYS')).toBeVisible();

    const sessions = page.getByRole('region', { name: 'Sessions' });
    await sessions
      .getByRole('link', { name: /^S-\d+/ })
      .first()
      .click();
    // Contract (AC-120): a session row opens its Session Log.
    await expect(page).toHaveURL(/\/sessions\/S-\d+$/);
    await backButton(page, 'USAGE & COST').click();
    await expect(heading(page, 'Usage & Cost')).toBeVisible();

    // Contract (AC-14): the period is unchanged after Back.
    await expect(period.getByRole('button', { name: '7 DAYS' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('LAST 7 DAYS')).toBeVisible();
  });
});

test.describe('Mission Control', () => {
  test('agent card click targets: card, ticket link and LOG link (AC-94)', async ({ page }) => {
    await page.goto('/mission-control');
    const card = () => page.getByRole('article', { name: 'alpha' });
    await card().waitFor();

    // Contract: clicking the card body (outside inner links) opens the agent page.
    await card()
      .getByText(/^SEEN /)
      .click();
    await expect(page).toHaveURL(/\/agents\/alpha$/);

    await page.goBack();
    await card().getByRole('link', { name: /^T-12/ }).click();
    await expect(page).toHaveURL(/\/tickets\/T-12$/);

    await page.goBack();
    await card().getByRole('link', { name: 'LOG ↗' }).click();
    await expect(page).toHaveURL(/\/sessions\/S-\d+$/);
  });

  test('Event Log: pause, step three times, the banner counts the held events and resume inserts them (AC-102)', async ({
    page,
  }) => {
    await page.goto('/mission-control');
    const log = page.getByRole('complementary', { name: 'Event Log' });
    const rows = log.getByRole('listitem');
    await expect(rows.first()).toBeVisible();
    const pause = log.getByRole('button', { name: 'Ⅱ PAUSE' });
    await pause.click();
    await expect(log.getByRole('button', { name: '▶ RESUME' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const topWhenPaused = await rows.first().innerText();
    const countWhenPaused = await rows.count();

    for (let i = 0; i < 3; i += 1) await step(page);

    // Contract: while paused the newest visible row does not change and the banner counts new events.
    const banner = log.getByRole('button', { name: /^PAUSED · \d+ NEW EVENTS — RESUME ↑$/ });
    await expect(banner).toBeVisible();
    expect(await rows.first().innerText()).toBe(topWhenPaused);
    expect(await rows.count()).toBe(countWhenPaused);
    const announced = Number(/(\d+) NEW/.exec(await banner.innerText())?.[1]);
    expect(announced).toBeGreaterThan(0);

    await banner.click();
    // Contract: resuming inserts every held event and returns the button to PAUSE.
    await expect(log.getByRole('button', { name: 'Ⅱ PAUSE' })).toBeVisible();
    await expect(banner).toHaveCount(0);
    await expect.poll(async () => rows.first().innerText()).not.toBe(topWhenPaused);
  });
});

test.describe('Agent console scrolling (AC-86)', () => {
  test('stays at the bottom when at the bottom; keeps position and offers NEW LINES when scrolled up', async ({
    page,
  }) => {
    await page.goto('/tickets/T-12');
    const consoleLog = page.getByRole('log', { name: 'Agent console' });
    await expect(consoleLog).toBeVisible();
    const next = page.getByRole('button', { name: /NEXT STEP/ });
    const metrics = () =>
      consoleLog.evaluate((el) => ({
        top: el.scrollTop,
        gap: el.scrollHeight - el.scrollTop - el.clientHeight,
        overflow: el.scrollHeight - el.clientHeight,
      }));

    // Setup: grow the log until it scrolls.
    for (let i = 0; i < 30 && (await metrics()).overflow <= 40; i += 1) {
      await next.click({ timeout: 5_000 });
      await page.waitForTimeout(300);
    }
    expect((await metrics()).overflow).toBeGreaterThan(40);

    // Contract: at the bottom, a new line keeps the console at the bottom.
    await next.click();
    await expect.poll(async () => (await metrics()).gap).toBeLessThanOrEqual(4);
    await expect(page.getByRole('button', { name: '↓ NEW LINES' })).toHaveCount(0);

    // Contract: scrolled up, a new line keeps the position and shows "↓ NEW LINES".
    await consoleLog.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect.poll(async () => (await metrics()).top).toBe(0);
    await next.click();
    const newLines = page.getByRole('button', { name: '↓ NEW LINES' });
    await expect(newLines).toBeVisible();
    expect((await metrics()).top).toBe(0);

    // Contract: the button scrolls to the bottom and disappears.
    await newLines.click();
    await expect.poll(async () => (await metrics()).gap).toBeLessThanOrEqual(4);
    await expect(newLines).toHaveCount(0);
  });
});
