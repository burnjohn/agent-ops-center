import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupUser } from '../../test/user';
import { Button, Checkbox, Segmented, Select, TextArea, TextField } from './index';

describe('Button disabled-with-reason (U-9)', () => {
  it('stays focusable, exposes the reason as its description and never fires onClick', async () => {
    const user = setupUser();
    const onClick = vi.fn();
    render(
      <Button disabledReason="Pause to step manually" onClick={onClick}>
        STEP
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'STEP' });

    await user.tab();
    await user.click(button);

    // Contract: aria-disabled (not native disabled) so it can be focused and explain itself.
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleDescription('Pause to step manually');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Pause to step manually');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('plain disabled is aria-disabled without a reason and also blocks clicks', async () => {
    const user = setupUser();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Send
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Send' });
    await user.click(button);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('fires onClick when enabled', async () => {
    const user = setupUser();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('form controls (UI-AC-134)', () => {
  it('labels every control, marks required fields with a visual * and announces errors via role="alert"', () => {
    render(
      <form>
        <TextField
          label="Title"
          value=""
          required
          error="Title is required."
          onChange={() => undefined}
        />
        <TextArea label="Description" value="" onChange={() => undefined} />
        <Select label="Agent" defaultValue="a">
          <option value="a">alpha</option>
        </Select>
        <Checkbox label="Blocked only" />
        <Segmented
          label="Priority"
          options={[
            { value: 'high', label: 'High' },
            { value: 'low', label: 'Low' },
          ]}
          value="high"
          onChange={() => undefined}
        />
      </form>,
    );

    // Contract: each control is reachable by its label.
    const title = screen.getByLabelText(/Title/);
    expect(title).toBeRequired();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Agent' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Blocked only' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Priority' })).toBeInTheDocument();
    // The `*` is decorative: the accessible name stays "Title"; the error is an alert linked to the field.
    expect(title).toHaveAccessibleName('Title');
    expect(screen.getByLabelText(/Title/).closest('div')).toHaveTextContent('*');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Title is required.');
    expect(title).toBeInvalid();
    expect(title).toHaveAccessibleDescription('Title is required.');
  });

  it('shows no alert for a valid field', () => {
    render(<TextField label="Title" value="ok" onChange={() => undefined} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Segmented reflects the selection with aria-pressed and reports changes', async () => {
    const user = setupUser();
    const onChange = vi.fn();
    render(
      <Segmented
        label="Priority"
        options={[
          { value: 'high', label: 'High' },
          { value: 'low', label: 'Low' },
        ]}
        value="high"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('button', { name: 'High' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Low' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Low' }));
    expect(onChange).toHaveBeenCalledWith('low');
  });
});
