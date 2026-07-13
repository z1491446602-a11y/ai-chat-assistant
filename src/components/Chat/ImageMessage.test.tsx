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
    const surface = download.closest('.overflow-hidden');

    expect(surface?.className).toContain('min-w-0');
    expect(surface?.className).toContain('max-w-full');
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

  it('shows multiple generated images in one horizontally scrollable preview track', () => {
    const message = createMessage({
      images: ['/uploads/one.png', '/uploads/two.png', '/uploads/three.png'],
      imageWidth: 1024,
      imageHeight: 1536,
      status: 'sent',
    });

    render(<ImageMessage message={message} />);

    const gallery = screen.getByRole('region', { name: '可横向滑动浏览 3 张生成图片' });
    const previews = within(gallery).getAllByRole('link', { name: /查看原图/ });

    expect(gallery.className).toContain('overflow-x-auto');
    expect(gallery.className).toContain('snap-x');
    expect(previews).toHaveLength(3);
    expect(previews[0].className).toContain('shrink-0');
    expect(previews[0].className).toContain('snap-start');
    expect(previews[0].style.aspectRatio).toBe('1024 / 1536');
    expect(within(previews[0]).getByRole('img').className).toContain('object-contain');
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
