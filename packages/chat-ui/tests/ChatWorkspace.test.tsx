import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatWorkspace } from '../src/components/ChatWorkspace';
import type { UiMessage, ThreadSummary, CustomToolCard } from '../src/hooks/types';

describe('ChatWorkspace Component', () => {
  const mockThreads: ThreadSummary[] = [
    { id: 'thread-1', title: 'LA Time Verification', updatedAt: 'Just now', active: true },
    { id: 'thread-2', title: 'React 19 Components', updatedAt: '5m ago' },
  ];

  const mockMessages: UiMessage[] = [
    {
      id: 'msg-1',
      role: 'user',
      content: 'What time is it in Los Angeles?',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'msg-2',
      role: 'assistant',
      content: 'The time in LA is 03:45 AM PDT.',
      createdAt: new Date().toISOString(),
      thoughts: ['Consulting world clock service for America/Los_Angeles timezone.'],
      cards: [
        {
          cardType: 'time-in-zone',
          data: { timeString: '03:45 AM PDT', zone: 'America/Los_Angeles' },
        },
      ],
    },
  ];

  it('renders threads and messages in standalone layout', () => {
    render(
      <ChatWorkspace
        threads={mockThreads}
        messages={mockMessages}
        onSendMessage={vi.fn()}
      />
    );

    expect(screen.getByText('LA Time Verification')).toBeInTheDocument();
    expect(screen.getByText('React 19 Components')).toBeInTheDocument();
    expect(screen.getByText('What time is it in Los Angeles?')).toBeInTheDocument();
    expect(screen.getByText('The time in LA is 03:45 AM PDT.')).toBeInTheDocument();
  });

  it('fires onSelectThread and onNewThread events', () => {
    const onSelectThread = vi.fn();
    const onNewThread = vi.fn();

    render(
      <ChatWorkspace
        threads={mockThreads}
        messages={mockMessages}
        onSelectThread={onSelectThread}
        onNewThread={onNewThread}
        onSendMessage={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('React 19 Components'));
    expect(onSelectThread).toHaveBeenCalledWith('thread-2');

    const newChatBtn = screen.getByTitle('New Conversation');
    fireEvent.click(newChatBtn);
    expect(onNewThread).toHaveBeenCalledTimes(1);
  });

  it('handles model selection and popout window trigger', () => {
    const onModelChange = vi.fn();
    const onPopout = vi.fn();

    render(
      <ChatWorkspace
        threads={mockThreads}
        messages={mockMessages}
        onModelChange={onModelChange}
        onPopout={onPopout}
        onSendMessage={vi.fn()}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'gemini-2.5-pro' } });
    expect(onModelChange).toHaveBeenCalledWith('gemini-2.5-pro');

    const popoutBtn = screen.getByTitle('Open in separate window');
    fireEvent.click(popoutBtn);
    expect(onPopout).toHaveBeenCalledTimes(1);
  });

  it('renders custom tool cards through renderCustomCard prop', () => {
    const renderCustomCard = (card: CustomToolCard) => (
      <div data-testid="custom-rendered-card">
        Special Card: {card.cardType} - {String(card.data.timeString)}
      </div>
    );

    render(
      <ChatWorkspace
        threads={mockThreads}
        messages={mockMessages}
        renderCustomCard={renderCustomCard}
        onSendMessage={vi.fn()}
      />
    );

    const rendered = screen.getByTestId('custom-rendered-card');
    expect(rendered).toBeInTheDocument();
    expect(rendered).toHaveTextContent('Special Card: time-in-zone - 03:45 AM PDT');
  });

  it('displays thought processes when available', () => {
    render(
      <ChatWorkspace
        threads={mockThreads}
        messages={mockMessages}
        onSendMessage={vi.fn()}
      />
    );

    expect(screen.getByText(/Thinking Process/i)).toBeInTheDocument();
  });
});
