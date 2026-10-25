import type { Page } from '@playwright/test';
import { pages } from './fixtures/pages';
import { expect, test } from './fixtures/server';

const clock = (page: Page) => page.getByRole('group', { name: 'Simulation' }).locator('time');

test.describe('browser in America/Los_Angeles', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('the header clock and the cost chart show the UTC simulation date, not the browser zone (AC-138)', async ({
    page,
  }) => {
    await pages.openBoard(page);
    // Contract: the fixture clock starts at 2026-10-24T14:32:00Z; in LA that would read 07:32 if the
    // browser zone leaked into the display.
    await expect(clock(page)).toHaveText('14:32:00');

    await pages
      .primaryNav(page)
      .getByRole('link', { name: /^03 Usage & Cost/ })
      .click();
    const chart = page.getByRole('region', { name: 'Cost per day' });
    await expect(chart).toBeVisible();
    // Contract: the chart's last day label is TODAY (Oct 24 in UTC), never a day shifted by the zone.
    await expect(chart.getByText('TODAY', { exact: true })).toBeVisible();
  });
});

// @slow: waits a minute of real time to prove nothing on screen reads the browser clock.
test('@slow Mission Control does not change while the simulation is paused (AC-25)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/mission-control');
  await expect(page.getByRole('heading', { level: 1, name: 'Mission Control' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Event Log' })).toBeVisible();
  // Setup: paused after load, and the lists have rendered.
  await expect(
    page.getByRole('group', { name: 'Simulation' }).getByRole('button', { name: /PLAY/ }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('listitem').first()).toBeVisible();
  await page.waitForLoadState('networkidle');

  const snapshot = () => page.locator('body').innerHTML();
  const before = await snapshot();
  // Real elapsed time is the point of this test.
  await page.waitForTimeout(60_000);
  // Contract: "ago" labels, SEEN, durations and Events/min derive from the Simulation Clock only,
  // so with Play off the rendered DOM is byte-identical after a minute.
  expect(await snapshot()).toBe(before);
});
