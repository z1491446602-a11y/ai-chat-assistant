// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  createEmptyVideoGenerationInputs,
  getVideoGenerationImageCount,
  MAX_VIDEO_REFERENCE_BYTES,
  MAX_VIDEO_REFERENCE_IMAGES,
  VIDEO_STAGE_LABELS,
  validateVideoInputFiles,
} from './videoGeneration';

describe('video generation reference files', () => {
  it('accepts up to three PNG, JPEG, or WebP files within 10 MB', () => {
    const files = [
      new File(['png'], 'first.png', { type: 'image/png' }),
      new File(['webp'], 'second.webp', { type: 'image/webp' }),
      new File(['jpeg'], 'third.jpg', { type: 'image/jpeg' }),
    ];

    expect(validateVideoInputFiles(files, 'referenceImages', 0)).toEqual(files);
    expect(MAX_VIDEO_REFERENCE_IMAGES).toBe(3);
  });

  it('rejects unsupported, oversized, and excess reference files', () => {
    const unsupported = new File(['gif'], 'reference.gif', { type: 'image/gif' });
    const oversized = new File([new Uint8Array(MAX_VIDEO_REFERENCE_BYTES + 1)], 'large.jpg', { type: 'image/jpeg' });
    const valid = new File(['jpg'], 'valid.jpg', { type: 'image/jpeg' });

    expect(() => validateVideoInputFiles([unsupported], 'referenceImages', 0)).toThrow('PNG、JPEG 或 WebP');
    expect(() => validateVideoInputFiles([oversized], 'referenceImages', 0)).toThrow('10 MB');
    expect(() => validateVideoInputFiles([valid, valid], 'referenceImages', 2)).toThrow('最多添加 3 张');
  });

  it('keeps frame selection single while reference selection can fill three slots', () => {
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const second = new File(['second'], 'second.png', { type: 'image/png' });

    expect(validateVideoInputFiles([first, second], 'image', 0)).toEqual([first]);
    expect(validateVideoInputFiles([first, second], 'lastFrame', 0)).toEqual([first]);
    expect(validateVideoInputFiles([first, second], 'referenceImages', 1)).toEqual([first, second]);
  });

  it('creates and counts structured video inputs', () => {
    const empty = createEmptyVideoGenerationInputs();
    expect(empty).toEqual({ image: '', lastFrame: '', referenceImages: [] });
    expect(getVideoGenerationImageCount(empty)).toBe(0);
    expect(getVideoGenerationImageCount({
      image: 'first', lastFrame: 'last', referenceImages: ['front', 'side', 'back'],
    })).toBe(5);
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
