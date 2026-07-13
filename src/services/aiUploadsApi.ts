import type { MessageFile } from '@/types';
import { createHttpError, readJsonResult } from './http';

interface AiDocumentUploadInput {
  fileName: string;
  fileData: string;
  mimeType: string;
}

export async function uploadAiDocument(input: AiDocumentUploadInput): Promise<MessageFile> {
  let response: Response;
  try {
    response = await fetch('/api/upload-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'ai', ...input }),
    });
  } catch {
    throw new Error('文件上传失败，请检查网络后重试');
  }
  const result = await readJsonResult(response);

  if (!response.ok) {
    throw createHttpError(response, result.error || '文件上传失败');
  }

  return {
    fileName: result.fileName,
    fileUrl: result.fileUrl,
    fileSize: result.fileSize,
    mimeType: result.mimeType,
  };
}
