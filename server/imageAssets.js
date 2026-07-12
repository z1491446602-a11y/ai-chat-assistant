export function getGeneratedImageDimensions(buffer) {
  if (
    buffer.length >= 24
    && buffer[0] === 0x89
    && buffer.subarray(1, 4).toString('ascii') === 'PNG'
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (buffer.length >= 4 && buffer[0] === 0xFF && buffer[1] === 0xD8) {
    for (let index = 2; index + 9 < buffer.length;) {
      if (buffer[index] !== 0xFF) {
        index += 1;
        continue;
      }
      const marker = buffer[index + 1];
      const segmentLength = buffer.readUInt16BE(index + 2);
      if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
        return {
          width: buffer.readUInt16BE(index + 7),
          height: buffer.readUInt16BE(index + 5),
        };
      }
      index += Math.max(2, segmentLength + 2);
    }
  }

  return { width: undefined, height: undefined };
}
