import type { Locator, Page } from '@playwright/test';
import { pages } from './fixtures/pages';
import { expect, test } from './fixtures/server';

/** Keyboard-only activation: focus the control, then press Enter (never a mouse click). */
async function activate(control: Locator, timeout?: number): Promise<void> {
  await control.focus({ timeout });
  await expect(control).toBeFocused({ timeout });
  await control.press('Enter', { timeout });
}

const clockText = (page: Page) =>
  page.getByRole('group', { name: 'Simulation' }).locator('time').innerText();

// UI-AC-131: every action is reachable and operable with the keyboard alone.
test('a ticket goes Backlog -> Ready -> In Progress -> Review -> Done using only the keyboard', async ({
  page,
}) => {
  await pages.openBoard(page);
  const toast = page.locator('[aria-live="polite"][role="status"]');

  // Create (AC-90): Enter in the Title field submits the form.
  await activate(page.getByRole('button', { name: '+ New ticket' }));
  const title = page.getByRole('dialog', { name: 'New ticket' }).getByLabel('Title');
  await title.focus();
  await title.fill('  Keyboard flow ticket  ');
  await title.press('Enter');
  await expect(toast).toContainText('T-17 created in Backlog');
  const card = pages
    .column(page, 'Backlog')
    .getByRole('article', { name: 'T-17 Keyboard flow ticket' });
  await expect(card).toBeVisible();

  // Contract: Enter on a focused card opens the ticket page (one focus stop per card).
  await card.focus();
  await card.press('Enter');
  await expect(page).toHaveURL(/\/tickets\/T-17$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Keyboard flow ticket' })).toBeVisible();

  // Move to Ready, then to In Progress through the Assign modal.
  await activate(page.getByRole('button', { name: 'Move to Ready' }));
  await expect(toast).toContainText('T-17 moved to Ready');
  await expect(page.getByText('02 READY', { exact: true })).toBeVisible();
  await activate(page.getByRole('button', { name: 'Move to In Progress…' }));
  const assign = page.getByRole('dialog', { name: 'Who takes T-17?' });
  await expect(assign).toBeVisible();
  await activate(assign.getByRole('button', { name: /^charlie/ }));
  await expect(toast).toContainText('T-17 is In Progress');
  await expect(page.getByText('03 IN PROGRESS', { exact: true })).toBeVisible();

  // AC-7: the header STEP advances the simulation clock.
  const clockBefore = await clockText(page);
  await activate(
    page.getByRole('group', { name: 'Simulation' }).getByRole('button', { name: 'STEP' }),
  );
  await expect.poll(() => clockText(page)).not.toBe(clockBefore);

  // AC-85 / AC-130: Next step and Run to next stage grow the session log until the agent submits for review.
  const entryCount = async () => {
    const meta = await page
      .getByText(/ entries · /)
      .first()
      .innerText();
    return Number(/(\d+) entries/.exec(meta)?.[1]);
  };
  const firstCount = await entryCount();
  await activate(page.getByRole('button', { name: /NEXT STEP/ }));
  await expect.poll(entryCount).toBeGreaterThan(firstCount);

  const review = page.getByText('04 REVIEW', { exact: true });
  const blocked = page.getByRole('textbox', { name: 'Your answer' });
  const runToNextStage = page.getByRole('button', { name: /RUN TO NEXT STAGE/ });
  for (let i = 0; i < 25; i += 1) {
    // Wait until the screen has settled into one of the three states the Operator can act on.
    await expect
      .poll(async () => {
        if ((await review.isVisible()) || (await blocked.isVisible())) return 'ready';
        const runnable =
          (await runToNextStage.isVisible()) &&
          (await runToNextStage.getAttribute('aria-disabled')) !== 'true';
        return runnable ? 'ready' : 'busy';
      })
      .toBe('ready');
    if (await review.isVisible()) break;
    if (await blocked.isVisible()) {
      await blocked.focus();
      await blocked.fill('Go ahead');
      await activate(page.getByRole('button', { name: /Send answer/ }));
      await expect(blocked).toHaveCount(0);
      continue;
    }
    const before = await entryCount();
    // The previous step's events may land just now and swap the buttons for the Review panel: re-evaluate then.
    const pressed = await activate(runToNextStage, 3_000).then(
      () => true,
      () => false,
    );
    if (!pressed) continue;
    await expect
      .poll(
        async () =>
          (await review.isVisible()) ||
          (await blocked.isVisible()) ||
          (await entryCount()) > before,
      )
      .toBe(true);
  }
  await expect(page.getByText('04 REVIEW', { exact: true })).toBeVisible();

  // AC-67: approving moves the ticket to Done.
  await activate(page.getByRole('button', { name: /Approve/ }));
  await expect(toast).toContainText('T-17 approved — moved to Done');
  await expect(page.getByText('05 DONE', { exact: true })).toBeVisible();
});

// UI-AC-131 + answer flow: a Blocked ticket is opened and unblocked without touching the mouse.
test('a blocked ticket is opened from the board and answered using only the keyboard', async ({
  page,
}) => {
  await pages.openBoard(page);
  const card = pages.column(page, 'In Progress').getByRole('article', { name: /^T-8 / });
  await card.focus();
  await card.press('Enter');
  await expect(page).toHaveURL(/\/tickets\/T-8$/);

  const answer = page.getByRole('textbox', { name: 'Your answer' });
  await answer.focus();
  await answer.fill('Use the seeded demo data');
  await answer.press('Tab');
  await expect(page.getByRole('button', { name: /Send answer/ })).toBeFocused();
  await page.keyboard.press('Enter');

  // Contract: the answer unblocks the ticket and the panel disappears.
  await expect(page.locator('[aria-live="polite"][role="status"]')).toContainText('T-8 unblocked');
  await expect(answer).toHaveCount(0);
});
