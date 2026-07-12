// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@/types';
import { MessageBubble } from './MessageBubble';

vi.mock('./MarkdownContent', () => {
  throw new Error('Markdown chunk unavailable');
});

afterEach(cleanup);

describe('MessageBubble lazy Markdown failure', () => {
  it('keeps escaped plain content visible when the Markdown chunk rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const message: Message = {
      id: 'failed-markdown-message',
      role: 'assistant',
      content: '<strong>safe fallback</strong>',
      timestamp: 1_000,
      status: 'sent',
    };

    const { container } = render(<MessageBubble message={message} />);

    expect(await screen.findByText('格式化内容加载失败，已显示纯文本。')).toBeTruthy();
    expect(screen.getByText('<strong>safe fallback</strong>')).toBeTruthy();
    expect(container.querySelector('strong')).toBeNull();
  });
});
