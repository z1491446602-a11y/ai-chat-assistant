import { describe, expect, it } from 'vitest';

describe('test environment', () => {
  it('runs on Node.js 20 or newer', () => {
    const majorVersion = Number.parseInt(process.versions.node.split('.')[0], 10);

    expect(majorVersion).toBeGreaterThanOrEqual(20);
  });
});
