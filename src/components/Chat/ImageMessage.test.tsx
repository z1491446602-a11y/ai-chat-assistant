// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@/types';
import { ImageMessage } from './ImageMessage';

describe('ImageMessage', () => {
  it('renders real stage progress, elapsed time, and the leave-page hint', () => {
    vi.spyOn(Date, 'now').mockReturnValue(70_000);
    const message = createMessage({
      timestamp: 10_000,
      imageGenerationStage: 'generating',
      status: 'streaming',
    });

    render(<ImageMessage message={message} />);

    expect(screen.getByText('图片正在生成中')).toBeTruthy();
    expect(screen.getByText('已用时 1:00')).toBeTruthy();
    expect(screen.getByText('可以离开页面，稍后回来查看')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
    vi.restoreAllMocks();
  });

  it('renders a responsive metadata preview and download link when complete', () => {
    const message = createMessage({
      images: ['/uploads/generated.png'],
      imageFileName: 'generated.png',
      imageFileSize: 2.5 * 1024 * 1024,
      imageMimeType: 'image/png',
      imageWidth: 1536,
      imageHeight: 1024,
      imageProvider: 'gpt',
      status: 'sent',
    });

    const { container } = render(<ImageMessage message={message} />);
    const image = container.querySelector('img');
    const download = screen.getByRole('link', { name: '下载图片' });

    expect(image?.getAttribute('src')).toBe('/uploads/generated.png');
    expect(image?.className).toContain('object-contain');
    expect(screen.getByText('GPT · 1536×1024 · 2.5 MB')).toBeTruthy();
    expect(download.getAttribute('href')).toBe('/uploads/generated.png');
    expect(download.getAttribute('download')).toBe('generated.png');
  });

  it('keeps old generated image records usable without metadata', () => {
    const message = createMessage({ images: ['/uploads/legacy.png'], status: 'sent' });

    const { container } = render(<ImageMessage message={message} />);

    expect(within(container).getByText('AI 生成图片')).toBeTruthy();
    expect(within(container).getByRole('link', { name: '下载图片' }).getAttribute('href')).toBe('/uploads/legacy.png');
  });
});

function createMessage(patch: Partial<Message>): Message {
  return {
    id: 'image-message',
    role: 'assistant',
    content: '正在生成图片',
    timestamp: 10_000,
    ...patch,
  };
}
