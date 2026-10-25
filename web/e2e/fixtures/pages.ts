import type { Page } from '@playwright/test';

/** Role-based page helpers shared by the e2e specs (no test-ids). */
export const pages = {
  async openBoard(page: Page): Promise<void> {
    await page.goto('/board');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();
  },
  column(page: Page, name: 'Backlog' | 'Ready' | 'In Progress' | 'Review' | 'Done') {
    return page.getByRole('region', { name, exact: true });
  },
  primaryNav(page: Page) {
    return page.getByRole('navigation', { name: 'Primary' });
  },
  connectionBanner(page: Page) {
    return page.getByText('Connection lost', { exact: false });
  },
};
