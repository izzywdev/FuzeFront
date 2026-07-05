import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../src/components/Modal';
import { renderWithI18n } from './helpers';

describe('Modal', () => {
  it('is a labelled, modal dialog when open and absent when closed', () => {
    const { rerender } = renderWithI18n(
      <Modal open onClose={() => {}} title="Hello" subtitle="World">
        <p>body</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Hello');
    rerender(
      <Modal open={false} onClose={() => {}} title="Hello">
        <p>body</p>
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape and on close-button click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithI18n(
      <Modal open onClose={onClose} title="Hello">
        <button>inner</button>
      </Modal>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('forwards dir to the overlay for automatic RTL mirroring', () => {
    const { container } = renderWithI18n(
      <Modal open onClose={() => {}} title="مرحبا">
        <p>body</p>
      </Modal>,
      { dir: 'rtl', locale: 'ar' },
    );
    expect(container.querySelector('.ffb-modal__overlay')).toHaveAttribute('dir', 'rtl');
  });

  it('hides the close button and ignores Escape when not dismissable', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithI18n(
      <Modal open onClose={onClose} title="Busy" dismissable={false}>
        <button>inner</button>
      </Modal>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
