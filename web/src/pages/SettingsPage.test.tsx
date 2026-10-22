// 设置页：显示设置内容、改选项立刻 PUT、间隔预览、立即备份接口。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type Settings } from '@bnki/shared';
import SettingsPage from './SettingsPage';
import Overlays from '../ui/Overlays';

let calls: { url: string; method: string; body?: unknown }[];

function mockFetch() {
  const settings: Settings = { ...DEFAULT_SETTINGS, dataDir: '/tmp/bnki' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (url.startsWith('/api/settings')) return { ok: true, status: 200, json: async () => settings } as Response;
      if (url.startsWith('/api/backups')) return { ok: true, status: 200, json: async () => [] } as Response;
      if (url === '/api/backup') return { ok: true, status: 200, json: async () => ({ name: '20261022-180000' }) } as Response;
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
    }),
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

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
      <Overlays />
    </QueryClientProvider>,
  );
}

describe('系统设置页', () => {
  it('显示数据目录', async () => {
    const { container } = renderSettings();
    await waitFor(() => expect(screen.getByText('系统设置')).toBeTruthy());
    expect(container.textContent).toContain('/tmp/bnki');
  });

  it('点外观的深色发出 PUT /api/settings', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByText('外观')).toBeTruthy());
    fireEvent.click(screen.getByText('深色'));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/settings' && JSON.stringify(c.body) === '{"theme":"dark"}')).toBe(true),
    );
  });

  it('间隔预览那一行用箭头连接', async () => {
    const { container } = renderSettings();
    await waitFor(() => expect(container.textContent).toContain('新卡一直点'));
    const row = Array.from(container.querySelectorAll('.set-row')).find((el) => el.textContent?.includes('新卡一直点'));
    expect(row?.textContent).toContain('→');
  });

  it('点立即备份调用 POST /api/backup', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByText('自动备份')).toBeTruthy());
    fireEvent.click(screen.getByText('立即备份'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/backup')).toBe(true));
    await waitFor(() => expect(screen.getByText('已备份：20261022-180000')).toBeTruthy());
  });
});
