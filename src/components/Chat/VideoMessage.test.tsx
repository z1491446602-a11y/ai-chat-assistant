// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@/types';
import { VideoMessage } from './VideoMessage';

describe('VideoMessage', () => {
  it('renders real stage progress, elapsed time, and the leave-page hint', () => {
    vi.spyOn(Date, 'now').mockReturnValue(70_000);
    const message = createMessage({ timestamp: 10_000, videoGenerationStage: 'processing', status: 'streaming' });

    render(<VideoMessage message={message} />);

    expect(screen.getByText('视频正在生成中')).toBeTruthy();
    expect(screen.getByText('已用时 1:00')).toBeTruthy();
    expect(screen.getByText('可以离开页面，稍后回来查看')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
    vi.restoreAllMocks();
  });

  it('renders a responsive metadata player and download link when complete', () => {
    const message = createMessage({
      videoUrl: '/generated/video.mp4',
      videoMimeType: 'video/mp4',
      videoFileName: 'scene.mp4',
      videoFileSize: 5 * 1024 * 1024,
      videoDuration: 12.4,
      videoWidth: 1280,
      videoHeight: 720,
      status: 'sent',
    });

    const { container } = render(<VideoMessage message={message} />);
    const video = container.querySelector('video');
    const source = container.querySelector('source');
    const download = screen.getByRole('link', { name: '下载视频' });
    const surface = download.closest('.overflow-hidden');

    expect(surface?.className).toContain('min-w-0');
    expect(surface?.className).toContain('max-w-full');
    expect(video?.controls).toBe(true);
    expect(video?.getAttribute('playsinline')).not.toBeNull();
    expect(video?.preload).toBe('metadata');
    expect(source?.getAttribute('src')).toBe('/generated/video.mp4');
    expect(source?.getAttribute('type')).toBe('video/mp4');
    expect(screen.getByText('1280×720 · 0:12 · 5 MB')).toBeTruthy();
    expect(download.getAttribute('href')).toBe('/generated/video.mp4');
    expect(download.getAttribute('download')).toBe('scene.mp4');
  });
});

function createMessage(patch: Partial<Message>): Message {
  return {
    id: 'video-message',
    role: 'assistant',
    content: '正在生成视频',
    timestamp: 10_000,
    ...patch,
  };
}
