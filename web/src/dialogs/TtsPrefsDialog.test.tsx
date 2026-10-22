// 朗读偏好弹窗测试：点分段按钮立即 PUT /api/settings 保存对应字段。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type Settings } from '@bnki/shared';
import TtsPrefsDialog from './TtsPrefsDialog';

let calls: { url: string; method: string; body?: unknown }[];

function mockFetch(): void {
  let settings: Settings = { ...DEFAULT_SETTINGS };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = String(input).split('?')[0];
      const method = (init?.method ?? 'GET').toUpperCase();
      let body: unknown;
      try {
        body = init?.body ? JSON.parse(init.body) : undefined;
      } catch {
        body = init?.body;
      }
      calls.push({ url, method, body });
      if (url === '/api/settings' && method === 'PUT') settings = { ...settings, ...(body as object) } as Settings;
      const data = url === '/api/settings' ? settings : { ok: true };
      return { ok: true, status: 200, json: async () => data } as Response;
    }),
  );
}

function renderDialog(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TtsPrefsDialog deckId="d1" onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

const text = (): string => document.body.textContent ?? '';

async function clickAndWait(label: string): Promise<void> {
  const btn = await waitFor(() => {
    const el = Array.from(document.querySelectorAll('.seg button')).find((b) => b.textContent === label);
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });
  fireEvent.click(btn);
}

beforeEach(() => {
  calls = [];
  mockFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('朗读偏好弹窗', () => {
  it('显示标题和各行', async () => {
    renderDialog();
    await waitFor(() => expect(text()).toContain('朗读偏好'));
    await waitFor(() => expect(text()).toContain('系统朗读'));
    expect(text()).toContain('单卡循环');
  });

  it('点 整张卡 → PUT 含 ttsScope=card', async () => {
    renderDialog();
    await clickAndWait('整张卡');
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/settings' && (c.body as Settings)?.ttsScope === 'card')).toBe(true),
    );
  });

  it('点 单卡循环 → PUT 含 ttsMode=loop', async () => {
    renderDialog();
    await clickAndWait('单卡循环');
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/settings' && (c.body as Settings)?.ttsMode === 'loop')).toBe(true),
    );
  });

  it('点 只读外语 → PUT 含 ttsLangFilter=foreign', async () => {
    renderDialog();
    await clickAndWait('只读外语');
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/settings' && (c.body as Settings)?.ttsLangFilter === 'foreign')).toBe(
        true,
      ),
    );
  });
});
