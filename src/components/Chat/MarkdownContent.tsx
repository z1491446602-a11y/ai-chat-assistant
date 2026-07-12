import { useEffect, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';
import { renderMarkdown } from '@/utils/markdown';
import { loadMermaid } from '@/utils/mermaidLoader';

interface MarkdownContentProps {
  content: string;
}

let mermaidRenderId = 0;

export function MarkdownContent({ content }: MarkdownContentProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sanitizedHtml = useMemo(
    () => DOMPurify.sanitize(renderMarkdown(content), { ADD_ATTR: ['target'] }),
    [content],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    let cancelled = false;
    const copyResetTimers = new Map<HTMLButtonElement, { timer: number; previousText: string | null }>();

    const handleClick = async (event: Event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>('.copy-btn');
      if (!button || !root.contains(button)) {
        return;
      }

      const code = button.closest('.code-block')?.querySelector('code')?.textContent ?? '';
      if (!code) {
        return;
      }

      try {
        await navigator.clipboard.writeText(code);
        if (cancelled || !root.contains(button)) {
          return;
        }

        const existingReset = copyResetTimers.get(button);
        if (existingReset) {
          window.clearTimeout(existingReset.timer);
        }
        const previousText = existingReset?.previousText ?? button.textContent;
        button.textContent = 'Copied';
        const timer = window.setTimeout(() => {
          button.textContent = previousText;
          copyResetTimers.delete(button);
        }, 1200);
        copyResetTimers.set(button, { timer, previousText });
      } catch (error) {
        console.error('Failed to copy code block', error);
      }
    };

    root.addEventListener('click', handleClick);
    return () => {
      cancelled = true;
      root.removeEventListener('click', handleClick);
      copyResetTimers.forEach(({ timer, previousText }, button) => {
        window.clearTimeout(timer);
        button.textContent = previousText;
      });
      copyResetTimers.clear();
    };
  }, [sanitizedHtml]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const blocks = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-block'));
    if (!blocks.length) {
      return;
    }

    const targets = blocks.flatMap(block => {
      const source = block.querySelector<HTMLElement>('.mermaid-source')?.textContent?.trim();
      if (!source || block.dataset.rendered === 'true') {
        return [];
      }

      block.dataset.rendered = 'loading';
      return [{ block, source }];
    });
    if (!targets.length) {
      return;
    }

    let cancelled = false;
    const isActive = (block: HTMLElement) => (
      !cancelled && root.contains(block) && block.dataset.rendered === 'loading'
    );

    const showLoading = (block: HTMLElement) => {
      block.dataset.rendered = 'loading';
      const loading = document.createElement('div');
      loading.className = 'mermaid-loading';
      loading.textContent = '正在渲染流程图...';
      block.replaceChildren(loading);
    };

    const renderBlock = async (block: HTMLElement, source: string): Promise<void> => {
      try {
        const mermaid = await loadMermaid();
        if (!isActive(block)) {
          return;
        }

        const { svg } = await mermaid.render(`mermaid-${++mermaidRenderId}`, source);
        if (!isActive(block)) {
          return;
        }

        const diagram = document.createElement('div');
        diagram.className = 'mermaid-diagram';
        diagram.innerHTML = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
        });
        block.replaceChildren(diagram);
        block.dataset.rendered = 'true';
      } catch (error) {
        if (!isActive(block)) {
          return;
        }

        console.error('Failed to load or render mermaid diagram', error);
        const failure = document.createElement('div');
        failure.className = 'rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-500';
        const failureText = document.createElement('div');
        failureText.textContent = '流程图加载失败';
        const retryButton = document.createElement('button');
        retryButton.type = 'button';
        retryButton.className = 'mt-2 rounded-lg border border-red-200 bg-white px-3 py-1 text-xs text-red-600';
        retryButton.textContent = '重试流程图';
        retryButton.addEventListener('click', () => {
          if (cancelled || !root.contains(block)) {
            return;
          }
          showLoading(block);
          void renderBlock(block, source);
        });
        failure.append(failureText, retryButton);
        block.replaceChildren(failure);
        block.dataset.rendered = 'error';
      }
    };

    targets.forEach(({ block, source }) => {
      void renderBlock(block, source);
    });

    return () => {
      cancelled = true;
      targets.forEach(({ block }) => {
        if (block.dataset.rendered === 'loading') {
          delete block.dataset.rendered;
        }
      });
    };
  }, [sanitizedHtml]);

  return (
    <div
      ref={rootRef}
      className="ai-markdown break-words text-[15px] leading-7 text-gray-800"
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
}
