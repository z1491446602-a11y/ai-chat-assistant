// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiChatComposerAttachments } from './AiChatComposerAttachments';

afterEach(cleanup);

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
    disabled: false,
    mediaEnabled: true,
    onRequireLogin: vi.fn(),
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

  it('opens login instead of media controls for guests', () => {
    const onRequireLogin = vi.fn();
    const onToggleImageGenerationMode = vi.fn();
    const onToggleVideoGenerationMode = vi.fn();
    const view = renderComposer({
      mediaEnabled: false,
      onRequireLogin,
      onToggleImageGenerationMode,
      onToggleVideoGenerationMode,
    });

    fireEvent.click(within(view.container).getByRole('button', { name: '生成图片-GPT' }));
    fireEvent.click(within(view.container).getByRole('button', { name: '生成视频' }));

    expect(onRequireLogin).toHaveBeenCalledTimes(2);
    expect(onToggleImageGenerationMode).not.toHaveBeenCalled();
    expect(onToggleVideoGenerationMode).not.toHaveBeenCalled();
  });

  it('keeps ordinary attachment pickers available for a resolved guest', () => {
    const onOpenMoreActions = vi.fn();
    const onOpenAiImagePicker = vi.fn();
    const onOpenAiFilePicker = vi.fn();
    renderComposer({
      mediaEnabled: false,
      showMoreActions: true,
      onOpenMoreActions,
      onOpenAiImagePicker,
      onOpenAiFilePicker,
    });

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '上传图片' }));
    fireEvent.click(screen.getByRole('button', { name: '上传文档' }));

    expect(onOpenMoreActions).toHaveBeenCalledTimes(1);
    expect(onOpenAiImagePicker).toHaveBeenCalledTimes(1);
    expect(onOpenAiFilePicker).toHaveBeenCalledTimes(1);
  });

  it('disables attachment and media controls while authentication is unresolved', () => {
    const callbacks = {
      onRequireLogin: vi.fn(),
      onOpenMoreActions: vi.fn(),
      onOpenAiImagePicker: vi.fn(),
      onOpenAiFilePicker: vi.fn(),
      onToggleImageGenerationMode: vi.fn(),
      onToggleVideoGenerationMode: vi.fn(),
    };
    renderComposer({ disabled: true, showMoreActions: true, ...callbacks });

    const buttons = [
      screen.getByRole('button', { name: '更多操作' }),
      screen.getByRole('button', { name: '上传图片' }),
      screen.getByRole('button', { name: '上传文档' }),
      screen.getByRole('button', { name: '生成图片-GPT' }),
      screen.getByRole('button', { name: '选择图片生成模型' }),
      screen.getByRole('button', { name: '生成视频' }),
    ] as HTMLButtonElement[];

    buttons.forEach(button => {
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    });
    Object.values(callbacks).forEach(callback => expect(callback).not.toHaveBeenCalled());
  });

  it('renders attachment popovers as opaque surfaces below navigation overlays', () => {
    const moreActions = renderComposer({ showMoreActions: true });
    const moreActionsMenu = moreActions.container.querySelector('.absolute.bottom-12');

    expect(moreActionsMenu?.className).toContain('bg-white');
    expect(moreActionsMenu?.className).toContain('z-40');
    expect(moreActionsMenu?.className).not.toContain('bg-white/96');
    expect(moreActions.container.innerHTML).not.toContain('z-[70]');
    moreActions.unmount();

    const providers = renderComposer({ showImageProviderMenu: true });
    const providerMenu = within(providers.container)
      .getByRole('button', { name: '生成图片-Grok' }).parentElement;

    expect(providerMenu?.className).toContain('bg-white');
    expect(providerMenu?.className).toContain('z-40');
    expect(providerMenu?.className).not.toContain('bg-white/96');
    expect(providers.container.innerHTML).not.toContain('z-[80]');
  });

  it('collapses media labels below 361px so the toolbar stays within a 320px viewport', () => {
    renderComposer();

    expect(screen.getByText('GPT 生图').className).toContain('max-[360px]:hidden');
    expect(screen.getByText('生成视频').className).toContain('max-[360px]:hidden');
  });
});
