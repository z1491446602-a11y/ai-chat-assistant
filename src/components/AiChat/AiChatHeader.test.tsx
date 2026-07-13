// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AiChatHeader } from './AiChatHeader';

describe('AiChatHeader', () => {
  it('renders the product name with a soft sans-serif style and AI disclosure', () => {
    const { container } = render(<AiChatHeader />);

    const heading = screen.getByRole('heading', { name: '人工智障' });
    expect(heading.className).toContain('font-semibold');
    expect(heading.getAttribute('style')).toContain('Microsoft YaHei UI');
    expect(screen.getByText('内容由 AI 生成')).toBeTruthy();
    expect(container.querySelector('header')?.className).toContain('justify-center');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });
});
