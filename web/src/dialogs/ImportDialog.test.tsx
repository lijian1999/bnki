// 导入对话框：文本页解析预览并调 /api/import/text；Markdown 页按所选切分方式调 /api/import/markdown。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ImportDialog from './ImportDialog';
import Overlays from '../ui/Overlays';

let calls: { url: string; method: string; body?: Record<string, unknown> }[];

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      calls.push({ url, method, body });
      if (url === '/api/import/text' || url === '/api/import/markdown') {
        return { ok: true, status: 200, json: async () => ({ cards: 2, sections: 0 }) } as Response;
      }
      if (url.includes('/items')) return { ok: true, status: 200, json: async () => [] } as Response;
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
    }),
  );
}

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImportDialog deckId="d1" onClose={() => {}} />
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

describe('导入对话框', () => {
  it('文本页解析出卡片数并导入', async () => {
    renderDialog();
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '问1\t答1\n问2' } });
    await waitFor(() => expect(document.body.textContent).toContain('识别到 2 张卡片'));

    fireEvent.click(screen.getByText('导入到末尾'));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'POST' &&
            c.url === '/api/import/text' &&
            JSON.stringify(c.body) === JSON.stringify({ deckId: 'd1', text: '问1\t答1\n问2', format: 'tsv', firstColumnIsSection: false }),
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByText('已导入 2 张卡片')).toBeTruthy());
  });

  it('Markdown 页按每段一张导入', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('Markdown 文件'));
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '# 章\n- a\n- b' } });
    fireEvent.click(screen.getByText('每段一张'));
    fireEvent.click(screen.getByText('导入到末尾'));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/import/markdown' && c.body?.split === 'paragraph')).toBe(true),
    );
  });
});
