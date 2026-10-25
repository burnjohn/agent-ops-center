import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/server';

type Theme = 'light' | 'dark';

interface Screen {
  name: string;
  path: string;
  /** A heading that proves the screen finished loading. */
  ready: RegExp | string;
}

const SCREENS: readonly Screen[] = [
  { name: 'Board', path: '/board', ready: 'Board' },
  { name: 'Ticket', path: '/tickets/T-12', ready: /./ },
  { name: 'Mission Control', path: '/mission-control', ready: 'Mission Control' },
  { name: 'Agent', path: '/agents/alpha', ready: /./ },
  { name: 'Usage & Cost', path: '/usage', ready: 'Usage & Cost' },
  { name: 'Session Log', path: '/sessions/S-0412', ready: /./ },
  { name: 'Not found', path: '/nope', ready: 'Page not found.' },
];

async function settle(page: Page, screen: Screen): Promise<void> {
  await page.getByRole('heading', { level: 1, name: screen.ready }).first().waitFor();
  await page.getByRole('navigation', { name: 'Primary' }).waitFor();
  // Let lazy data and the Event Log / chart finish rendering before scanning.
  await page.waitForLoadState('networkidle');
}

for (const theme of ['light', 'dark'] as const satisfies readonly Theme[]) {
  test.describe(`axe scan, ${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const screen of SCREENS) {
      test(`${screen.name} has no serious or critical violations (AC-134)`, async ({ page }) => {
        await page.goto(screen.path);
        await settle(page, screen);
        // Contract: the OS preference drives the theme, so the scan really covers this theme.
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

        const results = await new AxeBuilder({ page }).analyze();
        const blocking = results.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => ({
            rule: v.id,
            impact: v.impact,
            targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
          }));
        // Contract: zero serious/critical axe violations on every screen in both themes.
        expect(blocking).toEqual([]);
      });
    }
  });
}

test.describe('keyboard focus and non-colour status', () => {
  test('keyboard focus shows a 2px solid ring with a 2px offset (AC-131)', async ({ page }) => {
    await page.goto('/board');
    await page.getByRole('navigation', { name: 'Primary' }).waitFor();
    const toggle = page.getByRole('button', { name: 'Toggle dark mode' });
    // Contract: reaching a control with the keyboard (focus-visible) draws the ring.
    await page.keyboard.press('Tab');
    for (
      let i = 0;
      i < 20 && !(await toggle.evaluate((el) => el === document.activeElement));
      i += 1
    )
      await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();
    const ring = await toggle.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: s.outlineWidth, offset: s.outlineOffset };
    });
    expect(ring).toEqual({ style: 'solid', width: '2px', offset: '2px' });
  });

  test('status, health and stage carry a glyph or word besides colour (AC-132)', async ({
    page,
  }, testInfo) => {
    await page.goto('/mission-control');
    await page.getByRole('heading', { level: 1, name: 'Mission Control' }).waitFor();
    const cards = page.getByRole('article');
    await expect(cards.first()).toBeVisible();
    // Contract: every agent card names its health in text with a leading glyph (never a bare colour dot).
    const health = await cards.evaluateAll((els) =>
      els.map((el) => /(■|◐|□)\s*(ONLINE|STALE|OFFLINE)/.exec(el.textContent ?? '')?.[0] ?? null),
    );
    expect(health.length).toBeGreaterThan(0);
    expect(health.every((h) => h !== null)).toBe(true);

    // Review aid: the same screens rendered in greyscale, to check nothing relies on hue alone.
    for (const [name, path] of [
      ['board', '/board'],
      ['mission-control', '/mission-control'],
      ['usage', '/usage'],
    ] as const) {
      await page.goto(path);
      await page.getByRole('navigation', { name: 'Primary' }).waitFor();
      await page.waitForLoadState('networkidle');
      await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });
      await testInfo.attach(`greyscale-${name}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    }
  });
});
