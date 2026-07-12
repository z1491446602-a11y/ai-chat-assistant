// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownContent } from './MarkdownContent';

const mermaidMocks = vi.hoisted(() => ({
  loadMermaid: vi.fn(),
  render: vi.fn(),
}));

vi.mock('@/utils/mermaidLoader', () => ({
  loadMermaid: mermaidMocks.loadMermaid,
}));

describe('MarkdownContent', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    mermaidMocks.render.mockResolvedValue({ svg: '<svg data-diagram="rendered"></svg>' });
    mermaidMocks.loadMermaid.mockResolvedValue({ render: mermaidMocks.render });
  });

  it('renders standard Markdown while preserving links, classes, and copy controls', () => {
    const { container } = render(
      <MarkdownContent content={'## Hello\n\n[OpenAI](https://openai.com)\n\n```js\nconst answer = 42;\n```'} />,
    );

    expect(screen.getByRole('heading', { name: 'Hello' }).className).toContain('text-xl');
    const link = screen.getByRole('link', { name: 'OpenAI' });
    expect(link.getAttribute('href')).toBe('https://openai.com');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.className).toContain('text-pink-500');
    expect(screen.getByRole('button', { name: 'Copy' }).className).toContain('copy-btn');
    expect(container.querySelector('code')?.className).toContain('language-js');
  });

  it('removes scripts and event-handler attributes from generated HTML', () => {
    const { container } = render(
      <MarkdownContent content={'<script>window.pwned = true</script><img src="x" onerror="window.pwned = true">'} />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('onerror')).toBeNull();
  });

  it('copies a delegated code block interaction', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<MarkdownContent content={'```ts\nconst value = 7;\n```'} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const value = 7;'));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('restarts the copy reset delay on rapid clicks', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<MarkdownContent content={'```ts\nconst value = 7;\n```'} />);
    const button = screen.getByRole('button', { name: 'Copy' });

    fireEvent.click(button);
    await act(async () => Promise.resolve());
    await act(async () => vi.advanceTimersByTime(500));
    fireEvent.click(button);
    await act(async () => Promise.resolve());
    await act(async () => vi.advanceTimersByTime(700));

    expect(button.textContent).toBe('Copied');
    await act(async () => vi.advanceTimersByTime(500));
    expect(button.textContent).toBe('Copy');
  });

  it('clears a pending copy reset when unmounted', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const { unmount } = render(<MarkdownContent content={'```ts\nconst value = 7;\n```'} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await act(async () => Promise.resolve());
    expect(vi.getTimerCount()).toBe(1);
    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('loads and renders Mermaid only when a Mermaid block exists', async () => {
    const { container } = render(<MarkdownContent content={'```mermaid\ngraph TD\nA-->B\n```'} />);

    await waitFor(() => expect(mermaidMocks.loadMermaid).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector('[data-diagram="rendered"]')).not.toBeNull());
    expect(mermaidMocks.render).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), 'graph TD\nA-->B');
  });

  it('renders Mermaid under React StrictMode without leaving the loading placeholder stuck', async () => {
    let resolveRender: ((value: { svg: string }) => void) | undefined;
    mermaidMocks.render.mockImplementation(() => new Promise(resolve => {
      resolveRender = resolve;
    }));
    const { container } = render(
      <StrictMode>
        <MarkdownContent content={'```mermaid\ngraph TD\nA-->B\n```'} />
      </StrictMode>,
    );

    await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalled());
    await act(async () => {
      resolveRender?.({ svg: '<svg data-diagram="strict-rendered"></svg>' });
      await Promise.resolve();
    });

    await waitFor(() => expect(container.querySelector('[data-diagram="strict-rendered"]')).not.toBeNull());
    expect(container.querySelector('.mermaid-loading')).toBeNull();
  });

  it('shows a safe Mermaid error with a working retry action when loading fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mermaidMocks.loadMermaid.mockRejectedValueOnce(new Error('chunk unavailable'));
    const { container } = render(<MarkdownContent content={'```mermaid\ngraph TD\nA-->B\n```'} />);

    fireEvent.click(await screen.findByRole('button', { name: '重试流程图' }));

    await waitFor(() => expect(container.querySelector('[data-diagram="rendered"]')).not.toBeNull());
    expect(screen.queryByText('流程图加载失败')).toBeNull();
  });
});
