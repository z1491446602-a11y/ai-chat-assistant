// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiChatComposerAttachments } from './AiChatComposerAttachments';

afterEach(cleanup);

function renderComposer(patch = {}) {
  const props = {
    showMoreActions: false,
    effectiveImageGenerationMode: false,
    isVideoGenerationMode: false,
    isGeneratingVideoTask: false,
    isUploadingImages: false,
    isUploadingFile: false,
    disabled: false,
    mediaAuthenticated: true,
    imageGenerationAllowed: true,
    videoGenerationAllowed: true,
    onRequireLogin: vi.fn(),
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
    expect(screen.getByRole('button', { name: '生成图片' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '选择图片生成模型' })).toBeNull();
    expect(screen.queryByText(/deepseek/i)).toBeNull();
  });

  it('replaces media entries with one compact image-mode chip while active', () => {
    renderComposer({ effectiveImageGenerationMode: true });

    expect(screen.getByRole('button', { name: '关闭图片生成' })).toBeTruthy();
    expect(screen.getByText('图片生成')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '生成视频' })).toBeNull();
    expect(screen.queryByRole('button', { name: '选择图片生成模型' })).toBeNull();
  });

  it('replaces image controls with one compact video-mode chip while active', () => {
    renderComposer({ isVideoGenerationMode: true });

    expect(screen.getByRole('button', { name: '关闭视频生成' })).toBeTruthy();
    expect(screen.getByText('视频生成')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '生成图片-GPT' })).toBeNull();
    expect(screen.queryByRole('button', { name: '选择图片生成模型' })).toBeNull();
  });

  it('keeps only image and document uploads in the plus menu', () => {
    const { container } = renderComposer({ showMoreActions: true });
    const menu = container.querySelector('.absolute.bottom-12');
    expect(menu).toBeTruthy();
    expect(within(menu as HTMLElement).getByText('上传图片')).toBeTruthy();
    expect(within(menu as HTMLElement).getByText('上传文档')).toBeTruthy();
    expect(within(menu as HTMLElement).queryByText('生成视频')).toBeNull();
  });

  it('opens login instead of media controls for guests', () => {
    const onRequireLogin = vi.fn();
    const onToggleImageGenerationMode = vi.fn();
    const onToggleVideoGenerationMode = vi.fn();
    const view = renderComposer({
      mediaAuthenticated: false,
      imageGenerationAllowed: false,
      videoGenerationAllowed: false,
      onRequireLogin,
      onToggleImageGenerationMode,
      onToggleVideoGenerationMode,
    });

    fireEvent.click(within(view.container).getByRole('button', { name: '生成图片' }));
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
      mediaAuthenticated: false,
      imageGenerationAllowed: false,
      videoGenerationAllowed: false,
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
      screen.getByRole('button', { name: '生成图片' }),
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

  });

  it('collapses media labels below 361px so the toolbar stays within a 320px viewport', () => {
    renderComposer();

    expect(screen.getByText('生成图片').className).toContain('max-[360px]:hidden');
    expect(screen.getByText('生成视频').className).toContain('max-[360px]:hidden');
  });
});
