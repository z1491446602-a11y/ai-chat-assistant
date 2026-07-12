// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@/types';
import { MessageBubble } from './MessageBubble';

vi.mock('./MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => (
    <div className="ai-markdown" data-testid="markdown-probe">{content}</div>
  ),
}));

describe('MessageBubble heavy render boundary', () => {
  it('renders assistant streaming content as literal React text without Markdown HTML', () => {
    const message: Message = {
      id: 'streaming-message',
      role: 'assistant',
      content: '<strong>literal</strong> **still streaming**',
      timestamp: 1_000,
      status: 'streaming',
    };

    const { container } = render(<MessageBubble message={message} isStreaming />);

    expect(screen.getByText('<strong>literal</strong> **still streaming**')).toBeTruthy();
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('.ai-markdown')).toBeNull();
  });

  it('keeps a restored streaming message on the plain-text boundary without a live prop', () => {
    const message: Message = {
      id: 'restored-streaming-message',
      role: 'assistant',
      content: '<strong>literal</strong> **restored stream**',
      timestamp: 1_000,
      status: 'streaming',
    };

    const { container } = render(<MessageBubble message={message} />);

    expect(screen.getByText('<strong>literal</strong> **restored stream**')).toBeTruthy();
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('.ai-markdown')).toBeNull();
  });

  it('loads the completed Markdown renderer for assistant content', async () => {
    const message: Message = {
      id: 'completed-message',
      role: 'assistant',
      content: '## Complete',
      timestamp: 1_000,
      status: 'sent',
    };

    const { container } = render(<MessageBubble message={message} />);

    expect(await screen.findByTestId('markdown-probe')).toBeTruthy();
    expect(container.querySelector('.ai-markdown')).not.toBeNull();
  });
});
