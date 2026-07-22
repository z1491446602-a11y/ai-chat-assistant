const TERMINAL_ASSET_FAILURES = new Set(['failed', 'rejected', 'deleted', 'error']);

function readError(payload, fallback) {
  const value = payload?.msg || payload?.error?.message || payload?.error || fallback;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function assertSuccess(response, payload, fallback) {
  if (!response.ok || String(payload?.code ?? '0') !== '0') {
    const error = new Error(readError(payload, fallback));
    error.status = response.status;
    throw error;
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Seedance asset provider returned invalid JSON');
  }
}

function toReference(assetId) {
  return `asset://${assetId}`;
}

export function createSeedanceAssetProvider({
  baseUrl,
  apiKey,
  fetchImpl = globalThis.fetch,
  sleep = (delay, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      const error = new Error('Asset preparation aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  }),
  now = Date.now,
  pollIntervalMs = 5_000,
  timeoutMs = 300_000,
} = {}) {
  const rootUrl = String(baseUrl || '').replace(/\/+$/u, '');
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${String(apiKey || '')}`,
  };

  function getAssetUrl(assetId) {
    return `${rootUrl}/kyyVideo2/asset/${encodeURIComponent(String(assetId || ''))}`;
  }

  async function uploadImage(url, name = 'video-reference', signal) {
    const normalizedUrl = String(url || '').trim();
    if (!normalizedUrl) throw new Error('Seedance asset URL is required');
    const response = await fetchImpl(`${rootUrl}/kyyVideo2/asset/upload`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ assetType: 'Image', url: normalizedUrl, name: String(name || 'video-reference') }),
      signal,
    });
    const payload = await readJson(response);
    assertSuccess(response, payload, 'Seedance asset upload failed');
    const assetId = String(payload?.data?.assetId || '').trim();
    if (!assetId) throw new Error('Seedance asset upload response is missing assetId');
    return { assetId, reference: toReference(assetId) };
  }

  async function getAsset(assetId, signal) {
    const response = await fetchImpl(getAssetUrl(assetId), {
      method: 'GET',
      headers,
      signal,
    });
    const payload = await readJson(response);
    assertSuccess(response, payload, 'Seedance asset detail request failed');
    return payload?.data || {};
  }

  async function waitUntilActive(assetId, signal) {
    const startedAt = now();
    while (true) {
      if (now() - startedAt >= timeoutMs) {
        throw new Error(`Seedance asset processing timed out: ${assetId}`);
      }
      const asset = await getAsset(assetId, signal);
      const status = String(asset?.status || '').trim().toLowerCase();
      if (status === 'active') return { assetId, reference: toReference(assetId) };
      if (TERMINAL_ASSET_FAILURES.has(status)) {
        throw new Error(`Seedance asset processing failed (${status}): ${assetId}`);
      }
      await sleep(pollIntervalMs, signal);
    }
  }

  async function deleteAsset(assetId, signal) {
    const response = await fetchImpl(getAssetUrl(assetId), {
      method: 'DELETE',
      headers,
      signal,
    });
    const payload = await readJson(response);
    assertSuccess(response, payload, 'Seedance asset deletion failed');
  }

  async function prepareOne(url, name, signal) {
    if (!String(url || '').trim()) return null;
    const uploaded = await uploadImage(url, name, signal);
    await waitUntilActive(uploaded.assetId, signal);
    return uploaded;
  }

  async function prepareImages({ image = '', lastFrame = '', referenceImages = [], taskId = '', signal } = {}) {
    const prepared = [];
    try {
      const first = await prepareOne(image, `${taskId || 'video'}-first-frame`, signal);
      if (first) prepared.push(first);
      const last = await prepareOne(lastFrame, `${taskId || 'video'}-last-frame`, signal);
      if (last) prepared.push(last);
      const references = [];
      for (let index = 0; index < referenceImages.length; index += 1) {
        const item = await prepareOne(referenceImages[index], `${taskId || 'video'}-reference-${index + 1}`, signal);
        if (item) {
          prepared.push(item);
          references.push(item.reference);
        }
      }
      return {
        image: first?.reference || '',
        lastFrame: last?.reference || '',
        referenceImages: references,
        assetIds: prepared.map(item => item.assetId),
      };
    } catch (error) {
      await Promise.allSettled(prepared.map(item => deleteAsset(item.assetId)));
      throw error;
    }
  }

  async function cleanupAssets(assetIds = []) {
    const uniqueIds = [...new Set(assetIds.map(value => String(value || '').trim()).filter(Boolean))];
    const results = await Promise.allSettled(uniqueIds.map(assetId => deleteAsset(assetId)));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) {
      throw new AggregateError(failures.map(result => result.reason), 'Seedance asset cleanup failed');
    }
  }

  return {
    uploadImage,
    getAsset,
    waitUntilActive,
    deleteAsset,
    prepareImages,
    cleanupAssets,
  };
}
