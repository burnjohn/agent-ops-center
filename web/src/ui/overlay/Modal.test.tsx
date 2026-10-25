import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { setupUser } from '../../test/user';
import { Modal } from './Modal';

function Harness({ onCancel = () => undefined }: { onCancel?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <button type="button">Outside</button>
      {open && (
        <Modal
          title="Assign ticket"
          onClose={() => {
            onCancel();
            setOpen(false);
          }}
          actions={
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          }
        >
          <label>
            Note <input />
          </label>
          <a href="/somewhere">Details</a>
        </Modal>
      )}
    </>
  );
}

describe('Modal (UI-AC-52)', () => {
  it('is a labelled modal dialog and moves focus inside when it opens', async () => {
    const user = setupUser();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));

    // Contract: an accessible dialog titled by its heading, focus inside.
    const dialog = screen.getByRole('dialog', { name: 'Assign ticket' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    const user = setupUser();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = screen.getByRole('dialog');

    // Contract: tabbing forward past the last control wraps to the first, never to "Outside".
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    for (let i = 0; i < 8; i += 1) {
      await user.tab({ shift: true });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('closes on Escape and returns focus to the control that opened it', async () => {
    const user = setupUser();
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(opener);

    await user.keyboard('{Escape}');

    // Contract: Escape closes without any other change and focus goes back to the opener.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });

  it('closes via Cancel and returns focus to the opener', async () => {
    const user = setupUser();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
