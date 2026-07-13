import { useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { Message } from '@/types';
import { MessageBubble } from './MessageBubble';

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
  streamingMessageId?: string;
  isVoiceMode?: boolean;
  onSuggestionClick?: (suggestion: string) => void;
}

const FALLBACK_SUGGESTIONS = [
  '总结今天值得关注的国内外新闻',
  '科技：今天 AI 行业有哪些新进展？',
  '财经：今天市场有哪些重要变化？',
  '生活：今天有哪些实用提醒？',
  '开源社区今天有哪些热门项目？',
  '帮我快速了解今天的热门话题',
];

export function MessageList({
  messages,
  isStreaming,
  streamingMessageId,
  isVoiceMode,
  onSuggestionClick,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [dailySuggestions, setDailySuggestions] = useState(FALLBACK_SUGGESTIONS);

  useEffect(() => {
    if (messages.length) return;
    const controller = new AbortController();
    void fetch('/api/daily-suggestions', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Daily suggestions request failed: ${response.status}`);
        return response.json();
      })
      .then(result => {
        const suggestions = Array.isArray(result?.suggestions)
          ? result.suggestions.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
          : [];
        if (suggestions.length) setDailySuggestions(suggestions.slice(0, 6));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [messages.length]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length]);

  useEffect(() => {
    if (isStreaming) {
      scrollToBottom();
    }
  }, [isStreaming]);

  function scrollToBottom() {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }

  function handleScroll() {
    if (!containerRef.current) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setShowScrollButton(scrollHeight - scrollTop - clientHeight > 100);
  }

  if (messages.length === 0) {
    return (
      <div className="h-full min-h-full overflow-y-auto px-4 pb-8 sm:px-6">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col items-center justify-start pt-20 text-center sm:pt-24 md:justify-center md:pb-16 md:pt-0">
          <h2 className="mb-8 text-[28px] font-semibold leading-tight text-slate-950 sm:text-[32px]">有什么我能帮你的吗？</h2>
          <div className="mx-auto flex max-w-4xl flex-wrap justify-center gap-2.5 sm:gap-3">
            {dailySuggestions.map((suggestion, index) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSuggestionClick?.(suggestion)}
                className={`${index >= 3 ? 'hidden sm:inline-flex' : 'inline-flex'} min-h-11 w-full max-w-sm cursor-pointer items-center justify-center whitespace-normal break-words rounded-xl bg-slate-100 px-4 py-2.5 text-center text-sm leading-5 text-slate-800 transition-colors duration-200 hover:bg-slate-200 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 active:bg-slate-300 sm:min-h-12 sm:w-auto sm:max-w-none sm:text-left`}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto px-3 py-6 md:px-6"
    >
      <div className="mx-auto w-full max-w-5xl">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            isStreaming={isStreaming && message.id === streamingMessageId}
            isVoiceMode={isVoiceMode}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {showScrollButton ? (
        <button
          onClick={scrollToBottom}
          className="glass fixed bottom-36 right-8 z-10 flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition-all hover:scale-110 hover:text-slate-900"
        >
          <ArrowDown className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );
}
