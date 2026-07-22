// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoInputPanel } from './VideoInputPanel';

afterEach(cleanup);

function renderPanel(patch = {}) {
  const props = {
    inputs: {
      videoModel: 'seedance_1_5_pro_720p' as const,
      image: '',
      lastFrame: '',
      referenceImages: [],
      inputMode: 'frames' as const,
      durationSeconds: 5,
      aspectRatio: 'adaptive' as const,
    },
    busy: false,
    onPick: vi.fn(),
    onRemove: vi.fn(),
    onInputModeChange: vi.fn(),
    onModelChange: vi.fn(),
    onDurationChange: vi.fn(),
    onAspectRatioChange: vi.fn(),
    ...patch,
  };
  return { ...render(<VideoInputPanel {...props} />), props };
}

describe('Seedance 1.5 video toolbar', () => {
  it('offers 720p and 480p models and no retired 2.0 choices', () => {
    const onModelChange = vi.fn();
    renderPanel({ onModelChange });
    fireEvent.click(screen.getByRole('button', { name: /720p/ }));

    expect(screen.getByRole('menuitemradio', { name: /Seedance 1\.5 Pro 720p/ })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: /Seedance 1\.5 Pro 480p/ })).toBeTruthy();
    expect(screen.queryByRole('menuitemradio', { name: /Seedance 2\.0/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Seedance 1\.5 Pro 480p/ }));
    expect(onModelChange).toHaveBeenCalledWith('seedance_1_5_pro_480p');
  });

  it('shows first/last frame controls and hides reference-image mode', () => {
    const onPick = vi.fn();
    renderPanel({ onPick });
    fireEvent.click(screen.getByRole('button', { name: /素材 0/ }));

    expect(screen.getByRole('menuitem', { name: /添加首帧/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /添加尾帧/ })).toBeTruthy();
    expect(screen.queryByRole('menuitemradio', { name: /参考图模式/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /添加参考图/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /添加首帧/ }));
    expect(onPick).toHaveBeenCalledWith('image');
  });

  it('offers automatic and 4-12 second duration choices plus documented ratios', () => {
    const onDurationChange = vi.fn();
    const onAspectRatioChange = vi.fn();
    renderPanel({ onDurationChange, onAspectRatioChange });
    fireEvent.click(screen.getByRole('button', { name: /时长 5 秒/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '自动' }));
    expect(onDurationChange).toHaveBeenCalledWith(-1);
    fireEvent.click(screen.getByRole('button', { name: /比例 自适应/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '9:16' }));
    expect(onAspectRatioChange).toHaveBeenCalledWith('9:16');
  });
});
