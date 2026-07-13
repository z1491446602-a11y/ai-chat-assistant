import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_IMAGE_REFERENCE_COUNT,
  MAX_IMAGE_REFERENCE_TOTAL_BYTES,
  createImageReferenceResolver,
} from '../../server/imageReferences.js';

describe('stored image references', () => {
  it('converts a generated upload URL into a data URL for image editing', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3]);
    const readFile = vi.fn().mockResolvedValue(png);
    const resolveImageReferences = createImageReferenceResolver({
      uploadDir: 'C:\\uploads',
      readFile,
    });

    await expect(resolveImageReferences(['/uploads/generated.png'])).resolves.toEqual([
      `data:image/png;base64,${png.toString('base64')}`,
    ]);
    expect(readFile).toHaveBeenCalledWith(path.join('C:\\uploads', 'generated.png'));
  });

  it('passes an uploaded data URL through unchanged', async () => {
    const readFile = vi.fn();
    const resolveImageReferences = createImageReferenceResolver({ uploadDir: 'C:\\uploads', readFile });
    const source = 'data:image/jpeg;base64,abc';

    await expect(resolveImageReferences([source])).resolves.toEqual([source]);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('returns a public error when the stored image is missing', async () => {
    const resolveImageReferences = createImageReferenceResolver({
      uploadDir: 'C:\\uploads',
      readFile: vi.fn().mockRejectedValue(new Error('ENOENT C:\\private\\path')),
    });

    await expect(resolveImageReferences(['/uploads/missing.png']))
      .rejects.toThrow('上一张图片文件已不存在，请重新上传图片');
  });

  it.each([
    '/uploads/../secret.png',
    '/other/image.png',
    'https://example.com/image.png',
  ])('rejects an unsupported or unsafe reference: %s', async (source) => {
    const resolveImageReferences = createImageReferenceResolver({
      uploadDir: 'C:\\uploads',
      readFile: vi.fn(),
    });

    await expect(resolveImageReferences([source])).rejects.toThrow('图片引用无效');
  });

  it('rejects too many references before reading any stored file', async () => {
    const readFile = vi.fn();
    const resolveImageReferences = createImageReferenceResolver({ uploadDir: 'C:\\uploads', readFile });
    const references = Array.from(
      { length: MAX_IMAGE_REFERENCE_COUNT + 1 },
      (_, index) => `/uploads/image-${index}.png`,
    );

    await expect(resolveImageReferences(references)).rejects.toThrow('最多只能使用 8 张参考图');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('deduplicates references before reading files', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1]);
    const readFile = vi.fn().mockResolvedValue(png);
    const resolveImageReferences = createImageReferenceResolver({ uploadDir: 'C:\\uploads', readFile });

    await expect(resolveImageReferences([
      '/uploads/same.png',
      ' /uploads/same.png ',
    ])).resolves.toHaveLength(1);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('rejects references whose combined decoded size exceeds the total limit', async () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const bytesPerFile = Math.floor(MAX_IMAGE_REFERENCE_TOTAL_BYTES / 2) + 1;
    const largePng = Buffer.concat([pngHeader, Buffer.alloc(bytesPerFile - pngHeader.length)]);
    const readFile = vi.fn().mockResolvedValue(largePng);
    const resolveImageReferences = createImageReferenceResolver({ uploadDir: 'C:\\uploads', readFile });

    await expect(resolveImageReferences([
      '/uploads/first.png',
      '/uploads/second.png',
    ])).rejects.toThrow('参考图总大小不能超过');
  });
});
