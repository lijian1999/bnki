import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

function mockFetch(handler: (url: string, init: { method?: string; body?: string }) => { ok: boolean; status?: number; json: unknown }) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const r = handler(url, { method, body: init?.body });
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 400), json: async () => r.json } as Response;
  }));
  return calls;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api 请求层', () => {
  it('decks.list 拼接查询参数', async () => {
    const calls = mockFetch(() => ({ ok: true, json: [] }));
    await api.decks.list({ view: 'trash', sort: 'name' });
    expect(calls[0]).toEqual({ url: '/api/decks?view=trash&sort=name', method: 'GET', body: undefined });
  });

  it('items.move 发送完整 body（afterId 为 null）', async () => {
    const calls = mockFetch(() => ({ ok: true, json: { ok: true } }));
    await api.items.move({ ids: ['a'], afterId: null });
    expect(calls[0].url).toBe('/api/items/move');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({ ids: ['a'], afterId: null });
  });

  it('items.remove 走 delete 端点', async () => {
    const calls = mockFetch(() => ({ ok: true, json: { ok: true } }));
    await api.items.remove(['a', 'b']);
    expect(calls[0].url).toBe('/api/items/delete');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({ ids: ['a', 'b'] });
  });

  it('decks.purge 用 DELETE + /purge', async () => {
    const calls = mockFetch(() => ({ ok: true, json: { ok: true } }));
    await api.decks.purge('x');
    expect(calls[0].url).toBe('/api/decks/x/purge');
    expect(calls[0].method).toBe('DELETE');
  });

  it('settings.put 是 PUT', async () => {
    const calls = mockFetch(() => ({ ok: true, json: {} }));
    await api.settings.put({ theme: 'dark' });
    expect(calls[0].url).toBe('/api/settings');
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].body).toEqual({ theme: 'dark' });
  });

  it('404 响应抛 ApiError', async () => {
    mockFetch(() => ({ ok: false, status: 404, json: { error: 'not_found', message: 'x' } }));
    const p = api.decks.get('missing');
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.status).toBe(404);
    expect(e.code).toBe('not_found');
    expect(e.message).toBe('x');
    expect(e).toBeInstanceOf(Error);
  });
});
