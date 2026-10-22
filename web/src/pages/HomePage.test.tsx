// 首页交互测试：stub fetch 提供两个卡片集，渲染 HomePage + Overlays 验证菜单与提示。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type DeckSummary, type Folder } from '@bnki/shared';
import HomePage from './HomePage';
import Overlays from '../ui/Overlays';

const folder: Folder = { id: 'f1', name: '我的', position: 1, createdAt: 1 };

function deck(id: string, title: string, due: number): DeckSummary {
  return {
    id,
    title,
    description: '',
    folderId: 'f1',
    cover: null,
    pinnedAt: null,
    createdAt: 1,
    updatedAt: 1,
    openedAt: null,
    studiedAt: null,
    deletedAt: null,
    studyCfg: {},
    displayCfg: {},
    counts: { total: 10, fresh: 2, due, learned: 8, pct: 80, nextDue: null },
  };
}

let calls: { url: string; method: string }[];

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method });
      const path = url.split('?')[0];
      let body: unknown;
      if (path === '/api/settings') body = DEFAULT_SETTINGS;
      else if (path === '/api/folders') body = [folder];
      else if (path === '/api/decks') body = [deck('x1', '第一组', 3), deck('x2', '第二组', 0)];
      else body = { ok: true };
      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );
}

function renderHome(view: 'all' | 'trash') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <HomePage view={view} />
        <Overlays />
      </MemoryRouter>
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

describe('首页', () => {
  it('显示两个卡片集，需复习数字只显示一次', async () => {
    const { container } = renderHome('all');
    await waitFor(() => expect(screen.getByText('第一组')).toBeTruthy());
    expect(screen.getByText('第二组')).toBeTruthy();
    expect(screen.getByText('需复习 3')).toBeTruthy();
    expect(container.querySelectorAll('.due')).toHaveLength(1);
    expect(container.textContent).toContain('需复习 3');
    expect(container.textContent?.includes('需复习 0')).toBe(false);
  });

  it('卡片集菜单里点删除：发出 DELETE 请求并提示已移到回收站', async () => {
    renderHome('all');
    await waitFor(() => expect(screen.getByText('第一组')).toBeTruthy());
    const more = screen.getAllByRole('button', { name: '···' })[0];
    fireEvent.click(more);
    await waitFor(() => expect(screen.getByText('置顶')).toBeTruthy());
    expect(screen.getByText('创建副本')).toBeTruthy();
    expect(screen.getByText('删除')).toBeTruthy();
    fireEvent.click(screen.getByText('删除'));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/decks/x1')).toBe(true);
    });
    await waitFor(() => expect(screen.getByText('已移到回收站')).toBeTruthy());
    expect(screen.getByText('撤销')).toBeTruthy();
  });

  it('回收站里点卡片弹出恢复 / 彻底删除', async () => {
    renderHome('trash');
    await waitFor(() => expect(screen.getByText('第一组')).toBeTruthy());
    const cards = document.querySelectorAll('.deck-card');
    fireEvent.click(cards[0]);
    await waitFor(() => expect(screen.getByText('恢复')).toBeTruthy());
    expect(screen.getByText('彻底删除')).toBeTruthy();
  });
});
