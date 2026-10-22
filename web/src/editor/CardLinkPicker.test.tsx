// 卡片链接选择框：fetch 换成假数据，防抖用真实计时器等 waitFor。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import CardLinkPicker from './CardLinkPicker';
import type { SearchHit } from '../api';

let urls: string[];
let payload: SearchHit[];

const HITS: SearchHit[] = [
  { id: 'c1', deckId: 'd1', deckTitle: '操作系统', cardType: 'note', front: '什么是**进程**？', text: '什么是进程？' },
  { id: 'c2', deckId: 'd1', deckTitle: '计算机基础', cardType: 'qa', front: '线程的调度\n是==抢占式==的', text: '线程的调度是抢占式的' },
];

const q = (sel: string): NodeListOf<Element> => document.querySelectorAll(sel);

function type(query: string): void {
  fireEvent.change(document.querySelector('.text-input') as HTMLInputElement, { target: { value: query } });
}

function picker() {
  const onPick = vi.fn();
  render(<CardLinkPicker onPick={onPick} onClose={vi.fn()} />);
  return onPick;
}

beforeEach(() => {
  urls = [];
  payload = HITS;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      urls.push(String(input));
      return { ok: true, status: 200, json: async () => payload } as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('卡片链接选择框', () => {
  it('搜“进程”：请求带上关键词，两条结果', async () => {
    picker();
    type('进程');
    await waitFor(() => expect(q('.cl-hit').length).toBe(2));
    expect(urls.some((u) => u.includes('/api/search?q=%E8%BF%9B%E7%A8%8B') || decodeURIComponent(u).includes('q=进程'))).toBe(true);
    expect(q('.cl-hit')[0].textContent).toContain('什么是');
    expect(q('.cl-hit')[1].textContent).toContain('计算机基础');
  });

  it('按 ↓ 再按 Enter：选中第二条，label 是它正面的第一行', async () => {
    const onPick = picker();
    type('进程');
    await waitFor(() => expect(q('.cl-hit').length).toBe(2));
    const input = document.querySelector('.text-input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith({ id: 'c2', label: '线程的调度' });
  });

  it('点一条结果也算选中', async () => {
    const onPick = picker();
    type('进程');
    await waitFor(() => expect(q('.cl-hit').length).toBe(2));
    fireEvent.click(q('.cl-hit')[1]);
    expect(onPick).toHaveBeenCalledWith({ id: 'c2', label: '线程的调度' });
  });

  it('没有结果时显示“没有找到”', async () => {
    payload = [];
    picker();
    type('没有这种卡片');
    await waitFor(() => expect(document.body.textContent).toContain('没有找到'));
    expect(q('.cl-hit').length).toBe(0);
  });
});
