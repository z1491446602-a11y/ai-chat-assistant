import { beforeEach, describe, expect, it, vi } from 'vitest';

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaidMock }));

describe('loadMermaid', () => {
  beforeEach(() => {
    vi.resetModules();
    mermaidMock.initialize.mockReset();
    mermaidMock.render.mockReset();
  });

  it('caches the dynamic module and initializes Mermaid once with strict security', async () => {
    const { loadMermaid } = await import('./mermaidLoader');

    const [first, second] = await Promise.all([loadMermaid(), loadMermaid()]);
    const third = await loadMermaid();

    expect(first).toBe(mermaidMock);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(mermaidMock.initialize).toHaveBeenCalledTimes(1);
    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: 'strict',
    }));
  });

  it('clears a rejected initialization so a later call can retry', async () => {
    mermaidMock.initialize.mockImplementationOnce(() => {
      throw new Error('initialization failed');
    });
    const { loadMermaid } = await import('./mermaidLoader');

    await expect(loadMermaid()).rejects.toThrow('initialization failed');
    const retried = await loadMermaid();

    expect(retried).toBe(mermaidMock);
    expect(mermaidMock.initialize).toHaveBeenCalledTimes(2);
  });
});
