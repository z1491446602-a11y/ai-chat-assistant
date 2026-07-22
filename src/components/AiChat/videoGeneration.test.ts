// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  createEmptyVideoGenerationInputs,
  getVideoGenerationImageCount,
  getFilesFromTransfer,
  MAX_VIDEO_REFERENCE_BYTES,
  MAX_VIDEO_REFERENCE_IMAGES,
  appendVideoImageMarkers,
  VIDEO_STAGE_LABELS,
  getVideoImageOutputDimensions,
  validateVideoImageDimensions,
  validateVideoInputFiles,
  normalizeVideoInputsForModel,
} from './videoGeneration';

describe('video generation reference files', () => {
  it('reads image files exposed through drag or clipboard items', () => {
    const file = new File(['image'], 'reference.png', { type: 'image/png' });
    const transfer = {
      files: [],
      items: [{ kind: 'file', getAsFile: () => file }],
    } as unknown as DataTransfer;

    expect(getFilesFromTransfer(transfer)).toEqual([file]);
  });

  it('accepts up to nine PNG, JPEG, or WebP files within 10 MB', () => {
    const files = [
      new File(['png'], 'first.png', { type: 'image/png' }),
      new File(['webp'], 'second.webp', { type: 'image/webp' }),
      new File(['jpeg'], 'third.jpg', { type: 'image/jpeg' }),
    ];

    expect(validateVideoInputFiles(files, 'referenceImages', 0)).toEqual(files);
    expect(MAX_VIDEO_REFERENCE_IMAGES).toBe(9);
  });

  it('rejects unsupported, oversized, and excess reference files', () => {
    const unsupported = new File(['gif'], 'reference.gif', { type: 'image/gif' });
    const oversized = new File([new Uint8Array(MAX_VIDEO_REFERENCE_BYTES + 1)], 'large.jpg', { type: 'image/jpeg' });
    const valid = new File(['jpg'], 'valid.jpg', { type: 'image/jpeg' });

    expect(() => validateVideoInputFiles([unsupported], 'referenceImages', 0)).toThrow('PNG、JPEG 或 WebP');
    expect(() => validateVideoInputFiles([oversized], 'referenceImages', 0)).toThrow('10 MB');
    expect(() => validateVideoInputFiles(
      Array.from({ length: 2 }, () => valid), 'referenceImages', 8,
    )).toThrow('视频图片最多 9 张');
  });

  it('keeps frame selection single while reference selection can fill nine slots', () => {
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const second = new File(['second'], 'second.png', { type: 'image/png' });

    expect(validateVideoInputFiles([first, second], 'image', 0)).toEqual([first]);
    expect(validateVideoInputFiles([first, second], 'lastFrame', 0)).toEqual([first]);
    expect(validateVideoInputFiles([first, second], 'referenceImages', 1)).toEqual([first, second]);
  });

  it('rejects mixing frame and subject-reference inputs', () => {
    const image = new File(['image'], 'image.png', { type: 'image/png' });

    expect(() => validateVideoInputFiles(
      [image],
      'referenceImages',
      0,
      { image: 'first-frame', lastFrame: '', referenceImages: [] },
    )).toThrow('Reference images cannot be used with first or last frames');
    expect(() => validateVideoInputFiles(
      [image],
      'image',
      1,
      { image: '', lastFrame: '', referenceImages: ['subject-reference'] },
    )).toThrow('First and last frames cannot be used with reference images');
  });

  it('enforces the documented Seedance image dimensions and aspect ratio', () => {
    expect(() => validateVideoImageDimensions(6001, 600)).toThrow('6000');
    expect(() => validateVideoImageDimensions(300, 1000)).toThrow('0.4');
    expect(() => validateVideoImageDimensions(1000, 300)).toThrow('2.5');
    expect(() => validateVideoImageDimensions(1600, 900)).not.toThrow();
    expect(getVideoImageOutputDimensions(292, 568)).toEqual({ width: 300, height: 584 });
    expect(getVideoImageOutputDimensions(4000, 2000)).toEqual({ width: 1600, height: 800 });
  });

  it('creates and counts structured video inputs', () => {
    const empty = createEmptyVideoGenerationInputs();
    expect(empty).toEqual({
      videoModel: 'seedance_1_5_pro_720p',
      image: '',
      lastFrame: '',
      referenceImages: [],
      inputMode: 'frames',
      durationSeconds: 5,
      aspectRatio: 'adaptive',
    });
    expect(getVideoGenerationImageCount(empty)).toBe(0);
    expect(getVideoGenerationImageCount({
      image: 'first', lastFrame: 'last', referenceImages: ['front', 'side', 'back'],
    })).toBe(5);
  });

  it('normalizes Grok to one working first-frame input without a last frame', () => {
    expect(normalizeVideoInputsForModel({
      videoModel: 'seedance_1_5_pro_720p', image: '', lastFrame: 'end', referenceImages: ['one', 'two', 'three', 'four'],
      inputMode: 'references', durationSeconds: 5, aspectRatio: '21:9',
    }, 'grok-imagine-video-1.5')).toMatchObject({
      videoModel: 'grok-imagine-video-1.5', image: 'one', lastFrame: '', referenceImages: [], inputMode: 'frames', durationSeconds: 5, aspectRatio: '16:9',
    });
  });

  it('appends stable reference markers for dragged images', () => {
    expect(appendVideoImageMarkers('a prompt', 0, 2)).toBe('a prompt [图1] [图2]');
    expect(appendVideoImageMarkers('', 2, 1)).toBe('[图3]');
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
