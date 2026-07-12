export function getBase64Payload(fileData) {
  const source = String(fileData || '').trim();
  const dataUrlMatch = source.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1],
      base64: dataUrlMatch[2],
    };
  }

  return {
    mimeType: '',
    base64: source,
  };
}

export function dataUrlToBlob(dataUrl, fallbackMimeType = 'image/png') {
  const { mimeType, base64 } = getBase64Payload(dataUrl);
  if (!base64) {
    throw new Error('图片内容为空');
  }

  const buffer = Buffer.from(base64, 'base64');
  return new Blob([buffer], { type: mimeType || fallbackMimeType });
}

export function decodeBase64AudioInput(audioData, mimeType = 'audio/webm') {
  const { mimeType: dataUrlMimeType, base64 } = getBase64Payload(audioData);
  if (!base64) {
    throw new Error('音频内容为空');
  }

  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    throw new Error('音频内容为空');
  }

  return {
    buffer,
    mimeType: dataUrlMimeType || mimeType || 'audio/webm',
  };
}

export function getImageExtensionFromMimeType(mimeType) {
  switch (String(mimeType || '').toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'image/png':
    default:
      return '.png';
  }
}

export function dataUrlToUploadPart(dataUrl, index) {
  const { mimeType } = getBase64Payload(dataUrl);
  const blob = dataUrlToBlob(dataUrl);
  const extension = getImageExtensionFromMimeType(mimeType || blob.type);

  return {
    blob,
    fileName: `image-${index + 1}${extension}`,
  };
}
