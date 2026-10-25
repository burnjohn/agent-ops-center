import { pages } from './fixtures/pages';
import { expect, test } from './fixtures/server';

const toggle = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Toggle dark mode' });
const theme = (page: import('@playwright/test').Page) => page.locator('html');

test.describe('OS prefers dark', () => {
  test.use({ colorScheme: 'dark' });

  test('starts dark, toggles to light, and keeps the choice across a reload (AC-5, AC-136)', async ({
    page,
  }) => {
    await pages.openBoard(page);

    // Contract (AC-136): until the Operator toggles, the theme follows the OS preference.
    await expect(theme(page)).toHaveAttribute('data-theme', 'dark');
    // Contract (AC-5): in dark theme the toggle reads "☀ LIGHT".
    await expect(toggle(page)).toHaveText('☀ LIGHT');

    await toggle(page).click();
    // Contract (AC-5): activating the toggle flips the tokens and the label.
    await expect(theme(page)).toHaveAttribute('data-theme', 'light');
    await expect(toggle(page)).toHaveText('◐ DARK');

    // Contract (AC-5): the flip applies on every screen, not only the one where it was toggled.
    await pages
      .primaryNav(page)
      .getByRole('link', { name: /^02 Mission Control/ })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mission Control' })).toBeVisible();
    await expect(theme(page)).toHaveAttribute('data-theme', 'light');

    // Contract (AC-136): the Operator's choice beats the OS preference after a reload.
    await page.reload();
    await expect(toggle(page)).toBeVisible();
    await expect(theme(page)).toHaveAttribute('data-theme', 'light');
    await expect(toggle(page)).toHaveText('◐ DARK');
  });
});

test.describe('OS prefers light', () => {
  test.use({ colorScheme: 'light' });

  test('starts light and a toggle back to dark survives a reload (AC-5, AC-136)', async ({
    page,
  }) => {
    await pages.openBoard(page);
    await expect(theme(page)).toHaveAttribute('data-theme', 'light');
    await expect(toggle(page)).toHaveText('◐ DARK');

    await toggle(page).click();
    await expect(theme(page)).toHaveAttribute('data-theme', 'dark');

    // Contract (AC-136): the stored choice (dark) wins although the OS still says light.
    await page.reload();
    await expect(toggle(page)).toBeVisible();
    await expect(theme(page)).toHaveAttribute('data-theme', 'dark');
  });
});
