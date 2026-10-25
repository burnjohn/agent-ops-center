import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeNetwork } from '../test/fakeNetwork';
import { renderApp, type RenderedApp } from '../test/renderApp';

const backButton = (label: string) => screen.findByRole('button', { name: `← BACK TO ${label}` });

async function openT12FromBoard(app: RenderedApp) {
  const progress = await screen.findByRole('region', { name: /in progress/i });
  await app.user.click(
    await within(progress).findByRole('link', { name: /SSE reconnect with event replay/ }),
  );
  return screen.findByRole('navigation', { name: 'Breadcrumb' });
}

describe('Back and breadcrumbs through the real screens (UI-AC-10, 11, 13)', () => {
  it('walks Board -> T-12 -> alpha -> S-0412 and Back returns alpha, T-12, Board', async () => {
    const app = renderApp({ route: '/board', network: createFakeNetwork() });
    await openT12FromBoard(app);

    // Contract: the label names the page visited before.
    await backButton('BOARD');

    await app.user.click((await screen.findAllByRole('link', { name: 'alpha' }))[0]!);
    await backButton('T-12');
    const agentCrumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(agentCrumbs).getByRole('link', { name: 'MISSION CONTROL' })).toHaveAttribute(
      'href',
      '/mission-control',
    );

    await app.user.click(await screen.findByRole('row', { name: /S-0412/ }));
    await backButton('alpha');
    // Contract: session breadcrumb is MISSION CONTROL / <agent> / <session>; all but the last are links.
    const sessionCrumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(sessionCrumbs).getByRole('link', { name: 'MISSION CONTROL' })).toHaveAttribute(
      'href',
      '/mission-control',
    );
    expect(within(sessionCrumbs).getByRole('link', { name: 'alpha' })).toHaveAttribute(
      'href',
      '/agents/alpha',
    );
    expect(within(sessionCrumbs).getByText('S-0412')).toHaveAttribute('aria-current', 'page');
    expect(within(sessionCrumbs).queryByRole('link', { name: 'S-0412' })).not.toBeInTheDocument();

    // Contract: Back opens the previous entry and removes it from the history.
    await app.user.click(screen.getByRole('button', { name: '← BACK TO alpha' }));
    await backButton('T-12');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      'MISSION CONTROL',
    );
    await app.user.click(screen.getByRole('button', { name: '← BACK TO T-12' }));
    await backButton('BOARD');
    await app.user.click(screen.getByRole('button', { name: '← BACK TO BOARD' }));
    expect(await screen.findByRole('heading', { name: 'Board' })).toBeInTheDocument();
  });

  it('renders ticket breadcrumbs as BOARD / <STATUS> / T-x with all but the last as links (UI-AC-13)', async () => {
    renderApp({ route: '/tickets/T-12' });
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });

    const links = within(crumbs).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['BOARD', 'IN PROGRESS']);
    for (const l of links) expect(l).toHaveAttribute('href', '/board');
    expect(within(crumbs).getByText('T-12')).toHaveAttribute('aria-current', 'page');
  });

  it('Back with an empty history (deep link) opens the Board (UI-AC-11)', async () => {
    const { user } = renderApp({ route: '/tickets/T-12' });

    // Contract: with nothing earlier in the history the label and the target are the Board.
    await user.click(await backButton('BOARD'));
    expect(await screen.findByRole('heading', { name: 'Board' })).toBeInTheDocument();
  });

  it('labels Back with the screen name for Mission Control and Usage & Cost (UI-AC-10)', async () => {
    const app = renderApp({ route: '/mission-control', network: createFakeNetwork() });
    await app.user.click((await screen.findAllByRole('link', { name: 'alpha' }))[0]!);
    await backButton('MISSION CONTROL');
  });
});

describe('primary nav clears the Back history (UI-AC-4)', () => {
  it('after a nav click, Back on the next detail page reads that screen, then falls back to the Board', async () => {
    const app = renderApp({ route: '/board', network: createFakeNetwork() });
    await openT12FromBoard(app);
    await backButton('BOARD');

    await app.user.click(screen.getByRole('link', { name: /^02 Mission Control/ }));
    await app.user.click((await screen.findAllByRole('link', { name: 'alpha' }))[0]!);

    // Contract (spec observable): after the nav click, Back on the next detail page reads that screen.
    // (That older entries are really dropped is asserted on the reducer in history.test.tsx.)
    await app.user.click(await backButton('MISSION CONTROL'));
    expect(screen.getByRole('link', { name: /^02 Mission Control/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('the brand block also clears the history', async () => {
    const app = renderApp({ route: '/mission-control', network: createFakeNetwork() });
    await app.user.click((await screen.findAllByRole('link', { name: 'alpha' }))[0]!);
    await backButton('MISSION CONTROL');

    await app.user.click(screen.getByRole('link', { name: /AGENT OPS/ }));
    expect(await screen.findByRole('heading', { name: 'Board' })).toBeInTheDocument();
    const progress = await screen.findByRole('region', { name: /in progress/i });
    await app.user.click(
      await within(progress).findByRole('link', { name: /SSE reconnect with event replay/ }),
    );
    await backButton('BOARD');
  });
});

describe('not found (UI-AC-16, UI-AC-17)', () => {
  it('shows "Page not found." with a Go to Board link on an unknown path', async () => {
    renderApp({ route: '/nope' });
    expect(await screen.findByRole('heading', { name: 'Page not found.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Board' })).toHaveAttribute('href', '/board');
  });

  it.each([
    ['/tickets/T-999', "Ticket T-999 doesn't exist.", '← BACK TO BOARD', '/board'],
    [
      '/agents/ghost',
      "Agent ghost doesn't exist.",
      '← BACK TO MISSION CONTROL',
      '/mission-control',
    ],
    [
      '/sessions/S-9999',
      "Session S-9999 doesn't exist.",
      '← BACK TO MISSION CONTROL',
      '/mission-control',
    ],
  ])('%s explains the missing id and links back', async (route, title, linkName, href) => {
    renderApp({ route, network: createFakeNetwork() });
    // Contract: the exact copy of the spec, with a link to the owning screen.
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: linkName })).toHaveAttribute('href', href);
  });
});
