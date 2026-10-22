// 统计页：数据来自 /api/stats，显示连续天数环、最长连续记录与真实记忆保持率，切换区间会重新请求。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StatsPage from './StatsPage';
import Overlays from '../ui/Overlays';

let calls: { url: string; method: string }[];

function statsData(): unknown {
  return {
    today: 4,
    total: 120,
    deckCount: 3,
    cardCount: 88,
    streak: 3,
    best: { days: 5, start: '2026-10-01', end: '2026-10-05' },
    monthDays: 6,
    calendar: {},
    series: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${15 + i}`, reviews: i, edits: i % 3 })),
    forecast: Array.from({ length: 30 }, (_, i) => ({ date: `2026-11-${i}`, count: i % 4 })),
    retention: { actual: 0.875, target: 0.9, samples: 8 },
  };
}

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method });
      const body = url.startsWith('/api/stats') ? statsData() : { ok: true };
      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );
}

function renderStats() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StatsPage />
      <Overlays />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls = [];
  mockFetch();
});

afterEach(() => {
  act(() => {
    fireEvent.keyDown(document.body, { key: 'Escape' });
  });
  cleanup();
  vi.unstubAllGlobals();
});

describe('统计页', () => {
  it('显示连续天数、最长连续记录和记忆保持率', async () => {
    const { container } = renderStats();
    await waitFor(() => expect(screen.getByText('数据')).toBeTruthy());
    expect(container.querySelector('.ring text')?.textContent).toBe('3');
    expect(container.textContent).toContain('最长连续学习');
    expect(container.textContent).toContain('5');
    expect(container.textContent).toContain('2026.10.1 – 2026.10.5');
    expect(container.textContent).toContain('88%');
    expect(container.textContent).toContain('近 30 天 8 次复习，目标 90%');
  });

  it('点 30天 后按 range=30 重新请求', async () => {
    renderStats();
    await waitFor(() => expect(screen.getByText('数据')).toBeTruthy());
    await waitFor(() => expect(calls.some((c) => c.url === '/api/stats?range=7')).toBe(true));
    fireEvent.click(screen.getByText('30天'));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/stats?range=30')).toBe(true));
  });
});
