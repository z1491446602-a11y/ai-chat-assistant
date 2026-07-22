// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageInputPanel } from './ImageInputPanel';

afterEach(cleanup);

const imageProviderOptions = [
  { value: 'gpt' as const, label: '生成图片-GPT' },
  { value: 'grok' as const, label: '生成图片-Grok' },
];

function renderPanel(patch = {}) {
  const props = {
    images: [],
    selectedProvider: 'gpt' as const,
    providerOptions: imageProviderOptions,
    busy: false,
    onPick: vi.fn(),
    onRemove: vi.fn(),
    onSelectProvider: vi.fn(),
    ...patch,
  };
  return { ...render(<ImageInputPanel {...props} />), props };
}

describe('ImageInputPanel compact toolbar', () => {
  it('keeps image controls collapsed into a compact toolbar', () => {
    renderPanel();

    expect(screen.getByRole('group', { name: '图片生成选项' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '素材 0' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '模型 GPT' })).toBeTruthy();
    expect(screen.queryByText('添加参考图')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a model menu and selects Grok', () => {
    const onSelectProvider = vi.fn();
    renderPanel({ onSelectProvider });

    fireEvent.click(screen.getByRole('button', { name: '模型 GPT' }));

    expect(screen.getByRole('menu', { name: '选择图片模型' })).toBeTruthy();
    expect(screen.getByText('精细生成与图片编辑')).toBeTruthy();
    expect(screen.getByText('创意图片生成')).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: '生成图片-GPT' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('menuitemradio', { name: '生成图片-Grok' }));
    expect(onSelectProvider).toHaveBeenCalledWith('grok');
    expect(screen.queryByRole('menu', { name: '选择图片模型' })).toBeNull();
  });

  it('keeps reference upload and previews inside the material menu', () => {
    const onPick = vi.fn();
    const onRemove = vi.fn();
    renderPanel({
      images: ['data:image/jpeg;base64,one', 'data:image/jpeg;base64,two'],
      onPick,
      onRemove,
    });

    expect(screen.getByRole('button', { name: '素材 2' })).toBeTruthy();
    expect(screen.queryByAltText('图片参考图 1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '素材 2' }));

    fireEvent.click(screen.getByRole('menuitem', { name: '添加参考图' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(screen.getByAltText('图片参考图 1')).toBeTruthy();
    expect(screen.getByAltText('图片参考图 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '移除图片参考图 2' }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('closes an open menu with Escape or an outside click', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '模型 GPT' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: '选择图片模型' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '素材 0' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu', { name: '选择图片素材' })).toBeNull();
  });
});
