import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../app';
import type { SearchHit } from './search';

describe('GET /api/search', () => {
  it('按去掉标记的文本搜，跟随增删改，排除已删除', async () => {
    const { app } = await buildApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-search-')), memory: true });
    const deck = (await app.inject({ method: 'POST', url: '/api/decks', payload: { title: '操作系统' } })).json() as { id: string };
    const add = async (front: string, back = '') =>
      (await app.inject({ method: 'POST', url: '/api/items', payload: { deckId: deck.id, kind: 'card', cardType: 'qa', front, back } })).json() as { id: string };
    const a = await add('进程是{{**资源分配**}}的单位');
    const b = await add('线程', '调度的基本单位 Thread');
    await app.inject({ method: 'POST', url: '/api/items', payload: { deckId: deck.id, kind: 'section', title: '资源分配' } });
    const search = async (q: string) =>
      ((await app.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent(q)}` })).json() as SearchHit[]).map((h) => h.id);

    expect(await search('资源分配的')).toEqual([a.id]);
    const hit = (await app.inject({ method: 'GET', url: '/api/search?q=thread' })).json() as SearchHit[];
    expect(hit).toMatchObject([{ id: b.id, deckId: deck.id, deckTitle: '操作系统', cardType: 'qa', front: '线程' }]);
    expect(await search('单位')).toHaveLength(2);
    expect(await search('%')).toEqual([]);

    await app.inject({ method: 'PATCH', url: `/api/items/${a.id}`, payload: { front: '虚拟内存' } });
    expect(await search('资源分配')).toEqual([]);
    expect(await search('虚拟内存')).toEqual([a.id]);

    await app.inject({ method: 'POST', url: '/api/items/delete', payload: { ids: [b.id] } });
    expect(await search('thread')).toEqual([]);
    await app.inject({ method: 'DELETE', url: `/api/decks/${deck.id}` });
    expect(await search('虚拟')).toEqual([]);
  });
});
