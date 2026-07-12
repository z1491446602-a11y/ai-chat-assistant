import { describe, expect, it } from 'vitest';
import { getGeneratedImageDimensions } from '../../server/imageAssets.js';

describe('generated image metadata', () => {
  it('reads PNG dimensions', () => {
    const buffer = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4E, 0x47]).copy(buffer, 0);
    buffer.writeUInt32BE(1824, 16);
    buffer.writeUInt32BE(1024, 20);

    expect(getGeneratedImageDimensions(buffer)).toEqual({ width: 1824, height: 1024 });
  });

  it('reads JPEG dimensions from a start-of-frame marker', () => {
    const buffer = Buffer.from([
      0xFF, 0xD8,
      0xFF, 0xC0, 0x00, 0x11, 0x08,
      0x04, 0x00,
      0x04, 0x00,
      0x03, 0x01, 0x11, 0x00,
    ]);

    expect(getGeneratedImageDimensions(buffer)).toEqual({ width: 1024, height: 1024 });
  });
});
