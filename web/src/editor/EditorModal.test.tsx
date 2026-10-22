// 卡片编辑器弹窗：fetch 按路径和方法返回数据并记录调用。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type CardItem, type Settings } from '@bnki/shared';
import EditorModal from './EditorModal';
import Overlays from '../ui/Overlays';
import { useUI } from '../store';

interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

let calls: Call[];
let settings: Settings;
let card: CardItem;

function mockFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      calls.push({ url, method, body });
      const path = url.split('?')[0];
      let out: unknown;
      if (path === '/api/settings') out = settings;
      else if (path === '/api/decks/d1/items') out = [card];
      else if (method === 'POST' && path === '/api/items')
        out = { ...card, id: 'n1', cardType: body?.cardType, color: body?.color, front: body?.front, hint: body?.hint, back: body?.back };
      else if (method === 'PATCH' && path === '/api/items/c1') out = { ...card, ...body };
      else out = { ok: true };
      return { ok: true, status: 200, json: async () => out } as Response;
    }),
  );
}

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EditorModal />
      <Overlays />
    </QueryClientProvider>,
  );
}

function open(target: { deckId: string; cardId?: string }): void {
  act(() => {
    useUI.getState().openEditor(target);
  });
}

const patchBody = (url: string): Record<string, unknown> | undefined => calls.find((c) => c.method === 'PATCH' && c.url === url)?.body;
const postBody = (): Record<string, unknown> | undefined => calls.find((c) => c.method === 'POST' && c.url === '/api/items')?.body;

const q = (sel: string): Element | null => document.querySelector(sel);

function esc(): void {
  act(() => {
    fireEvent.keyDown(document.body, { key: 'Escape' });
  });
}

beforeEach(() => {
  calls = [];
  settings = { ...DEFAULT_SETTINGS, lastCardType: 'qa' };
  card = {
    id: 'c1',
    deckId: 'd1',
    kind: 'card',
    position: 1,
    cardType: 'note',
    front: '进程是 {{**资源**分配}} 的单位',
    hint: '',
    back: '',
    color: 'default',
    createdAt: 1,
    updatedAt: 1,
    state: null,
  };
  mockFetch();
});

afterEach(() => {
  esc();
  cleanup();
  vi.unstubAllGlobals();
});

describe('卡片编辑器', () => {
  it('编辑笔记卡：挖空显示、切源码再切回来内容不变', async () => {
    renderEditor();
    open({ deckId: 'd1', cardId: 'c1' });
    await waitFor(() => expect(q('.cloze')).toBeTruthy());
    expect(q('.cloze strong')).toBeTruthy();

    fireEvent.click(screen.getByText('M↓ 源码'));
    await waitFor(() => expect(sourceValue()).toBe('进程是 {{**资源**分配}} 的单位'));

    fireEvent.click(screen.getByText('M↓ 源码'));
    await waitFor(() => expect(q('.cloze')).toBeTruthy());
  });

  it('编辑时源码模式改内容后按 Esc：保存并关闭', async () => {
    renderEditor();
    open({ deckId: 'd1', cardId: 'c1' });
    await waitFor(() => expect(q('.cloze')).toBeTruthy());

    fireEvent.click(screen.getByText('M↓ 源码'));
    await waitFor(() => expect(sourceValue()).toBe('进程是 {{**资源**分配}} 的单位'));
    const ta = q('textarea.src') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '新内容 {{x}}' } });
    esc();

    await waitFor(() => expect(useUI.getState().editor).toBeNull());
    expect(patchBody('/api/items/c1')?.front).toBe('新内容 {{x}}');
  });

  it('新建默认是问答卡，点 ＋ 提示 出现提示字段', async () => {
    renderEditor();
    open({ deckId: 'd1' });
    await waitFor(() => expect(q('.wysiwyg')).toBeTruthy());
    expect(screen.getByText('问题')).toBeTruthy();
    expect(screen.getByText('答案')).toBeTruthy();
    expect(screen.queryByText('提示')).toBeNull();

    fireEvent.click(screen.getByText('＋ 提示'));
    await waitFor(() => expect(screen.getByText('提示')).toBeTruthy());
  });

  it('点 ＋ 提示 后光标落在提示里，⌥↩ 再到答案', async () => {
    renderEditor();
    open({ deckId: 'd1' });
    await waitFor(() => expect(document.querySelectorAll('.ProseMirror').length).toBe(2));
    fireEvent.click(screen.getByText('＋ 提示'));
    await waitFor(() => expect(document.querySelectorAll('.ProseMirror').length).toBe(3));
    const pms = (): Element[] => [...document.querySelectorAll('.ProseMirror')];
    await waitFor(() => expect(document.activeElement).toBe(pms()[1]));

    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter', altKey: true });
    await waitFor(() => expect(document.activeElement).toBe(pms()[2]));
  });

  it('连续新建：填完点完成后弹窗不关，继续下一张', async () => {
    renderEditor();
    open({ deckId: 'd1' });
    await waitFor(() => expect(screen.getByText('问题')).toBeTruthy());

    fireEvent.click(screen.getAllByText('M↓ 源码')[0]);
    await waitFor(() => expect(q('textarea.src')).toBeTruthy());
    const ta = q('textarea.src') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'Q1' } });
    fireEvent.click(screen.getByText('完成 ⌘↩'));

    await waitFor(() => expect(postBody()).toBeTruthy());
    expect(postBody()?.cardType).toBe('qa');
    expect(postBody()?.front).toBe('Q1');
    expect(useUI.getState().editor).not.toBeNull();
    await waitFor(() => expect(screen.getByText('已保存，继续新建下一张')).toBeTruthy());
  });

  it('新建时什么都不填按 Esc：不保存也关闭', async () => {
    renderEditor();
    open({ deckId: 'd1' });
    await waitFor(() => expect(screen.getByText('问题')).toBeTruthy());
    esc();
    await waitFor(() => expect(useUI.getState().editor).toBeNull());
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('改了内容点 × 会问放弃修改', async () => {
    renderEditor();
    open({ deckId: 'd1', cardId: 'c1' });
    await waitFor(() => expect(q('.cloze')).toBeTruthy());

    fireEvent.click(screen.getByText('M↓ 源码'));
    await waitFor(() => expect(sourceValue()).toBe('进程是 {{**资源**分配}} 的单位'));
    const ta = q('textarea.src') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '改了内容' } });

    fireEvent.click(screen.getByTitle('关闭（不保存）'));
    await waitFor(() => expect(screen.getByText('放弃修改？')).toBeTruthy());
  });
});

function sourceValue(): string | undefined {
  return (q('textarea.src') as HTMLTextAreaElement | null)?.value;
}
