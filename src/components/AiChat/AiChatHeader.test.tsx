// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AiChatHeader } from './AiChatHeader';

describe('AiChatHeader', () => {
  it('renders a compact centered title without an avatar or duplicate navigation button', () => {
    const { container } = render(<AiChatHeader />);

    expect(screen.getByRole('heading', { name: 'AI 日常聊天助手' })).toBeTruthy();
    expect(container.querySelector('header')?.className).toContain('justify-center');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });
});
