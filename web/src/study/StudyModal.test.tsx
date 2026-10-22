// 学习弹窗交互测试：按 URL + 方法 stub fetch，验证出卡队列、挖空、评分与结束页。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, DAY, type CardItem, type CardState, type DeckSummary, type Item } from '@bnki/shared';
import StudyModal from './StudyModal';
import Overlays from '../ui/Overlays';
import { useUI } from '../store';
import { dismissToast } from '../ui/toast';
import type { SessionResult } from '../api';

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
  counts: { total: 2, fresh: 2, due: 0, learned: 0, pct: 0, nextDue: null },
};

const noteCard: CardItem = {
  id: 'c1', deckId: 'd1', kind: 'card', position: 1, cardType: 'note',
  front: 'A {{x}} B {{y}}', hint: '', back: '', color: 'default', createdAt: 1, updatedAt: 1, state: null,
};
const qaCard: CardItem = {
  id: 'c2', deckId: 'd1', kind: 'card', position: 2, cardType: 'qa',
  front: 'Q', hint: '', back: 'ANS', color: 'default', createdAt: 1, updatedAt: 1, state: null,
};
const items: Item[] = [noteCard, qaCard];

/** 复习状态：评分接口一律返回它。 */
const reviewed: CardState = {
  state: 2, due: Date.now() + 3 * DAY, stability: 5, difficulty: 5, elapsedDays: 0, scheduledDays: 3,
  learningSteps: 0, reps: 1, lapses: 0, lastReview: Date.now() - DAY, mastered: false,
};

const fullSession: SessionResult = {
  label: '系统推荐',
  queue: [
    { cardId: 'c1', rep: false, flipped: false },
    { cardId: 'c2', rep: false, flipped: false },
  ],
  cards: [noteCard, qaCard],
};

let session: SessionResult;
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
      if (path === '/api/settings') data = { ...DEFAULT_SETTINGS, fuzz: false };
      else if (path === '/api/decks/d1') data = deck;
      else if (path === '/api/decks/d1/items') data = items;
      else if (path === '/api/decks') data = [deck];
      else if (path === '/api/study/d1/session') data = session;
      else if (path === '/api/study/review') data = { state: reviewed, label: '3天', requeue: false };
      else if (path === '/api/study/manual') data = { state: reviewed };
      return { ok: true, status: 200, json: async () => data } as Response;
    }),
  );
}

function renderStudy() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const res = render(
    <QueryClientProvider client={qc}>
      <StudyModal />
      <Overlays />
    </QueryClientProvider>,
  );
  return res;
}

const reviewCalls = (): { body?: unknown }[] => calls.filter((c) => c.url === '/api/study/review');
const reviewBodies = (): Record<string, unknown>[] => reviewCalls().map((c) => c.body as Record<string, unknown>);
const keyDown = (key: string, extra?: object): void => {
  fireEvent.keyDown(document.body, { key, ...extra });
};

const text = (): string => document.body.textContent ?? '';
const qsa = (sel: string): HTMLElement[] => Array.from(document.querySelectorAll(sel));

async function openStudy(): Promise<void> {
  act(() => {
    useUI.getState().openStudy({ deckId: 'd1' });
  });
  await waitFor(() => expect(text()).toContain('系统推荐（1/2）'));
}

beforeEach(() => {
  calls = [];
  session = fullSession;
  mockFetch();
});

afterEach(() => {
  act(() => {
    fireEvent.keyDown(document.body, { key: 'Escape' });
    useUI.getState().closeStudy();
    useUI.getState().closeDialog();
    useUI.getState().closeEditor();
    dismissToast();
  });
  cleanup();
  vi.unstubAllGlobals();
});

describe('学习弹窗', () => {
  it('显示标题和挖空，V 显示下一个，⇧V 全部显示', async () => {
    renderStudy();
    await openStudy();
    expect(text()).toContain('系统推荐（1/2）');
    expect(qsa('.study-content .cloze.hidden-c')).toHaveLength(2);
    expect(text()).toContain('挖空 0/2');

    act(() => keyDown('v'));
    await waitFor(() => expect(qsa('.cloze.shown')).toHaveLength(1));
    expect(document.querySelector('.cloze-counter')?.textContent).toContain('挖空 1/2');

    act(() => keyDown('V', { shiftKey: true }));
    await waitFor(() => expect(qsa('.cloze.shown')).toHaveLength(2));
    expect(document.querySelector('.cloze-counter')?.textContent).toContain('挖空 2/2');
  });

  it('评分键下方显示新卡的间隔', async () => {
    renderStudy();
    await openStudy();
    const good = qsa('.grade').find((b) => b.textContent?.includes('记住了'));
    expect(good?.querySelector('small')?.textContent).toBe('3天');
  });

  it('评分后前进到下一张，问答卡先显示答案，忘记了会加进本轮', async () => {
    renderStudy();
    await openStudy();

    // 笔记卡可以直接评分
    act(() => keyDown('3'));
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    expect(reviewBodies()[0]).toMatchObject({ cardId: 'c1', rating: 3, practice: false });
    expect(typeof (reviewBodies()[0] as { durationMs?: unknown }).durationMs).toBe('number');
    await waitFor(() => expect(text()).toContain('系统推荐（2/2）'));

    // 第二张是问答卡：没显示答案时评分被挡住
    const before = reviewCalls().length;
    act(() => keyDown('3'));
    expect(screen.getByText('先按空格显示答案')).toBeTruthy();
    expect(reviewCalls()).toHaveLength(before);

    act(() => keyDown(' '));
    await waitFor(() => expect(text()).toContain('ANS'));

    act(() => keyDown('1'));
    await waitFor(() => expect(reviewCalls()).toHaveLength(before + 1));
    expect(reviewBodies()[before]).toMatchObject({ cardId: 'c2', rating: 1, practice: false });
    expect(screen.getByText('已加入本轮稍后再练一次')).toBeTruthy();
    await waitFor(() => expect(text()).toContain('（3/3）'));

    // 第 3 项是本轮重练：评分只是练习，不排期
    act(() => keyDown(' '));
    act(() => keyDown('3'));
    await waitFor(() => expect(reviewCalls()).toHaveLength(before + 2));
    expect(reviewBodies()[before + 1]).toMatchObject({ cardId: 'c2', rating: 3, practice: true });
    await waitFor(() => expect(text()).toContain('学习完成'));
  });

  it('队列为空时提示并关闭', async () => {
    session = { label: '系统推荐', queue: [], cards: [] };
    renderStudy();
    act(() => {
      useUI.getState().openStudy({ deckId: 'd1' });
    });
    await waitFor(() => expect(useUI.getState().study).toBeNull());
    expect(screen.getByText('当前待学卡片已清空 🎉')).toBeTruthy();
    expect(document.querySelector('.study')).toBeNull();
  });

  it('查看器用 cardIds 建队列，不请求 session', async () => {
    renderStudy();
    act(() => {
      useUI.getState().openStudy({ deckId: 'd1', viewer: true, cardIds: ['c1', 'c2'], cardId: 'c2' });
    });
    await waitFor(() => expect(text()).toContain('全部卡片（2/2）'));
    expect(calls.some((c) => c.url.includes('/api/study/'))).toBe(false);
  });
});
