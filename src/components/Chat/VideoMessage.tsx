import { useEffect, useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import type { Message } from '@/types';
import { VIDEO_STAGE_LABELS } from '@/components/AiChat/videoGeneration';

interface VideoMessageProps {
  message: Message;
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${Number(megabytes.toFixed(megabytes >= 10 ? 0 : 1))} MB`;
}

export function VideoMessage({ message }: VideoMessageProps) {
  const [now, setNow] = useState(() => Date.now());
  const isGenerating = Boolean(message.videoGenerationStage && message.status !== 'error' && !message.videoUrl);

  useEffect(() => {
    if (!isGenerating) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  if (message.videoUrl) {
    const metadata = [
      message.videoWidth && message.videoHeight ? `${message.videoWidth}×${message.videoHeight}` : null,
      typeof message.videoDuration === 'number' ? formatDuration(message.videoDuration) : null,
      typeof message.videoFileSize === 'number' ? formatFileSize(message.videoFileSize) : null,
    ].filter(Boolean).join(' · ');

    return (
      <div className="overflow-hidden rounded-lg border border-sky-100 bg-white shadow-sm">
        <div className="aspect-video w-full bg-black">
          <video className="h-full w-full object-contain" controls playsInline preload="metadata">
            <source src={message.videoUrl} type={message.videoMimeType || 'video/mp4'} />
          </video>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="min-w-0 truncate text-xs text-slate-500">{metadata || message.videoFileName || 'AI 生成视频'}</span>
          <a href={message.videoUrl} download={message.videoFileName || 'ai-video.mp4'} className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900" aria-label="下载视频">
            <Download className="h-3.5 w-3.5" />
            下载
          </a>
        </div>
      </div>
    );
  }

  if (!message.videoGenerationStage || message.status === 'error') {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - message.timestamp) / 1000));
  return (
    <div className="max-w-[24rem] rounded-lg border border-sky-100 bg-white px-4 py-3.5 shadow-sm" role="status">
      <div className="flex items-center gap-3">
        <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-sky-600" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">{VIDEO_STAGE_LABELS[message.videoGenerationStage]}</p>
          <p className="mt-1 text-xs text-slate-500">已用时 {formatDuration(elapsedSeconds)}</p>
        </div>
      </div>
      <p className="mt-3 border-t border-sky-50 pt-2 text-xs text-slate-400">可以离开页面，稍后回来查看</p>
    </div>
  );
}
