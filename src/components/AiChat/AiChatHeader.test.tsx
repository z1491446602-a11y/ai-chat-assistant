// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AiChatHeader } from './AiChatHeader';

describe('AiChatHeader', () => {
  it('renders the compact product name without secondary copy', () => {
    const { container } = render(<AiChatHeader />);

    expect(screen.getByRole('heading', { name: '人工智障' })).toBeTruthy();
    expect(container.querySelector('header')?.className).toContain('justify-center');
    expect(container.querySelector('p')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });
});
