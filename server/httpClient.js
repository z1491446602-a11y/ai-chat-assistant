import { Agent, fetch as undiciFetch, setGlobalDispatcher } from 'undici';

export function createUpstreamFetch() {
  const upstreamDispatcher = new Agent({
    connectTimeout: 30_000,
    headersTimeout: 600_000,
    bodyTimeout: 600_000,
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 120_000,
  });

  setGlobalDispatcher(upstreamDispatcher);

  return function upstreamFetch(url, options = {}) {
    return undiciFetch(url, {
      ...options,
      dispatcher: upstreamDispatcher,
    });
  };
}
