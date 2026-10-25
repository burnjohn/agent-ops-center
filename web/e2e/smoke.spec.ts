import { pages } from './fixtures/pages';
import { expect, test } from './fixtures/server';

test('board renders the seeded tickets, the stream is connected and Mission Control opens', async ({
  page,
}) => {
  await pages.openBoard(page);

  // Contract: the seed fixture holds 16 tickets spread over the five board columns.
  const columns = ['Backlog', 'Ready', 'In Progress', 'Review', 'Done'] as const;
  for (const name of columns) await expect(pages.column(page, name)).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(16);

  // Contract: a healthy event stream shows no connection banner.
  await expect(pages.connectionBanner(page)).toHaveCount(0);

  await pages
    .primaryNav(page)
    .getByRole('link', { name: /^02 Mission Control/ })
    .click();
  await expect(page).toHaveURL(/\/mission-control$/);
  await expect(
    pages.primaryNav(page).getByRole('link', { name: /^02 Mission Control/ }),
  ).toHaveAttribute('aria-current', 'page');
});
