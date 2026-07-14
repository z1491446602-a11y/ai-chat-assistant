// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoInputPanel } from './VideoInputPanel';

afterEach(cleanup);

describe('VideoInputPanel', () => {
  it('separates first frame, last frame, and three-view reference controls', () => {
    const onPick = vi.fn();
    render(<VideoInputPanel
      inputs={{ image: '', lastFrame: '', referenceImages: [] }}
      busy={false}
      onPick={onPick}
      onRemove={vi.fn()}
    />);

    const first = screen.getByRole('button', { name: '添加首帧' });
    const last = screen.getByRole('button', { name: '添加尾帧' }) as HTMLButtonElement;
    const references = screen.getByRole('button', { name: '添加角色参考图' });
    expect(first.className).toContain('min-h-11');
    expect(last.className).toContain('min-h-11');
    expect(references.className).toContain('min-h-11');
    expect(last.disabled).toBe(true);
    expect(screen.getByText('三视图 0/3')).toBeTruthy();

    fireEvent.click(first);
    fireEvent.click(references);
    expect(onPick).toHaveBeenNthCalledWith(1, 'image');
    expect(onPick).toHaveBeenNthCalledWith(2, 'referenceImages');
  });

  it('enables and labels populated inputs with independent removal', () => {
    const onPick = vi.fn();
    const onRemove = vi.fn();
    render(<VideoInputPanel
      inputs={{
        image: 'data:image/jpeg;base64,first',
        lastFrame: 'data:image/jpeg;base64,last',
        referenceImages: ['data:image/jpeg;base64,front', 'data:image/jpeg;base64,side'],
      }}
      busy={false}
      onPick={onPick}
      onRemove={onRemove}
    />);

    expect((screen.getByRole('button', { name: '更换尾帧' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('三视图 2/3')).toBeTruthy();
    expect(screen.getByAltText('视频首帧')).toBeTruthy();
    expect(screen.getByAltText('视频尾帧')).toBeTruthy();
    expect(screen.getByAltText('角色参考图 1')).toBeTruthy();
    expect(screen.getByAltText('角色参考图 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '移除尾帧' }));
    fireEvent.click(screen.getByRole('button', { name: '移除角色参考图 2' }));
    expect(onRemove).toHaveBeenNthCalledWith(1, 'lastFrame');
    expect(onRemove).toHaveBeenNthCalledWith(2, 'referenceImages', 1);
  });
});
