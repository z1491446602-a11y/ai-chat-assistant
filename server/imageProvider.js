import { dataUrlToUploadPart } from './mediaPayload.js';

const PROVIDER_IDS = new Set(['gpt', 'grok']);

function normalizeEndpoint(value) {
  return String(value || '').trim();
}

export function createImageProviderRegistry(config) {
  const providers = {
    gpt: {
      id: 'gpt',
      label: 'GPT',
      model: String(config.IMAGE_GPT_MODEL || 'gpt-image-2').trim(),
      apiKey: String(config.IMAGE_GPT_API_KEY || '').trim(),
      generationUrl: normalizeEndpoint(config.IMAGE_GPT_GENERATION_URL),
      editUrl: normalizeEndpoint(config.IMAGE_GPT_EDIT_URL),
      editTransport: 'multipart',
      supportsAspectRatio: false,
    },
    grok: {
      id: 'grok',
      label: 'Grok',
      model: String(config.IMAGE_GROK_MODEL || 'grok-imagine-image-quality').trim(),
      apiKey: String(config.IMAGE_GROK_API_KEY || '').trim(),
      generationUrl: normalizeEndpoint(config.IMAGE_GROK_GENERATION_URL),
      editUrl: normalizeEndpoint(config.IMAGE_GROK_EDIT_URL),
      editTransport: 'json',
      supportsAspectRatio: true,
    },
  };
  const defaultProvider = PROVIDER_IDS.has(config.IMAGE_DEFAULT_PROVIDER)
    ? config.IMAGE_DEFAULT_PROVIDER
    : 'gpt';

  function resolve(providerId = defaultProvider) {
    const normalizedId = String(providerId || defaultProvider).trim().toLowerCase();
    if (!PROVIDER_IDS.has(normalizedId)) {
      throw new Error('不支持的图片生成模型');
    }

    return providers[normalizedId];
  }

  return { resolve, defaultProvider };
}

export function buildImageProviderRequest({ provider, prompt, images = [], size = '', aspectRatio = '' }) {
  const sourceImages = Array.isArray(images) ? images.filter(Boolean) : [];
  const commonFields = {
    model: provider.model,
    prompt,
    n: 1,
    response_format: 'b64_json',
    ...(provider.supportsAspectRatio && aspectRatio
      ? { aspect_ratio: aspectRatio }
      : (size ? { size } : {})),
  };

  if (!sourceImages.length) {
    return {
      url: provider.generationUrl,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(commonFields),
      },
    };
  }

  if (provider.editTransport === 'json') {
    return {
      url: provider.editUrl,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          ...commonFields,
          image: { image_url: sourceImages[0] },
        }),
      },
    };
  }

  const formData = new FormData();
  for (const [key, value] of Object.entries(commonFields)) {
    formData.append(key, String(value));
  }
  sourceImages.slice(0, 4).forEach((image, index) => {
    const uploadPart = dataUrlToUploadPart(image, index);
    formData.append('image', uploadPart.blob, uploadPart.fileName);
  });

  return {
    url: provider.editUrl,
    init: {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      body: formData,
    },
  };
}
