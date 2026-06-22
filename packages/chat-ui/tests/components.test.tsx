import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatI18nProvider } from '../src/i18n';
import { ChatPanel } from '../src/components/ChatPanel';
import { Composer } from '../src/components/Composer';
import { ConfirmationCard } from '../src/components/ConfirmationCard';
import { Citations } from '../src/components/Citations';
import { FeedbackButtons } from '../src/components/FeedbackButtons';
import type { UiMessage, PendingConfirmation } from '../src/hooks/types';

function wrap(ui: React.ReactNode, dir: 'ltr' | 'rtl' = 'ltr') {
  return render(<ChatI18nProvider dir={dir}>{ui}</ChatI18nProvider>);
}

const noop = () => {};

describe('Composer', () => {
  it('submits trimmed text on the send button and clears', async () => {
    const onSend = vi.fn();
    wrap(<Composer onSend={onSend} />);
    const input = screen.getByLabelText('Ask about FuzeFront…');
    await userEvent.type(input, '  hello  ');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).toHaveBeenCalledWith('hello');
    expect((input as HTMLTextAreaElement).value).toBe('');
  });

  it('submits on Enter, newline on Shift+Enter', async () => {
    const onSend = vi.fn();
    wrap(<Composer onSend={onSend} />);
    const input = screen.getByLabelText('Ask about FuzeFront…');
    await userEvent.type(input, 'line{Shift>}{Enter}{/Shift}two');
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.type(input, '{Enter}');
    expect(onSend).toHaveBeenCalledWith('line\ntwo');
  });

  it('disables send when empty or streaming', () => {
    const { rerender } = wrap(<Composer onSend={noop} />);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    rerender(
      <ChatI18nProvider dir="ltr">
        <Composer onSend={noop} disabled />
      </ChatI18nProvider>,
    );
    expect(screen.getByLabelText('Ask about FuzeFront…')).toBeDisabled();
  });
});

describe('Citations', () => {
  it('renders each rag_source as an accessible external link', () => {
    const sources = [
      { title: 'Helm guide', url: 'https://docs/helm', excerpt: 'deploy via helm' },
      { title: 'Auth', url: 'https://docs/auth', excerpt: '' },
    ];
    wrap(<Citations sources={sources} />);
    const region = screen.getByRole('region', { name: 'Sources' });
    const links = within(region).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://docs/helm');
    expect(links[0]).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});

describe('ConfirmationCard', () => {
  const base: PendingConfirmation = {
    confirmationId: 'c1',
    toolName: 'create_org',
    args: { name: 'Acme' },
    description: 'Create organization "Acme"?',
    status: 'pending',
  };

  it('shows approve/cancel and calls handlers with the id', async () => {
    const onApprove = vi.fn();
    const onCancel = vi.fn();
    wrap(<ConfirmationCard confirmation={base} onApprove={onApprove} onCancel={onCancel} />);
    expect(screen.getByText('Create organization "Acme"?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith('c1');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledWith('c1');
  });

  it('shows a running label and disables actions while running', () => {
    wrap(
      <ConfirmationCard confirmation={{ ...base, status: 'running' }} onApprove={noop} onCancel={noop} />,
    );
    expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled();
  });

  it('renders a resolved status (approved) instead of buttons', () => {
    wrap(
      <ConfirmationCard
        confirmation={{ ...base, status: 'approved', summary: 'Organization created.' }}
        onApprove={noop}
        onCancel={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Organization created.');
  });
});

describe('FeedbackButtons', () => {
  it('reflects selection via aria-pressed and reports clicks', async () => {
    const onFeedback = vi.fn();
    wrap(<FeedbackButtons messageId="m1" value="positive" onFeedback={onFeedback} />);
    expect(screen.getByRole('button', { name: 'Good response' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Bad response' }));
    expect(onFeedback).toHaveBeenCalledWith('m1', 'negative');
  });
});

describe('ChatPanel', () => {
  const messages: UiMessage[] = [
    { id: 'u1', role: 'user', content: 'How do I deploy?', streaming: false },
    {
      id: 'a1',
      role: 'assistant',
      content: 'Use Helm.',
      streaming: false,
      sources: [{ title: 'Helm', url: 'https://d/helm', excerpt: 'helm upgrade' }],
    },
  ];

  it('renders a dialog landmark, log region, messages and citations', () => {
    wrap(
      <ChatPanel
        messages={messages}
        streaming={false}
        onSend={noop}
        onApprove={noop}
        onCancel={noop}
        onFeedback={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Assistant' })).toBeInTheDocument();
    expect(screen.getByRole('log')).toBeInTheDocument();
    expect(screen.getByText('How do I deploy?')).toBeInTheDocument();
    expect(screen.getByText('Use Helm.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sources' })).toBeInTheDocument();
  });

  it('close button has an accessible label and fires onClose', async () => {
    const onClose = vi.fn();
    wrap(
      <ChatPanel
        messages={[]}
        streaming={false}
        onSend={noop}
        onApprove={noop}
        onCancel={noop}
        onFeedback={noop}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close assistant' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('mirrors to RTL: dir=rtl is applied to the drawer root', () => {
    wrap(
      <ChatPanel
        messages={messages}
        streaming={false}
        onSend={noop}
        onApprove={noop}
        onCancel={noop}
        onFeedback={noop}
      />,
      'rtl',
    );
    expect(screen.getByRole('dialog', { name: 'Assistant' })).toHaveAttribute('dir', 'rtl');
  });
});
