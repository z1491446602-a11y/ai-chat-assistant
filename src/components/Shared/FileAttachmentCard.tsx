import { Download, FileText } from 'lucide-react';

interface FileAttachmentCardProps {
  fileName: string;
  fileUrl: string;
  fileSize?: number;
  mimeType?: string;
  isCurrentUser?: boolean;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) {
    return '';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function getFileExtension(fileName: string): string {
  const segments = fileName.split('.');
  if (segments.length <= 1) {
    return 'FILE';
  }

  return segments[segments.length - 1].slice(0, 6).toUpperCase();
}

export function FileAttachmentCard({
  fileName,
  fileUrl,
  fileSize,
  mimeType,
  isCurrentUser = false,
}: FileAttachmentCardProps) {
  const meta = [formatFileSize(fileSize), mimeType].filter(Boolean).join(' · ');

  return (
    <a
      href={fileUrl}
      download={fileName}
      target="_blank"
      rel="noreferrer"
      className={`flex min-w-[220px] max-w-[320px] items-center gap-3 rounded-2xl border px-3 py-3 transition-all hover:-translate-y-0.5 hover:shadow-sm ${
        isCurrentUser
          ? 'border-white/20 bg-white/15 text-white hover:bg-white/20'
          : 'border-sky-100 bg-white text-gray-800 hover:border-sky-200'
      }`}
    >
      <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl ${
        isCurrentUser ? 'bg-white/20 text-white' : 'bg-sky-50 text-sky-600'
      }`}>
        <FileText className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{fileName}</div>
        <div className={`mt-1 flex items-center gap-2 text-xs ${
          isCurrentUser ? 'text-white/80' : 'text-gray-500'
        }`}>
          <span>{getFileExtension(fileName)}</span>
          {meta ? <span className="truncate">{meta}</span> : null}
        </div>
      </div>
      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
        isCurrentUser ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
      }`}>
        <Download className="h-4 w-4" />
      </div>
    </a>
  );
}
