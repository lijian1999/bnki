// 卡片集页交互测试：stub fetch 提供卡片集 d1（目录 A、笔记卡 c1、目录 B、到期的问答卡 c2）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type CardItem, type CardState, type DeckSummary, type Item } from '@bnki/shared';
import { plainText } from '@bnki/shared/markdown';
import DeckPage from './DeckPage';
import Overlays from '../ui/Overlays';

let calls: { url: string; method: string; body?: unknown }[];
let itemsArr: Item[];

const reviewState: CardState = {
  state: 2, due: Date.now() - 86_400_000, stability: 5, difficulty: 5, elapsedDays: 1, scheduledDays: 5,
  learningSteps: 0, reps: 2, lapses: 0, lastReview: Date.now() - 5 * 86_400_000, mastered: false,
};

function baseItems(): Item[] {
  return [
    { id: 'A', deckId: 'd1', kind: 'section', position: 1, level: 1, title: '目录A', collapsed: false, createdAt: 1, updatedAt: 1 },
    { id: 'c1', deckId: 'd1', kind: 'card', position: 2, cardType: 'note', front: '这个{{挖空}}很关键', hint: '', back: '', color: 'default', createdAt: 1, updatedAt: 1, state: null },
    { id: 'B', deckId: 'd1', kind: 'section', position: 3, level: 1, title: '目录B', collapsed: false, createdAt: 1, updatedAt: 1 },
    { id: 'c2', deckId: 'd1', kind: 'card', position: 4, cardType: 'qa', front: '问题2', hint: '', back: '答案2', color: 'default', createdAt: 1, updatedAt: 1, state: reviewState },
  ];
}

function deckOf(): DeckSummary {
  return {
    id: 'd1', title: '我的卡片集', description: '', folderId: null, cover: null, pinnedAt: null,
    createdAt: Date.UTC(2026, 9, 22), updatedAt: Date.UTC(2026, 9, 22), openedAt: null, studiedAt: null, deletedAt: null,
    studyCfg: {}, displayCfg: {},
    counts: { total: 2, fresh: 1, due: 1, learned: 1, pct: 50, nextDue: null },
  };
}

let deckObj: DeckSummary;

function mockFetch() {
  const url = (u: unknown) => String(u).split('?')[0];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const path = url(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      let body: unknown;
      try {
        body = init?.body ? JSON.parse(init.body) : undefined;
      } catch {
        body = init?.body;
      }
      calls.push({ url: path, method, body });
      const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as Response;
      if (path === '/api/settings') return json(DEFAULT_SETTINGS);
      if (path === '/api/folders') return json([]);
      if (path === '/api/decks') return json([deckObj]);
      if (path === '/api/decks/d1' && method === 'GET') return json(deckObj);
      if (path === '/api/decks/d1/items') return json(itemsArr);
      if (path === '/api/decks/d1/open') return json({ ok: true });
      if (path === '/api/decks/d1' && method === 'PATCH') {
        deckObj = { ...deckObj, ...(body as object) } as DeckSummary;
        return json(deckObj);
      }
      if (path.startsWith('/api/items/') && method === 'PATCH') {
        const id = path.split('/').pop()!;
        itemsArr = itemsArr.map((x) => (x.id === id ? ({ ...x, ...(body as object) } as Item) : x));
        const it = itemsArr.find((x) => x.id === id);
        return json(it ?? { id });
      }
      if (path === '/api/items/delete') {
        const ids = (body as { ids: string[] }).ids;
        itemsArr = itemsArr.filter((x) => !ids.includes(x.id));
        return json({ ok: true });
      }
      if (path === '/api/items/restore') {
        itemsArr = baseItems();
        return json({ ok: true });
      }
      return json({ ok: true });
    }),
  );
}

function renderDeck(path = '/deck/d1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/deck/:deckId" element={<DeckPage />} />
        </Routes>
        <Overlays />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls = [];
  itemsArr = baseItems();
  deckObj = deckOf();
  mockFetch();
});

afterEach(() => {
  act(() => {
    fireEvent.keyDown(document.body, { key: 'Escape' });
  });
  cleanup();
  vi.unstubAllGlobals();
});

const waitTitle = async () => {
  await waitFor(() => expect(screen.getByDisplayValue('我的卡片集')).toBeTruthy());
};

describe('卡片集页', () => {
  it('显示标题、目录和卡片', async () => {
    const { container } = renderDeck();
    await waitTitle();
    // 目录行和侧边目录各显示一次，不用 getByText 避免多匹配
    expect(container.querySelectorAll('.section-h')).toHaveLength(2);
    expect(container.querySelectorAll('.mini-card')).toHaveLength(2);
    expect(container.textContent).toContain('目录A');
    expect(container.textContent).toContain('目录B');
    expect(container.querySelector('.cloze')).toBeTruthy();
    const due = container.querySelector('.state-dot.due');
    expect(due?.textContent).toBe('需复习');
  });

  it('点目录 A 的折叠箭头：PATCH collapsed 并隐藏块内卡片', async () => {
    const { container } = renderDeck();
    await waitTitle();
    const caret = container.querySelectorAll('.section-h .caret')[0];
    fireEvent.click(caret);
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH' && c.url === '/api/items/A' && (c.body as { collapsed?: boolean })?.collapsed === true)).toBe(true);
    });
    await waitFor(() => expect(container.textContent).not.toContain('这个挖空很关键'));
    expect(container.textContent).toContain('答案2');
  });

  it('选中卡片按 Backspace：删除并出现撤销', async () => {
    renderDeck();
    await waitTitle();
    const cards = document.querySelectorAll('.mini-card');
    fireEvent.click(cards[0]);
    fireEvent.keyDown(document.body, { key: 'Backspace' });
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/items/delete' && JSON.stringify((c.body as { ids: string[] })?.ids) === '["c1"]')).toBe(true);
    });
    expect(await screen.findByText('撤销')).toBeTruthy();
  });

  it('搜索只留命中的卡片并高亮', async () => {
    const { container } = renderDeck();
    await waitTitle();
    const btn = Array.from(document.querySelectorAll('.icon-btn')).find((b) => b.textContent === '⌕');
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    const input = await waitFor(() => {
      const el = document.getElementById('deck-search') as HTMLInputElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.change(input, { target: { value: '挖空' } });
    await waitFor(() => expect(container.textContent).not.toContain('问题2'));
    expect(container.textContent).toContain('这个挖空很关键');
    expect(container.querySelectorAll('.mini-card')).toHaveLength(1);
    expect(container.querySelector('mark.hit')).toBeTruthy();
  });

  it('空卡片集显示引导', async () => {
    itemsArr = [];
    renderDeck();
    await waitTitle();
    expect(screen.getByText('开始搭建你的卡片集')).toBeTruthy();
  });

  it('?card= 定位：展开所在目录并选中卡片', async () => {
    itemsArr = itemsArr.map((x) => (x.id === 'B' ? { ...x, collapsed: true } : x));
    Element.prototype.scrollIntoView = vi.fn();
    renderDeck('/deck/d1?card=c2');
    await waitFor(() => {
      const el = document.querySelector('.mini-card[data-item="c2"]');
      expect(el?.classList.contains('sel')).toBe(true);
    });
    await waitFor(() => {
      expect(
        calls.some(
          (c) => c.method === 'PATCH' && c.url === '/api/items/B' && (c.body as { collapsed?: boolean })?.collapsed === false,
        ),
      ).toBe(true);
    });
  });

  it('朗读：点按钮开始朗读，再点停止', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const speak = vi.fn();
    const cancel = vi.fn();
    class Utterance {
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal('speechSynthesis', { speak, cancel });
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    renderDeck();
    await waitTitle();
    const btn = Array.from(document.querySelectorAll('.icon-btn')).find((b) => b.getAttribute('title') === '朗读');
    expect(btn).toBeTruthy();
    fireEvent.click(btn!);
    await waitFor(() => expect(speak).toHaveBeenCalled());
    const first = itemsArr.find((x) => x.kind === 'card') as CardItem;
    expect((speak.mock.calls[0]?.[0] as Utterance).text).toBe(plainText(first.front));
    const stop = Array.from(document.querySelectorAll('.icon-btn')).find((b) => b.getAttribute('title') === '停止朗读');
    expect(stop).toBeTruthy();
    fireEvent.click(stop!);
    await waitFor(() => expect(cancel).toHaveBeenCalled());
  });
});
