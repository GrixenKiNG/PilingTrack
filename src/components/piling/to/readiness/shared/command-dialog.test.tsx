import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandDialog } from './command-dialog';
import { EntityDetailShell } from './entity-detail-shell';

function DialogHarness({ pending = false }: { pending?: boolean }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Открыть команду
      </button>
      <CommandDialog
        open={open}
        title="Подтвердите действие"
        pending={pending}
        returnFocusRef={triggerRef}
        onClose={() => setOpen(false)}
        footer={<button type="button">Выполнить</button>}
      >
        <label>
          Комментарий
          <input aria-label="Комментарий" />
        </label>
      </CommandDialog>
    </>
  );
}

describe('CommandDialog', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('focuses its title, traps focus, closes with Escape and restores the trigger', () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Открыть команду' });
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    expect(screen.getByRole('heading', { name: 'Подтвердите действие' })).toHaveFocus();

    const close = screen.getByRole('button', { name: 'Закрыть' });
    close.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(screen.getByLabelText('Комментарий')).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('does not close a pending command with Escape', () => {
    render(<DialogHarness pending />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть команду' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('EntityDetailShell', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('uses modal semantics, traps focus and returns focus after close', () => {
    function DetailHarness() {
      const [open, setOpen] = useState(false);
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
            Открыть карточку
          </button>
          <EntityDetailShell
            open={open}
            modal
            title="Карточка техники"
            returnFocusRef={triggerRef}
            onClose={() => setOpen(false)}
          >
            <a href="/equipment/equipment-1">Детали</a>
          </EntityDetailShell>
        </>
      );
    }

    render(<DetailHarness />);
    const trigger = screen.getByRole('button', { name: 'Открыть карточку' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Карточка техники' });
    const close = screen.getByRole('button', { name: 'Закрыть' });
    const details = screen.getByRole('link', { name: 'Детали' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(details).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
