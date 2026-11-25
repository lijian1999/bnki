// 学习弹窗交互测试：按 URL + 方法 stub fetch，验证出卡队列、挖空、评分与结束页。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, DAY, type CardItem, type CardState, type DeckSummary, type Item, type Settings } from '@bnki/shared';
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

/** 测试里可覆盖的 /api/settings 响应和列表数据；默认不影响已有用例。 */
let settingsOverride: Partial<Settings> = {};
let itemOverride: Item[] | null = null;

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
/** 需要别的卡片集配置（比如已存了高度）时覆盖默认 deck。 */
let deckOverride: DeckSummary | null = null;

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
      const curDeck = deckOverride ?? deck;
      let data: unknown = { ok: true };
      if (path === '/api/settings') data = { ...DEFAULT_SETTINGS, fuzz: false, ...settingsOverride };
      else if (path === '/api/decks/d1' && method === 'PATCH') {
        const patch = body as { studyCfg?: DeckSummary['studyCfg'] } | undefined;
        data = { ...curDeck, studyCfg: patch?.studyCfg ?? {} };
      } else if (path === '/api/decks/d1') data = curDeck;
      else if (path === '/api/decks/d1/items') data = itemOverride ?? items;
      else if (path === '/api/decks') data = [curDeck];
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
  settingsOverride = {};
  itemOverride = null;
  deckOverride = null;
  mockFetch();
  localStorage.setItem('bnki.studyIntroSeen', '1');
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

describe('首次学习说明', () => {
  it('第一次打开时弹出，Enter 关掉后不再弹，键盘先给说明框', async () => {
    localStorage.removeItem('bnki.studyIntroSeen');
    renderStudy();
    await openStudy();
    expect(text()).toContain('学习说明');
    act(() => keyDown('3'));
    expect(reviewCalls()).toHaveLength(0);
    act(() => keyDown('Enter'));
    await waitFor(() => expect(text()).not.toContain('学习说明'));
    expect(localStorage.getItem('bnki.studyIntroSeen')).toBe('1');
  });
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

  it('主题卡：空格显示内容，标题和内容按纯文本显示、保留换行', async () => {
    const topic: CardItem = { ...noteCard, id: 'c3', cardType: 'topic', front: '调度算法', back: 'FCFS\n**SJF**' };
    session = { label: '系统推荐', queue: [{ cardId: 'c3', rep: false, flipped: false }], cards: [topic] };
    itemOverride = [topic];
    renderStudy();
    act(() => {
      useUI.getState().openStudy({ deckId: 'd1' });
    });
    await waitFor(() => expect(text()).toContain('显示内容（空格）'));
    expect(document.querySelector('.topic-title')?.textContent).toBe('调度算法');
    keyDown(' ');
    await waitFor(() => expect(text()).toContain('FCFS\n**SJF**'));
    expect(document.querySelector('.study-content strong')).toBeNull();
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

// ---------------------------------------------------------------- 朗读（按设置）

/** 最小 SpeechSynthesisUtterance：记录 text，测试里可以手动调它的 onend。 */
class FakeUtter {
  text: string;
  rate = 1;
  lang = '';
  onend: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function stubSpeech(): { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
  const speak = vi.fn();
  const cancel = vi.fn();
  vi.stubGlobal('speechSynthesis', { speak, cancel });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtter);
  return { speak, cancel };
}

const spokenText = (speak: ReturnType<typeof vi.fn>, i: number): string => (speak.mock.calls[i]?.[0] as FakeUtter | undefined)?.text ?? '';

async function openViewer(ids: string[], start: string): Promise<void> {
  act(() => {
    useUI.getState().openStudy({ deckId: 'd1', viewer: true, cardIds: ids, cardId: start });
  });
  await waitFor(() => expect(text()).toContain('全部卡片'));
}

describe('朗读（按设置）', () => {
  it('visible：问答卡未显示答案时只读题目那一面', async () => {
    settingsOverride = { ttsScope: 'visible' };
    const { speak } = stubSpeech();
    renderStudy();
    await openViewer(['c2'], 'c2');
    act(() => keyDown('r'));
    expect(speak).toHaveBeenCalledTimes(1);
    expect(spokenText(speak, 0)).toBe('Q');
    expect(spokenText(speak, 0)).not.toContain('ANS');
  });

  it('card：问答卡正面和背面都读', async () => {
    settingsOverride = { ttsScope: 'card' };
    const { speak } = stubSpeech();
    renderStudy();
    await openViewer(['c2'], 'c2');
    act(() => keyDown('r'));
    expect(spokenText(speak, 0)).toBe('Q。ANS');
  });

  it('loop：单卡循环，onend 后再读一遍同一张卡', async () => {
    settingsOverride = { ttsMode: 'loop' };
    const { speak } = stubSpeech();
    renderStudy();
    await openViewer(['c2'], 'c2');
    act(() => keyDown('r'));
    expect(speak).toHaveBeenCalledTimes(1);
    const u = speak.mock.calls[0]?.[0] as FakeUtter;
    act(() => {
      u.onend?.();
    });
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(2));
    expect(spokenText(speak, 1)).toBe(spokenText(speak, 0));
    // 停止朗读后不会再续
    act(() => {
      u.onend?.();
    });
  });

  it('语言筛选 foreign：跳过汉字', async () => {
    settingsOverride = { ttsLangFilter: 'foreign' };
    itemOverride = [
      ...items,
      { id: 'c3', deckId: 'd1', kind: 'card', position: 3, cardType: 'qa', front: '苹果 apple', hint: '', back: '苹果', color: 'default', createdAt: 1, updatedAt: 1, state: null },
    ];
    const { speak } = stubSpeech();
    renderStudy();
    await openViewer(['c3'], 'c3');
    act(() => keyDown('r'));
    expect(speak).toHaveBeenCalledTimes(1);
    expect(spokenText(speak, 0)).toBe('apple');
  });

  it('不支持朗读时提示，不建语音', async () => {
    renderStudy();
    await openViewer(['c2'], 'c2');
    act(() => keyDown('r'));
    expect(await screen.findByText('浏览器不支持朗读')).toBeTruthy();
  });
});

// ---------------------------------------------------------------- 卡片高度（方案 B）

describe('卡片高度', () => {
  const studyEl = (): HTMLElement => document.querySelector('.study') as HTMLElement;
  const gripEl = (): HTMLElement => document.querySelector('.study-grip') as HTMLElement;
  const patchCalls = (): { url: string; method: string; body?: unknown }[] =>
    calls.filter((c) => c.method === 'PATCH' && c.url === '/api/decks/d1');

  /** jsdom 没有布局：手动给卡片一个“当前高度”，拖动换算才有起点。 */
  function stubHeight(h: number): void {
    const el = studyEl();
    el.getBoundingClientRect = () => ({
      height: h, width: 640, top: 0, bottom: h, left: 0, right: 640, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect;
  }

  it('拖底边把手：拖动中实时变高，松手才写一次 studyCfg.height', async () => {
    renderStudy();
    await openStudy();
    stubHeight(620);
    expect(studyEl().style.height).toBe(''); // 没调过高度时由 size-* 决定

    fireEvent.pointerDown(gripEl(), { clientY: 300, button: 0 });
    fireEvent.pointerMove(window, { clientY: 330 });
    // 卡片垂直居中：下边缘跟住光标需要 2× 位移 → 620 + 60
    expect(studyEl().style.height).toBe('680px');
    expect(patchCalls()).toHaveLength(0); // 拖动过程中不发请求

    fireEvent.pointerUp(window);
    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(patchCalls()[0]?.body).toMatchObject({ studyCfg: { height: 680 } });
    expect(studyEl().style.width).toBe(''); // 宽度仍然交给 size-*，没有被写死
  });

  it('拖动夹在 320 下限和视口上限之间', async () => {
    renderStudy();
    await openStudy();
    stubHeight(620);
    fireEvent.pointerDown(gripEl(), { clientY: 400 });
    fireEvent.pointerMove(window, { clientY: 0 }); // 620 - 800 → 下限
    expect(studyEl().style.height).toContain('320px');
    fireEvent.pointerMove(window, { clientY: 900 }); // 远超上限
    expect(studyEl().style.height).toContain(`${window.innerHeight - 80}px`);
    fireEvent.pointerUp(window);
    await waitFor(() => expect(patchCalls()).toHaveLength(1));
  });

  it('键盘 ↑↓ 微调，keyup 时保存', async () => {
    renderStudy();
    await openStudy();
    stubHeight(620);
    fireEvent.keyDown(gripEl(), { key: 'ArrowUp' });
    expect(studyEl().style.height).toContain('636px');
    expect(patchCalls()).toHaveLength(0); // 按住不放只保存最后的值
    fireEvent.keyUp(gripEl(), { key: 'ArrowUp' });
    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(patchCalls()[0]?.body).toMatchObject({ studyCfg: { height: 636 } });
  });

  it('已保存的高度直接生效；双击把手删掉 height 并回到预设', async () => {
    deckOverride = { ...deck, studyCfg: { height: 700 } };
    renderStudy();
    await openStudy();
    expect(studyEl().style.height).toBe('700px');

    fireEvent.doubleClick(gripEl());
    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    const body = patchCalls()[0]?.body as { studyCfg: Record<string, unknown> };
    expect(body.studyCfg.height).toBeUndefined();
    await waitFor(() => expect(studyEl().style.height).toBe(''));
  });

  it('卡片大小选全屏时没有把手（高度由视口决定）', async () => {
    deckOverride = { ...deck, studyCfg: { size: 'full' } };
    renderStudy();
    await openStudy();
    expect(document.querySelector('.study-grip')).toBeNull();
  });
});
