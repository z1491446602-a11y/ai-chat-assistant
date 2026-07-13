import { describe, expect, it } from 'vitest';
import {
  createDailySuggestionsService,
  parseDailySuggestions,
} from '../server/dailySuggestions.js';

describe('daily suggestions', () => {
  it('accepts JSON, removes duplicates and limits long entries', () => {
    const parsed = parseDailySuggestions(`
      [
        "热点：今天有什么重要新闻？",
        "热点：今天有什么重要新闻？",
        "科技：AI 行业今天有哪些进展？",
        "${'很'.repeat(90)}"
      ]
    `);

    expect(parsed).toEqual([
      '热点：今天有什么重要新闻？',
      '科技：AI 行业今天有哪些进展？',
    ]);
  });

  it('reuses one generation for the same China date', async () => {
    let calls = 0;
    const service = createDailySuggestionsService({
      now: () => new Date('2026-07-13T01:30:00.000Z'),
      generate: async () => {
        calls += 1;
        return '["热点：今日新闻一览","科技：今日 AI 新进展","生活：今天有什么实用提醒？","财经：今天市场关注什么？"]';
      },
    });

    const [first, second] = await Promise.all([service.get(), service.get()]);

    expect(calls).toBe(1);
    expect(first.date).toBe('2026-07-13');
    expect(second).toEqual(first);
    expect(first.source).toBe('live');
  });
});
