import { request as httpRequest, createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { Page } from '@playwright/test';
import { pages } from './fixtures/pages';
import { expect, test } from './fixtures/server';

const toastOf = (page: Page) => page.locator('[aria-live="polite"][role="status"]').last();
const tickets = (page: Page) => page.getByRole('article');

/**
 * A pass-through proxy in front of the real server whose connections can be cut and restored without
 * touching the server, so one tab loses its stream while the server (and other tabs) keep working.
 */
async function startProxy(targetOrigin: string) {
  const target = new URL(targetOrigin);
  const sockets = new Set<Socket>();
  let server: Server;
  const listen = (port: number) =>
    new Promise<number>((resolve) => {
      server = createServer((req, res) => {
        const upstream = httpRequest(
          {
            host: target.hostname,
            port: target.port,
            path: req.url,
            method: req.method,
            headers: req.headers,
          },
          (up) => {
            res.writeHead(up.statusCode ?? 502, up.headers);
            up.pipe(res);
          },
        );
        upstream.on('error', () => res.destroy());
        res.on('close', () => upstream.destroy());
        req.pipe(upstream);
      });
      server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
      });
      server.listen(port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });
  const port = await listen(0);
  return {
    origin: `http://127.0.0.1:${port}`,
    /** Close the listener and destroy every open connection (the SSE stream included). */
    async cut(): Promise<void> {
      server.close();
      for (const socket of sockets) socket.destroy();
    },
    async restore(): Promise<void> {
      await listen(port);
    },
    async close(): Promise<void> {
      server.close();
      for (const socket of sockets) socket.destroy();
    },
  };
}

test.describe('stream loss and recovery', () => {
  test.describe.configure({ mode: 'serial' });

  // Every test must leave the server running for the next one.
  test.afterEach(async ({ server }) => {
    await server.startServer().catch(() => undefined); // throws when it is already running
  });

  test('a screen whose data cannot be loaded offers Retry and recovers once the server is back (AC-28)', async ({
    page,
    server,
  }) => {
    await pages.openBoard(page);
    // Setup: visit one ticket so the lazy Ticket screen bundle is already loaded, then come back.
    await pages.column(page, 'Done').getByRole('article', { name: /^T-1 / }).press('Enter');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Event store on SQLite' }),
    ).toBeVisible();
    await pages
      .primaryNav(page)
      .getByRole('link', { name: /^01 Board/ })
      .click();
    await server.stopServer();

    // T-2's data was never loaded, so opening it needs the (stopped) server.
    await pages.column(page, 'Done').getByRole('article', { name: /^T-2 / }).press('Enter');
    const alert = page
      .getByRole('alert')
      .filter({ hasText: 'Couldn’t load ticket — the server is not responding.' });
    await expect(alert).toBeVisible();

    await server.startServer();
    await alert.getByRole('button', { name: 'Retry' }).click();
    // Contract: Retry reloads the data and the error disappears.
    await expect(alert).toHaveCount(0);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Fastify API skeleton' }),
    ).toBeVisible();
  });

  test('stopping the server shows the banner and pauses actions; a failed command keeps its input; restart recovers (AC-29, AC-30, AC-21, AC-31)', async ({
    page,
    server,
  }) => {
    await pages.openBoard(page);
    await expect(tickets(page)).toHaveCount(16);
    await page.getByRole('button', { name: '+ New ticket' }).click();
    await page
      .getByRole('dialog', { name: 'New ticket' })
      .getByLabel('Title')
      .fill('Typed while offline');

    await server.stopServer();

    // Contract (AC-29): a stream error shows the banner within 2 s.
    await expect(pages.connectionBanner(page)).toHaveText('Connection lost — reconnecting…', {
      timeout: 2_000,
    });

    // Contract (AC-21): a command that cannot reach the server says so and keeps what was typed.
    const modal = page.getByRole('dialog', { name: 'New ticket' });
    await modal.getByRole('button', { name: 'Create ticket' }).click();
    await expect(toastOf(page)).toContainText('Couldn’t reach the server — try again.');
    await expect(modal.getByLabel('Title')).toHaveValue('Typed while offline');
    await modal.getByRole('button', { name: 'Cancel' }).click();

    // Contract (AC-30): data-changing controls are refused while the banner is shown.
    await expect(page.getByRole('button', { name: '+ New ticket' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(
      page.getByRole('group', { name: 'Simulation' }).getByRole('button', { name: '▶ PLAY' }),
    ).toBeDisabled();

    // Contract (AC-31): after the restart the banner clears and the Board shows each ticket exactly once.
    await server.startServer();
    await expect(pages.connectionBanner(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(tickets(page)).toHaveCount(16);
    await expect(page.getByRole('button', { name: '+ New ticket' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('events produced while the stream was down are replayed once on reconnect (AC-31)', async ({
    browser,
    server,
  }) => {
    const proxy = await startProxy(server.baseURL);
    const tabContext = await browser.newContext({ baseURL: proxy.origin });
    const otherContext = await browser.newContext({ baseURL: server.baseURL });
    try {
      const page = await tabContext.newPage();
      await pages.openBoard(page);
      await expect(tickets(page)).toHaveCount(16);

      // This tab's connection is cut; the server and a second client carry on.
      await proxy.cut();
      await expect(pages.connectionBanner(page)).toBeVisible({ timeout: 5_000 });
      const created = await otherContext.request.post('/api/tickets', {
        data: {
          title: 'Created during the outage',
          description: '',
          acceptanceCriteria: [],
          priority: 'low',
        },
      });
      expect(created.ok()).toBe(true);
      const step = await otherContext.request.post('/api/simulation/step');
      expect(step.ok()).toBe(true);

      await proxy.restore();
      // Contract: the missed events arrive after the reconnect and none is applied twice.
      await expect(pages.connectionBanner(page)).toHaveCount(0, { timeout: 15_000 });
      await expect(
        pages.column(page, 'Backlog').getByRole('article', { name: /Created during the outage/ }),
      ).toHaveCount(1);
      await expect(tickets(page)).toHaveCount(17);
    } finally {
      await tabContext.close();
      await otherContext.close();
      await proxy.close();
    }
  });

  test('a database reset while the tab is open resyncs it to the clean fixture (AC-32)', async ({
    page,
    server,
  }) => {
    await pages.openBoard(page);
    // Setup: the previous test left T-17 behind, so the tab is ahead of what a reset server will know.
    await expect(tickets(page)).toHaveCount(17);

    await server.resetDb();

    // Contract: the tab recovers on its own and shows the seed fixture again (16 tickets, no leftovers).
    await expect(pages.connectionBanner(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(tickets(page)).toHaveCount(16);
    await expect(page.getByRole('article', { name: /Created during the outage/ })).toHaveCount(0);
  });
});
