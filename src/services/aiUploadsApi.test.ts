import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadAiDocument } from './aiUploadsApi';

function fetchMock() {
  return vi.mocked(fetch);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AI document upload API', () => {
  it('does not retry and localizes an upload network failure', async () => {
    fetchMock().mockRejectedValue(new TypeError('fetch failed'));
    const input = {
      fileName: 'notes.txt',
      fileData: 'data:text/plain;base64,aGVsbG8=',
      mimeType: 'text/plain',
    };

    await expect(uploadAiDocument(input)).rejects.toThrow('文件上传失败，请检查网络后重试');
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect(fetchMock()).toHaveBeenCalledWith('/api/upload-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'ai', ...input }),
    });
  });

  it('keeps a structured upload business error unchanged', async () => {
    fetchMock().mockResolvedValueOnce(new Response(JSON.stringify({ error: '文件类型不支持' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(uploadAiDocument({
      fileName: 'notes.exe',
      fileData: 'data:application/octet-stream;base64,eA==',
      mimeType: 'application/octet-stream',
    })).rejects.toThrow('文件类型不支持');
  });
});
