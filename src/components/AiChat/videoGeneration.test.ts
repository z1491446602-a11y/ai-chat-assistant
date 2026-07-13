// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  MAX_VIDEO_REFERENCE_BYTES,
  MAX_VIDEO_REFERENCE_IMAGES,
  VIDEO_STAGE_LABELS,
  validateVideoReferenceFiles,
} from './videoGeneration';

describe('video generation reference files', () => {
  it('accepts up to three PNG, JPEG, or WebP files within 10 MB', () => {
    const files = [
      new File(['png'], 'first.png', { type: 'image/png' }),
      new File(['webp'], 'second.webp', { type: 'image/webp' }),
      new File(['jpeg'], 'third.jpg', { type: 'image/jpeg' }),
    ];

    expect(validateVideoReferenceFiles(files, 0)).toEqual(files);
    expect(MAX_VIDEO_REFERENCE_IMAGES).toBe(3);
  });

  it('rejects unsupported, oversized, and excess reference files', () => {
    const unsupported = new File(['gif'], 'reference.gif', { type: 'image/gif' });
    const oversized = new File([new Uint8Array(MAX_VIDEO_REFERENCE_BYTES + 1)], 'large.jpg', { type: 'image/jpeg' });
    const valid = new File(['jpg'], 'valid.jpg', { type: 'image/jpeg' });

    expect(() => validateVideoReferenceFiles([unsupported], 0)).toThrow('PNG、JPEG 或 WebP');
    expect(() => validateVideoReferenceFiles([oversized], 0)).toThrow('10 MB');
    expect(() => validateVideoReferenceFiles([valid, valid], 2)).toThrow('最多添加 3 张');
  });
});

describe('video generation stages', () => {
  it('exposes the exact human labels for every in-progress stage', () => {
    expect(VIDEO_STAGE_LABELS).toEqual({
      submitting: '正在提交视频任务',
      queued: '视频任务已排队',
      processing: '视频正在生成中',
      downloading: '正在下载视频',
      validating: '正在验证并保存视频',
    });
  });
});
