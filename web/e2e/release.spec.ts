import { pages } from './fixtures/pages';
import { expect, test } from './fixtures/server';

// PDR-0006: the Operator may release an In Progress ticket; the agent is refused on its next step.
test('dragging an In Progress ticket to Ready asks for confirmation, releases it and the agent is refused on its next step', async ({
  page,
}) => {
  await pages.openBoard(page);
  const card = pages.column(page, 'In Progress').getByRole('article', { name: /^T-12 / });
  await expect(card).toBeVisible();

  // Contract (UI-AC-46): while a card is dragged, columns show whether they accept it.
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const ready = pages.column(page, 'Ready');
  const readyBox = (await ready.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2 + 5, { steps: 3 });
  await page.mouse.move(readyBox.x + readyBox.width / 2, readyBox.y + 100, { steps: 10 });
  await expect(page.getByText('Moving T-12 — highlighted columns accept it.')).toBeVisible();
  // Contract: the Ready column is a valid release target and says so (a hint paragraph appears in it).
  await expect(ready.locator('p').first()).toBeVisible();
  await page.mouse.up();

  // Contract (UI-AC-58): dropping on Ready opens the confirmation instead of moving silently.
  const dialog = page.getByRole('alertdialog', { name: 'Move T-12 to Ready?' });
  await expect(dialog).toBeVisible();
  await expect(
    pages.column(page, 'In Progress').getByRole('article', { name: /^T-12 / }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Release ticket' }).click();

  // Contract (UI-AC-48): confirming moves the ticket and toasts the outcome.
  await expect(page.getByText('T-12 moved to Ready — the agent is free again')).toBeVisible();
  await expect(ready.getByRole('article', { name: /^T-12 / })).toBeVisible();
  await expect(
    pages.column(page, 'In Progress').getByRole('article', { name: /^T-12 / }),
  ).toHaveCount(0);

  // Contract (AC-55 event text): the Ticket's Activity records the Operator's release.
  await ready.getByRole('article', { name: /^T-12 / }).press('Enter');
  const activity = page.getByRole('complementary', { name: 'Ticket context' }).locator('section', {
    has: page.getByRole('heading', { name: 'Activity' }),
  });
  await expect(activity).toContainText('Moved In Progress → Ready · released alpha');

  // Contract (PDR-0006, server-api AC-13): the released agent gets a refusal with the reason on its next step.
  // The released agent is no longer on T-12, so only the all-agents STEP reaches it.
  await page
    .getByRole('group', { name: 'Simulation' })
    .getByRole('button', { name: 'STEP' })
    .click();
  await expect(activity).toContainText('Refused: T-12 was released by Operator');
});
