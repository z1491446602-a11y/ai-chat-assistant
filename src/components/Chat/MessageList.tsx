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

const QUICK_SUGGESTIONS = ['写一首诗', '解释量子计算', '帮我写代码'];

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
      <div className="flex h-full min-h-full items-start justify-center px-6 pb-10 pt-12 md:items-center md:py-10">
        <div className="w-full max-w-2xl text-center">
          <div className="mx-auto mb-6 h-20 w-20 overflow-hidden rounded-3xl bg-gradient-to-br from-sky-100 to-blue-100 shadow-[0_12px_28px_rgba(37,99,235,0.10)]">
            <img
              src="/avatar.jpg"
              alt="人工智障"
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
          <h2 className="mb-3 text-[28px] font-semibold tracking-tight text-gray-900">人工智障</h2>
          <p className="mb-8 text-sm leading-7 text-gray-500">
            内容由 AI 生成，请注意甄别。
            <br />
            支持多轮对话、代码高亮、Markdown、公式、流程图和图片理解。
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {QUICK_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSuggestionClick?.(suggestion)}
                className="rounded-full border border-sky-100 bg-white/92 px-5 py-2.5 text-sm text-slate-600 transition-all hover:border-sky-300 hover:text-slate-900 hover:shadow-sm active:scale-[0.98]"
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
