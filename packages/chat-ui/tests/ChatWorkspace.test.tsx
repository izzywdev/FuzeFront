import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatI18nProvider } from '../src/i18n';
import { ThoughtBox } from '../src/components/ThoughtBox';
import { MessageItem } from '../src/components/MessageItem';
import { ChatWorkspace } from '../src/components/ChatWorkspace';
import type { UiMessage, CustomToolCard, ThoughtStep, ChatThread } from '../src/hooks/types';

function wrap(ui: React.ReactNode, dir: 'ltr' | 'rtl' = 'ltr') {
  return render(<ChatI18nProvider dir={dir}>{ui}</ChatI18nProvider>);
}

const noop = () => {};

describe('ThoughtBox', () => {
  it('renders collapsed by default and displays duration', () => {
    const thoughts: ThoughtStep[] = [
      { id: '1', title: 'Resolving cluster config', content: 'Checking kubeconfig at ~/.kube/config', durationMs: 1200 },
    ];
    wrap(<ThoughtBox thoughts={thoughts} />);
    expect(screen.getByText(/Thought process \(1.2s\)/i)).toBeInTheDocument();
    expect(screen.queryByText('Checking kubeconfig at ~/.kube/config')).not.toBeInTheDocument();
  });

  it('expands when clicked to show thought steps', async () => {
    const thoughts: ThoughtStep[] = [
      { id: '1', title: 'Resolving cluster config', content: 'Checking kubeconfig at ~/.kube/config', durationMs: 1200 },
    ];
    wrap(<ThoughtBox thoughts={thoughts} />);
    const toggle = screen.getByRole('button', { name: /Thought process/i });
    await userEvent.click(toggle);
    expect(screen.getByText('Checking kubeconfig at ~/.kube/config')).toBeInTheDocument();
  });
});

describe('MessageItem with custom cards', () => {
  it('renders custom card with renderCustomCard prop', () => {
    const message: UiMessage = {
      id: 'm1',
      role: 'assistant',
      content: 'Here is the current time in Pacific Time:',
      streaming: false,
      cards: [
        {
          id: 'card-1',
          type: 'time_in_zone',
          title: 'Pacific Time',
          data: { time: '02:04:18', date: '2026-10-19', timeZone: 'America/Los_Angeles' },
        },
      ],
    };

    wrap(
      <MessageItem
        message={message}
        onApprove={noop}
        onCancel={noop}
        onFeedback={noop}
        renderCustomCard={(card: CustomToolCard) => (
          <div data-testid="custom-card-time">{card.title}: {String(card.data.time)}</div>
        )}
      />
    );

    expect(screen.getByTestId('custom-card-time')).toHaveTextContent('Pacific Time: 02:04:18');
  });

  it('renders default fallback when renderCustomCard is omitted', () => {
    const message: UiMessage = {
      id: 'm2',
      role: 'assistant',
      content: 'Default card test',
      streaming: false,
      cards: [
        {
          id: 'card-2',
          type: 'sandbox_status',
          title: 'K8s Sandbox Pod',
          data: { status: 'Running', cpu: '12m' },
        },
      ],
    };

    wrap(
      <MessageItem
        message={message}
        onApprove={noop}
        onCancel={noop}
        onFeedback={noop}
      />
    );

    expect(screen.getByText('K8s Sandbox Pod')).toBeInTheDocument();
  });
});

describe('ChatWorkspace', () => {
  const threads: ChatThread[] = [
    { id: 't-1', title: 'Cluster Deploy Verification', updatedAt: '2026-10-19T10:00:00Z', unreadCount: 2 },
    { id: 't-2', title: 'Telemetry Inspection', updatedAt: '2026-10-18T14:30:00Z' },
  ];

  it('renders threads in the sidebar and fires onSelectThread and onNewThread', async () => {
    const onSelectThread = vi.fn();
    const onNewThread = vi.fn();
    const onPopOut = vi.fn();

    wrap(
      <ChatWorkspace
        messages={[]}
        streaming={false}
        threads={threads}
        activeThreadId="t-1"
        onSelectThread={onSelectThread}
        onNewThread={onNewThread}
        onPopOut={onPopOut}
        onSend={noop}
        onApprove={noop}
        onCancel={noop}
        onFeedback={noop}
      />
    );

    expect(screen.getByText('Cluster Deploy Verification')).toBeInTheDocument();
    expect(screen.getByText('Telemetry Inspection')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Telemetry Inspection'));
    expect(onSelectThread).toHaveBeenCalledWith('t-2');

    await userEvent.click(screen.getByRole('button', { name: 'New Chat' }));
    expect(onNewThread).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Open in new window' }));
    expect(onPopOut).toHaveBeenCalled();
  });

  it('allows model selection and typing/sending a prompt', async () => {
    const onSend = vi.fn();
    const onSelectModel = vi.fn();

    wrap(
      <ChatWorkspace
        messages={[]}
        streaming={false}
        threads={threads}
        onSend={onSend}
        onSelectModel={onSelectModel}
        onApprove={noop}
        onCancel={noop}
        onFeedback={noop}
      />
    );

    const modelSelect = screen.getByLabelText('Model:');
    await userEvent.selectOptions(modelSelect, 'claude-3-5-sonnet');
    expect(onSelectModel).toHaveBeenCalledWith('claude-3-5-sonnet');

    const textarea = screen.getByLabelText('Message composer');
    await userEvent.type(textarea, 'What is the cluster status?');
    const sendBtn = screen.getByRole('button', { name: 'Send message' });
    await userEvent.click(sendBtn);

    expect(onSend).toHaveBeenCalledWith('What is the cluster status?');
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('collapses and restores sidebar on toggle click', async () => {
    wrap(
      <ChatWorkspace
        messages={[]}
        streaming={false}
        threads={threads}
        onSend={noop}
        onApprove={noop}
        onCancel={noop}
        onFeedback={noop}
      />
    );

    const toggle = screen.getByRole('button', { name: 'Hide sidebar' });
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeInTheDocument();
  });
});
