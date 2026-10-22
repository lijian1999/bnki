// 学习设置对话框测试：改内容 / 颜色 / 目录后点“仅保存”，检查 PATCH 的 studyCfg 与关闭回调。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type DeckSummary, type Item } from '@bnki/shared';
import StudySettingsDialog from './StudySettingsDialog';
import Overlays from '../ui/Overlays';

const deck: DeckSummary = {
  id: 'd1',
  title: '测试集',
  description: '',
  folderId: null,
  cover: null,
  pinnedAt: null,
  createdAt: 1,
  updatedAt: 1,
  openedAt: null,
  studiedAt: null,
  deletedAt: null,
  studyCfg: {},
  displayCfg: {},
  counts: { total: 1, fresh: 1, due: 0, learned: 0, pct: 0, nextDue: null },
};

const items: Item[] = [
  { id: 'S1', deckId: 'd1', kind: 'section', position: 1, level: 1, title: 'S1', collapsed: false, createdAt: 1, updatedAt: 1 },
  {
    id: 'c1', deckId: 'd1', kind: 'card', position: 2, cardType: 'note',
    front: 'A {{x}}', hint: '', back: '', color: 'default', createdAt: 1, updatedAt: 1, state: null,
  },
];

let calls: { url: string; method: string; body?: unknown }[];

function mockFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      let body: unknown;
      if (init?.body) {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      calls.push({ url, method, body });
      const path = url.split('?')[0];
      let data: unknown = { ok: true };
      if (path === '/api/settings') data = DEFAULT_SETTINGS;
      else if (path === '/api/decks/d1') data = deck;
      else if (path === '/api/decks/d1/items') data = items;
      else if (path === '/api/decks') data = [deck];
      return { ok: true, status: 200, json: async () => data } as Response;
    }),
  );
}

let onClose: () => void;

function renderDialog(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <StudySettingsDialog deckId="d1" onClose={onClose} />
      <Overlays />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls = [];
  mockFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('学习设置对话框', () => {
  it('改了学习内容、颜色、目录后仅保存：PATCH 带上 studyCfg 并关闭', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText('开始学习 · 学习设置')).toBeTruthy());
    expect(screen.getByText('复习计划与每日上限')).toBeTruthy();

    act(() => fireEvent.click(screen.getByText('仅复习')));
    act(() => fireEvent.click(screen.getByText('红色')));
    act(() => fireEvent.click(screen.getByText('S1')));
    act(() => fireEvent.click(screen.getByText('仅保存')));

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url === '/api/decks/d1')).toBe(true));
    const body = calls.find((c) => c.method === 'PATCH')?.body as { studyCfg: Record<string, unknown> };
    expect(body.studyCfg).toMatchObject({ content: 'review', colors: ['red'], sections: ['S1'] });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('展开复习计划后显示三张模式卡片和每日上限', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText('开始学习 · 学习设置')).toBeTruthy());
    act(() => fireEvent.click(screen.getByText('复习计划与每日上限')));
    expect(screen.getByText('按天模式（默认）')).toBeTruthy();
    expect(screen.getByText('灵活模式')).toBeTruthy();
    expect(screen.getByText('冲刺模式')).toBeTruthy();
    expect(screen.getByText(/每日新学 20 · 每日复习 100/)).toBeTruthy();
  });
});
