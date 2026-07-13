// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageList } from './MessageList';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MessageList daily suggestions', () => {
  it('loads current daily topics and sends the selected topic', async () => {
    const onSuggestionClick = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        date: '2026-07-13',
        suggestions: [
          '热点：今天国内有哪些值得关注的新闻？',
          '科技：今天 AI 行业有哪些新进展？',
        ],
      }),
    }));

    const view = render(
      <MessageList
        messages={[]}
        isStreaming={false}
        onSuggestionClick={onSuggestionClick}
      />,
    );

    expect(await view.findByText('有什么我能帮你的吗？')).toBeTruthy();
    expect(view.queryByText('支持多轮对话、代码高亮、Markdown、公式、流程图和图片理解。')).toBeNull();
    expect(view.queryByRole('img', { name: '人工智障' })).toBeNull();
    const topic = await view.findByRole('button', {
      name: '热点：今天国内有哪些值得关注的新闻？',
    });
    fireEvent.click(topic);

    expect(fetch).toHaveBeenCalledWith('/api/daily-suggestions', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(onSuggestionClick).toHaveBeenCalledWith('热点：今天国内有哪些值得关注的新闻？');
  });

  it('keeps useful fallback topics when the daily request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const view = render(<MessageList messages={[]} isStreaming={false} />);

    expect(await view.findByRole('button', {
      name: '总结今天值得关注的国内外新闻',
    })).toBeTruthy();
  });
});
