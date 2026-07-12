// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AiChatComposerAttachments } from './AiChatComposerAttachments';

const imageProviderOptions = [
  { value: 'gpt' as const, label: '生成图片-GPT' },
  { value: 'grok' as const, label: '生成图片-Grok' },
];

function renderComposer(patch = {}) {
  const props = {
    selectedImageProviderLabel: '生成图片-GPT',
    showMoreActions: false,
    showImageProviderMenu: false,
    imageProviderOptions,
    effectiveImageGenerationMode: false,
    isVideoGenerationMode: false,
    isGeneratingVideoTask: false,
    isUploadingImages: false,
    isUploadingFile: false,
    onToggleImageProviderMenu: vi.fn(),
    onSelectImageProvider: vi.fn(),
    onToggleImageGenerationMode: vi.fn(),
    onToggleVideoGenerationMode: vi.fn(),
    onOpenMoreActions: vi.fn(),
    onOpenAiImagePicker: vi.fn(),
    onOpenAiFilePicker: vi.fn(),
    ...patch,
  };
  return { ...render(<AiChatComposerAttachments {...props} />), props };
}

describe('AI chat composer actions', () => {
  it('keeps image and video generation controls', () => {
    renderComposer();
    expect(screen.getByRole('button', { name: '生成视频' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '生成图片-GPT' })).toBeTruthy();
    expect(screen.queryByText(/deepseek/i)).toBeNull();
  });

  it('keeps only image and document uploads in the plus menu', () => {
    const { container } = renderComposer({ showMoreActions: true });
    const menu = container.querySelector('.absolute.bottom-12');
    expect(menu).toBeTruthy();
    expect(within(menu as HTMLElement).getByText('上传图片')).toBeTruthy();
    expect(within(menu as HTMLElement).getByText('上传文档')).toBeTruthy();
    expect(within(menu as HTMLElement).queryByText('生成视频')).toBeNull();
  });

  it('selects Grok from the provider menu', () => {
    const onSelectImageProvider = vi.fn();
    renderComposer({ showImageProviderMenu: true, onSelectImageProvider });
    fireEvent.click(screen.getByRole('button', { name: '生成图片-Grok' }));
    expect(onSelectImageProvider).toHaveBeenCalledWith('grok');
  });
});
