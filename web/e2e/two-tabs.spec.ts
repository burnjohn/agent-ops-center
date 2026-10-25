import type { Page } from '@playwright/test';
import { pages } from './fixtures/pages';
import { expect, test } from './fixtures/server';

const toastOf = (page: Page) => page.locator('[aria-live="polite"][role="status"]');
const simulation = (page: Page) => page.getByRole('group', { name: 'Simulation' });

async function openTicket(page: Page, id: string): Promise<void> {
  await page.goto(`/tickets/${id}`);
  await page.getByRole('heading', { level: 2, name: 'C — Move' }).waitFor();
}

test.describe('two tabs on one server', () => {
  test('a move made in tab A shows up in tab B without reload (AC-23)', async ({
    page,
    context,
  }) => {
    const tabB = await context.newPage();
    await pages.openBoard(tabB);
    await pages.openBoard(page);
    // Setup: tab B is on the Board with T-14 in Backlog.
    await expect(
      pages.column(tabB, 'Backlog').getByRole('article', { name: /^T-14 / }),
    ).toBeVisible();

    await openTicket(page, 'T-14');
    await page.getByRole('button', { name: 'Move to Ready' }).click();
    await expect(toastOf(page)).toContainText('T-14 moved to Ready');

    // Contract: every open tab applies the same event; tab B's Board moves the card by itself.
    await expect(
      pages.column(tabB, 'Ready').getByRole('article', { name: /^T-14 / }),
    ).toBeVisible();
    await expect(
      pages.column(tabB, 'Backlog').getByRole('article', { name: /^T-14 / }),
    ).toHaveCount(0);
    await tabB.close();
  });

  test('Assign modal rows follow other tabs live and the modal closes when its ticket changed (AC-57, AC-53)', async ({
    page,
    context,
  }) => {
    const tabB = await context.newPage();
    await openTicket(tabB, 'T-11');
    await openTicket(page, 'T-10');

    // Tab B opens the Assign modal for T-11; charlie is free.
    await tabB.getByRole('button', { name: 'Move to In Progress…' }).click();
    const modal = tabB.getByRole('dialog', { name: 'Who takes T-11?' });
    await expect(modal.getByRole('button', { name: /^charlie/ })).toContainText('FREE');

    // Tab A assigns charlie to T-10.
    await page.getByRole('button', { name: 'Move to In Progress…' }).click();
    await page
      .getByRole('dialog', { name: 'Who takes T-10?' })
      .getByRole('button', { name: /^charlie/ })
      .click();
    await expect(toastOf(page)).toContainText('T-10 is In Progress');

    // Contract (AC-57): while the modal is open, charlie's row turns BUSY on T-10 without any action in tab B.
    await expect(modal.getByRole('button', { name: /^charlie/ })).toContainText('BUSY · T-10');

    // Tab A now moves T-11 away from Ready under tab B's open modal.
    await openTicket(page, 'T-11');
    await page.getByRole('button', { name: 'Move to Backlog' }).click();
    await expect(toastOf(page)).toContainText('T-11 moved to Backlog');

    // Contract (AC-53): the stale modal closes and the Operator is told the ticket changed.
    await expect(modal).toHaveCount(0);
    await expect(toastOf(tabB)).toContainText('T-11 changed in the meantime');
    await tabB.close();
  });

  // @slow: waits out 30 s of Simulation Clock time to prove the hold outlives the server's 15 s expiry.
  test('@slow with Play on, the clock holds while a modal is open and resumes after it closes (AC-9)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await pages.openBoard(page);
    const clock = () => simulation(page).locator('time').innerText();

    await simulation(page).getByRole('button', { name: '▶ PLAY' }).click();
    await expect(simulation(page).getByRole('button', { name: 'Ⅱ PAUSE' })).toBeVisible();
    // Setup: Play is on and the clock is running.
    const running = await clock();
    await expect.poll(clock).not.toBe(running);

    await page.getByRole('button', { name: '+ New ticket' }).click();
    await expect(page.getByRole('dialog', { name: 'New ticket' })).toBeVisible();
    // Allow the hold request to land, then sample: the clock must not move for 30 s (hold renewals cover the 15 s expiry).
    await expect(page.getByText(/^Goes to Backlog as T-/)).toBeVisible();
    await page.waitForTimeout(1_500);
    const held = await clock();
    const until = Date.now() + 30_000;
    while (Date.now() < until) {
      expect(await clock()).toBe(held);
      await page.waitForTimeout(2_000);
    }

    // Contract: closing the modal releases the hold and the simulation continues.
    await page
      .getByRole('dialog', { name: 'New ticket' })
      .getByRole('button', { name: 'Cancel' })
      .click();
    await expect.poll(clock, { timeout: 20_000 }).not.toBe(held);
    await simulation(page).getByRole('button', { name: 'Ⅱ PAUSE' }).click();
    await expect(simulation(page).getByRole('button', { name: '▶ PLAY' })).toBeVisible();
  });
});
