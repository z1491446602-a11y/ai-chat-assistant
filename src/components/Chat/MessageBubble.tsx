import { lazy, memo, Suspense, useEffect, useState } from 'react';
import { User } from 'lucide-react';
import type { Message } from '@/types';
import { ContentErrorBoundary } from '@/components/Shared/ContentErrorBoundary';
import { FileAttachmentCard } from '@/components/Shared/FileAttachmentCard';
import { AudioMessage } from '@/components/AiChat/AudioMessage';
import { ImageMessage } from './ImageMessage';
import { VideoMessage } from './VideoMessage';

const MarkdownContent = lazy(() => import('./MarkdownContent').then(module => ({
  default: module.MarkdownContent,
})));

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  isVoiceMode?: boolean;
}

const MessageBubbleComponent = ({
  message,
  isStreaming,
  isVoiceMode,
}: MessageBubbleProps) => {
  const isUser = message.role === 'user';
  const [showTranscript, setShowTranscript] = useState(false);
  const effectiveStreaming = Boolean(isStreaming || message.status === 'streaming');
  const filePreviewText = message.files?.[0] ? `[文件] ${message.files[0].fileName}` : '';
  const visibleContent = message.files?.length && message.content === filePreviewText ? '' : message.content;
  const hasAssistantAudio = !isUser && Boolean(message.audioUrl);
  const hasAssistantVideo = !isUser && Boolean(message.videoUrl || (message.videoGenerationStage && message.status !== 'error'));
  const hasAssistantImage = !isUser && Boolean(
    message.images?.length || (message.imageGenerationStage && message.status !== 'error'),
  );
  const isVoiceStreaming = Boolean(
    !isUser
    && effectiveStreaming
    && !hasAssistantAudio
    && String(message.content || '').trim() === '正在说话中...',
  );
  const shouldShowVoiceStreaming = Boolean(
    isVoiceStreaming
    || (!isUser && effectiveStreaming && !hasAssistantAudio && !hasAssistantImage && !hasAssistantVideo && isVoiceMode)
  );
  useEffect(() => {
    setShowTranscript(false);
  }, [message.id]);

  const renderUserImages = (imageUrls: string[]) => (
    <div className={`grid gap-2 ${imageUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {imageUrls.map((imageUrl, index) => (
        <div key={`${message.id}-user-image-${index}`}>
          <img
            src={imageUrl}
            alt={`upload-${index + 1}`}
            className="mx-auto block h-auto max-h-56 max-w-full rounded-[22px] border border-sky-200/60 object-contain"
            loading="lazy"
          />
        </div>
      ))}
    </div>
  );
  const renderAssistantTextBubble = () => (
    <div className="bubble-shell bubble-ai-cute px-4 py-3.5">
      {effectiveStreaming ? (
        <div className="break-words whitespace-pre-wrap text-[15px] leading-7 text-gray-800">
          {visibleContent}
        </div>
      ) : (
        <ContentErrorBoundary
          resetKey={visibleContent}
          fallback={(
            <div className="text-[15px] leading-7 text-gray-800">
              <div className="mb-2 text-xs text-amber-700">格式化内容加载失败，已显示纯文本。</div>
              <div className="break-words whitespace-pre-wrap">{visibleContent}</div>
            </div>
          )}
        >
          <Suspense fallback={(
            <div className="break-words whitespace-pre-wrap text-[15px] leading-7 text-gray-800">
              {visibleContent}
            </div>
          )}>
            <MarkdownContent content={visibleContent} />
          </Suspense>
        </ContentErrorBoundary>
      )}
      {effectiveStreaming ? <span className="mt-2 inline-block h-4 w-2 animate-pulse rounded bg-sky-300" /> : null}
    </div>
  );

  return (
    <div className={`mb-6 flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {isUser ? (
        <>
          <div className="max-w-[82%] md:max-w-[38rem]">
            <div className="bubble-shell bubble-user-cute px-4 py-3.5">
              {message.images?.length ? (
                <div className={message.content || message.files?.length ? 'mb-3' : ''}>
                  {renderUserImages(message.images)}
                </div>
              ) : null}
              {message.files?.length ? (
                <div className={`space-y-2 ${visibleContent || message.images?.length ? 'mb-3' : ''}`}>
                  {message.files.map((file, index) => (
                    <FileAttachmentCard
                      key={`${message.id}-file-${index}`}
                      fileName={file.fileName}
                      fileUrl={file.fileUrl}
                      fileSize={file.fileSize}
                      mimeType={file.mimeType}
                      isCurrentUser
                    />
                  ))}
                </div>
              ) : null}
              {visibleContent ? (
                <div className="break-words whitespace-pre-wrap text-[15px] leading-7 text-[#7b5133]">
                  {visibleContent}
                </div>
              ) : null}
              {effectiveStreaming ? <span className="ml-1 mt-1 inline-block h-4 w-2 animate-pulse rounded bg-white/80" /> : null}
            </div>
            <div className="mt-1 text-right text-xs text-gray-400">
              {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </div>
          <div className="flex-shrink-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.18)]" aria-label="你">
              <User className="h-5 w-5" />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex-shrink-0 pt-1">
            <div className="h-10 w-10 overflow-hidden rounded-full border border-sky-100 bg-white">
              <img
                src="/avatar.jpg"
                alt="AI日常聊天助手"
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
          </div>
          <div className="min-w-0 flex-1 max-w-3xl">
            {hasAssistantVideo ? (
              <div className="mb-3 w-full max-w-2xl">
                <VideoMessage message={message} />
              </div>
            ) : null}

            {hasAssistantImage ? (
              <div className="mb-3 w-full max-w-2xl">
                <ImageMessage message={message} />
              </div>
            ) : null}

            {hasAssistantAudio && message.audioUrl ? (
              <div className="mb-2 max-w-[22rem]">
                <AudioMessage
                  audioUrl={message.audioUrl}
                  duration={message.duration}
                  isCurrentUser={false}
                  transcript={visibleContent}
                  showTranscript={showTranscript}
                  onToggleTranscript={() => setShowTranscript(current => !current)}
                />
              </div>
            ) : null}

            {message.files?.length ? (
              <div className={`mb-3 space-y-2 ${visibleContent || message.images?.length ? '' : 'mt-1'}`}>
                {message.files.map((file, index) => (
                  <FileAttachmentCard
                    key={`${message.id}-file-${index}`}
                    fileName={file.fileName}
                    fileUrl={file.fileUrl}
                    fileSize={file.fileSize}
                    mimeType={file.mimeType}
                  />
                ))}
              </div>
            ) : null}

            {shouldShowVoiceStreaming ? (
              <div className="bubble-shell bubble-ai-cute bubble-speaking max-w-[18.5rem] px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="speaking-indicator" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-sky-700">正在说话中...</p>
                    <p className="mt-1 text-xs text-slate-500">语音生成完成后会直接发给你</p>
                  </div>
                </div>
              </div>
            ) : visibleContent && !hasAssistantAudio && !hasAssistantVideo && !hasAssistantImage ? (
              renderAssistantTextBubble()
            ) : (
              <div className="hidden" />
            )}

            <div className="mt-2 text-left text-xs text-gray-400">
              {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export const MessageBubble = memo(MessageBubbleComponent);

