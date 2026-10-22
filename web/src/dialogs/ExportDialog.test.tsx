// 导出对话框交互测试：stub fetch 给出两个目录和两张卡片，断言生成的下载链接参数。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Item } from '@bnki/shared';
import ExportDialog from './ExportDialog';

function section(id: string, level: number, position: number, title: string): Item {
  return {
    id, deckId: 'd1', kind: 'section', position, level: level as 1 | 2 | 3 | 4 | 5, title,
    collapsed: false, createdAt: 1, updatedAt: 1,
  };
}

function card(id: string, position: number, front: string): Item {
  return {
    id, deckId: 'd1', kind: 'card', position, cardType: 'note', front, hint: '', back: '',
    color: 'default', createdAt: 1, updatedAt: 1, state: null,
  };
}

const ITEMS: Item[] = [
  section('A', 1, 1, 'A'),
  card('c1', 2, '第一张'),
  section('B', 1, 3, 'B'),
  card('c2', 4, '第二张'),
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const path = String(input).split('?')[0];
      const body = path === '/api/decks/d1/items' ? ITEMS : { ok: true };
      const text = path === '/api/export/d1' ? `# 导出 ${String(input).split('?')[1]}` : '';
      return { ok: true, status: 200, json: async () => body, text: async () => text } satisfies Partial<Response>;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ExportDialog deckId="d1" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

function downloadButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '下载' }) as HTMLButtonElement;
}

/** 点下载后截住链接点击，返回它指向的 URL */
function spyAnchorClick(): () => URL {
  let href = '';
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    href = this.href;
  });
  return () => new URL(href, 'http://localhost');
}

async function waitForSections(): Promise<void> {
  await waitFor(() => expect(screen.getByText('选中目录')).toBeTruthy());
}

describe('ExportDialog', () => {
  it('默认下载是 Markdown、保留挖空', async () => {
    const close = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ExportDialog deckId="d1" onClose={close} />
      </QueryClientProvider>,
    );
    await waitForSections();
    const href = spyAnchorClick();
    fireEvent.click(downloadButton());
    const url = href();
    expect(url.pathname).toBe('/api/export/d1');
    expect(url.searchParams.get('format')).toBe('md');
    expect(url.searchParams.get('cloze')).toBe('keep');
    expect(url.searchParams.get('sections')).toBeNull();
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('格式 / 挖空 / 选中目录都进参数', async () => {
    renderDialog();
    await waitForSections();
    const href = spyAnchorClick();
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    fireEvent.click(screen.getByRole('button', { name: '显示答案' }));
    fireEvent.click(screen.getByRole('button', { name: '选中目录' }));
    fireEvent.click(await screen.findByText('B'));
    fireEvent.click(downloadButton());
    const url = href();
    expect(url.searchParams.get('format')).toBe('csv');
    expect(url.searchParams.get('cloze')).toBe('answer');
    expect(url.searchParams.get('sections')).toBe('B');
  });

  it('选中目录但一个都没选时下载禁用', async () => {
    renderDialog();
    await waitForSections();
    fireEvent.click(screen.getByRole('button', { name: '选中目录' }));
    expect(downloadButton().disabled).toBe(true);
    fireEvent.click(await screen.findByText('A'));
    expect(downloadButton().disabled).toBe(false);
  });

  it('预览导出内容，复制到剪贴板', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderDialog();
    const box = (await screen.findByDisplayValue(/^# 导出 /)) as HTMLTextAreaElement;
    expect(box.value).toContain('format=md');
    expect(box.value).toContain('inline=1');
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    await waitFor(() => expect(box.value).toContain('format=csv'));
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    expect(writeText).toHaveBeenCalledWith(box.value);
  });
});
