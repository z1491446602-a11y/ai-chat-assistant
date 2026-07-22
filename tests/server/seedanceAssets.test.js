import { describe, expect, it, vi } from 'vitest';
import { createSeedanceAssetProvider } from '../../server/seedanceAssets.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Seedance asset provider', () => {
  it('uploads an image URL and returns an asset reference', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: 0,
      msg: null,
      data: { assetId: 'asset-1' },
    }));
    const provider = createSeedanceAssetProvider({
      baseUrl: 'https://api.chancexj.com',
      apiKey: 'secret',
      fetchImpl,
    });

    await expect(provider.uploadImage('https://www.koyue.top/uploads/a.png', 'first-frame'))
      .resolves.toEqual({ assetId: 'asset-1', reference: 'asset://asset-1' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.chancexj.com/kyyVideo2/asset/upload',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret',
        },
        body: JSON.stringify({
          assetType: 'Image',
          url: 'https://www.koyue.top/uploads/a.png',
          name: 'first-frame',
        }),
      }),
    );
  });

  it('waits for Active before exposing the asset reference', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { status: 'Processing', assetId: 'asset-1' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { status: 'Active', assetId: 'asset-1' } }));
    const sleep = vi.fn().mockResolvedValue();
    const provider = createSeedanceAssetProvider({
      baseUrl: 'https://api.chancexj.com', apiKey: 'secret', fetchImpl, sleep,
      pollIntervalMs: 1, timeoutMs: 1_000, now: (() => { let value = 0; return () => value++; })(),
    });

    await expect(provider.waitUntilActive('asset-1')).resolves.toEqual({
      assetId: 'asset-1',
      reference: 'asset://asset-1',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(1,
      'https://api.chancexj.com/kyyVideo2/asset/asset-1',
      expect.objectContaining({ method: 'GET' }));
    expect(sleep).toHaveBeenCalledWith(1, undefined);
  });

  it('prepares every input image and cleans assets using string success codes', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { assetId: 'asset-first' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { status: 'Active', assetId: 'asset-first' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { assetId: 'asset-last' } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { status: 'Active', assetId: 'asset-last' } }))
      .mockResolvedValueOnce(jsonResponse({ code: '0', msg: 'deleted', data: null }))
      .mockResolvedValueOnce(jsonResponse({ code: '0', msg: 'deleted', data: null }));
    const provider = createSeedanceAssetProvider({
      baseUrl: 'https://api.chancexj.com', apiKey: 'secret', fetchImpl,
    });

    const prepared = await provider.prepareImages({
      image: 'https://www.koyue.top/uploads/first.png',
      lastFrame: 'https://www.koyue.top/uploads/last.png',
      referenceImages: [],
      taskId: 'task-1',
    });
    expect(prepared).toEqual({
      image: 'asset://asset-first',
      lastFrame: 'asset://asset-last',
      referenceImages: [],
      assetIds: ['asset-first', 'asset-last'],
    });

    await expect(provider.cleanupAssets(prepared.assetIds)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenNthCalledWith(5,
      'https://api.chancexj.com/kyyVideo2/asset/asset-first',
      expect.objectContaining({ method: 'DELETE' }));
    expect(fetchImpl).toHaveBeenNthCalledWith(6,
      'https://api.chancexj.com/kyyVideo2/asset/asset-last',
      expect.objectContaining({ method: 'DELETE' }));
  });

  it('rejects failed assets and timeouts', async () => {
    const failed = createSeedanceAssetProvider({
      baseUrl: 'https://api.chancexj.com',
      apiKey: 'secret',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({
        code: 0,
        data: { status: 'Failed', assetId: 'asset-failed' },
      })),
    });
    await expect(failed.waitUntilActive('asset-failed')).rejects.toThrow(/Failed/i);

    const timedOut = createSeedanceAssetProvider({
      baseUrl: 'https://api.chancexj.com',
      apiKey: 'secret',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({
        code: 0,
        data: { status: 'Processing', assetId: 'asset-slow' },
      })),
      sleep: vi.fn().mockResolvedValue(),
      pollIntervalMs: 1,
      timeoutMs: 2,
      now: (() => { let value = 0; return () => value++; })(),
    });
    await expect(timedOut.waitUntilActive('asset-slow')).rejects.toThrow(/timed out/i);
  });

  it('propagates abort and does not hide delete failures', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const provider = createSeedanceAssetProvider({
      baseUrl: 'https://api.chancexj.com', apiKey: 'secret', fetchImpl,
    });

    await expect(provider.getAsset('asset-1', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(provider.deleteAsset('asset-1')).rejects.toThrow('aborted');
  });
});
