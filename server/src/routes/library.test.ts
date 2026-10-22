// 卡片集、分类、目录和卡片接口（contracts §3.1–3.3）。
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DAY, newCardState, type CardState, type DeckSummary, type Folder } from '@bnki/shared';
import { buildApp, type Ctx } from '../app';
import { saveState } from '../mappers';

const T = 1750000000000; // 固定时间戳；要前进时间的用例自己调 setNow
const MIN = 60_000;

type Json = Record<string, unknown>;
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Res<T> = { status: number; body: T };

let suite = 0;
const opened: { app: FastifyInstance; dir: string }[] = [];

/** 起一个固定时间的应用，返回请求和时间控制的辅助函数。 */
async function harness(): Promise<{ app: FastifyInstance; ctx: Ctx; setNow: (t: number) => void }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bnki-lib-${suite++}-`));
  let t = T;
  const { app, ctx } = await buildApp({ dataDir: dir, memory: true, now: () => t });
  opened.push({ app, dir });
  return { app, ctx, setNow: (next: number) => { t = next; } };
}

type H = Awaited<ReturnType<typeof harness>>;

async function call<T = Json>(h: H, method: Method, url: string, payload?: unknown): Promise<Res<T>> {
  const res = await h.app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload), headers: { 'content-type': 'application/json' } }),
  });
  let body: Json | undefined;
  try { body = res.json() as Json; } catch { body = undefined; }
  return { status: res.statusCode, body: (body ?? {}) as T };
}

const get = <T = Json>(h: H, url: string) => call<T>(h, 'GET', url);
const post = <T = Json>(h: H, url: string, payload?: unknown) => call<T>(h, 'POST', url, payload ?? {});
const patch = <T = Json>(h: H, url: string, payload: unknown) => call<T>(h, 'PATCH', url, payload);
const del = <T = Json>(h: H, url: string) => call<T>(h, 'DELETE', url);

const idOf = (r: Res<Json>): string => r.body.id as string;

/** 列表里条目的 id 顺序。 */
async function order(h: H, deckId: string): Promise<string[]> {
  const r = await get<{ id: string }[]>(h, `/api/decks/${deckId}/items`);
  expect(r.status).toBe(200);
  return r.body.map((i) => i.id);
}

async function deckIds(h: H, qs = ''): Promise<string[]> {
  const r = await get<DeckSummary[]>(h, `/api/decks${qs}`);
  expect(r.status).toBe(200);
  return r.body.map((d) => d.id);
}

async function newFolder(h: H, name: string): Promise<Folder> {
  const r = await post<Folder>(h, '/api/folders', { name });
  expect(r.status).toBe(200);
  return r.body;
}

async function newDeck(h: H, title?: string, folderId?: string | null): Promise<DeckSummary> {
  const r = await post<DeckSummary>(h, '/api/decks', title === undefined ? {} : { title, folderId });
  expect(r.status).toBe(200);
  return r.body;
}

async function addCard(h: H, deckId: string, extra: Json = {}): Promise<string> {
  const r = await call<Json>(h, 'POST', '/api/items', { deckId, kind: 'card', ...extra });
  expect(r.status).toBe(200);
  return idOf(r);
}

async function addSection(h: H, deckId: string, extra: Json = {}): Promise<string> {
  const r = await call<Json>(h, 'POST', '/api/items', { deckId, kind: 'section', ...extra });
  expect(r.status).toBe(200);
  return idOf(r);
}

const stateOf = (due: number | null, mastered = false): CardState =>
  ({ ...newCardState(), state: 2, due, stability: 5, difficulty: 5, elapsedDays: 1, scheduledDays: 1,
    lastReview: T, mastered });

const countRows = (h: H, sql: string, ...params: unknown[]): number => {
  const r = h.ctx.db.prepare(sql).get(...params) as { c: number } | undefined;
  return r?.c ?? 0;
};

const reviewLogCount = (h: H, deckId: string, kind: string): number =>
  countRows(h, "SELECT COUNT(*) AS c FROM review_logs WHERE deck_id = ? AND kind = ?", deckId, kind);

const editLogCount = (h: H, cardId: string, action: string): number =>
  countRows(h, 'SELECT COUNT(*) AS c FROM edit_logs WHERE card_id = ? AND action = ?', cardId, action);

afterEach(async () => {
  while (opened.length) {
    const { app, dir } = opened.pop()!;
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('分类接口', () => {
  it('新建、按 position 排序、改名、空名字 400', async () => {
    const h = await harness();
    const a = await newFolder(h, '数学');
    const b = await newFolder(h, '语文');
    expect(a.id).not.toBe(b.id);
    expect(a.position).toBe(1);
    expect(b.position).toBe(2);
    expect(a.name).toBe('数学');
    expect(a.createdAt).toBe(T);

    const list = await get<Folder[]>(h, '/api/folders');
    expect(list.body.map((f) => f.name)).toEqual(['数学', '语文']);

    const renamed = await patch<Folder>(h, `/api/folders/${b.id}`, { name: '外语' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('外语');
    const list2 = await get<Folder[]>(h, '/api/folders');
    expect(list2.body.map((f) => f.name)).toEqual(['数学', '外语']);

    expect((await post(h, '/api/folders', { name: '   ' })).status).toBe(400);
    expect((await post(h, '/api/folders', {})).status).toBe(400);
    expect((await patch(h, `/api/folders/${b.id}`, { name: '' })).status).toBe(400);
    expect((await patch(h, '/api/folders/nope', { name: 'x' })).status).toBe(404);
    expect((await del(h, '/api/folders/nope')).status).toBe(404);
  });

  it('删除分类：卡片集进回收站、folderId 置空；已在回收站的只清 folderId', async () => {
    const h = await harness();
    const f = await newFolder(h, '高三');
    const d1 = await newDeck(h, '数学', f.id);
    const d2 = await newDeck(h, '物理', f.id);
    const d3 = await newDeck(h, '已删', f.id);
    expect((await del(h, `/api/decks/${d3.id}`)).status).toBe(200);
    const deletedAt3 = (await get<DeckSummary>(h, `/api/decks/${d3.id}`)).body.deletedAt;
    expect(deletedAt3).toBe(T);

    const r = await del<{ ok: boolean }>(h, `/api/folders/${f.id}`);
    expect(r.body).toEqual({ ok: true });
    expect((await get<Folder[]>(h, '/api/folders')).body).toEqual([]);

    const trash = await get<DeckSummary[]>(h, '/api/decks?view=trash');
    expect(trash.body.map((d) => d.id).sort()).toEqual([d1.id, d2.id, d3.id].sort());
    for (const d of trash.body) expect(d.folderId).toBe(null);
    expect(trash.body.find((d) => d.id === d3.id)?.deletedAt).toBe(deletedAt3);

    expect(await deckIds(h)).toEqual([]);
    expect((await del(h, `/api/folders/${f.id}`)).status).toBe(404);
  });
});

describe('卡片集接口', () => {
  it('新建默认标题，列表里 counts 全 0、nextDue null', async () => {
    const h = await harness();
    const d = await newDeck(h);
    expect(d.title).toBe('无标题卡片集');
    expect(d.counts).toEqual({ total: 0, fresh: 0, due: 0, learned: 0, pct: 0, nextDue: null });
    expect(d.folderId).toBe(null);
    expect(d.updatedAt).toBe(T);
    expect((await get<DeckSummary[]>(h, '/api/decks')).body.map((x) => x.id)).toEqual([d.id]);
    expect((await get<DeckSummary>(h, `/api/decks/${d.id}`)).body.id).toBe(d.id);
    expect((await get<DeckSummary[]>(h, '/api/decks')).body[0].counts.total).toBe(0);
    expect((await post(h, '/api/decks', { title: '  ' })).status).toBe(400);
    expect((await get(h, '/api/decks/nope')).status).toBe(404);
    expect((await patch(h, '/api/decks/nope', { title: 'x' })).status).toBe(404);
    expect((await del(h, '/api/decks/nope')).status).toBe(404);
  });

  it('sort=name 置顶优先，sort=card_count 按卡片数降序', async () => {
    const h = await harness();
    const beta = await newDeck(h, 'Beta');
    const alpha = await newDeck(h, 'Alpha');
    const gamma = await newDeck(h, 'Gamma');
    expect((await patch(h, `/api/decks/${gamma.id}`, { pinned: true })).body.pinnedAt).toBe(T);
    const byName = await get<DeckSummary[]>(h, '/api/decks?sort=name');
    expect(byName.body.map((d) => d.title)).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect((await patch(h, `/api/decks/${gamma.id}`, { pinned: false })).body.pinnedAt).toBe(null);

    await addCard(h, alpha.id);
    await addCard(h, alpha.id);
    await addCard(h, beta.id);
    const byCount = await get<DeckSummary[]>(h, '/api/decks?sort=card_count');
    expect(byCount.body.map((d) => d.id)).toEqual([alpha.id, beta.id, gamma.id]);
    const byFresh = await get<DeckSummary[]>(h, '/api/decks?sort=fresh_count');
    expect(byFresh.body.map((d) => d.id)).toEqual([alpha.id, beta.id, gamma.id]);

    // 非法 folderId → 400
    expect((await patch(h, `/api/decks/${gamma.id}`, { folderId: 'nope' })).status).toBe(400);
    expect((await patch(h, `/api/decks/${gamma.id}`, { title: '  ' })).status).toBe(400);
  });

  it('q 过滤标题不区分大小写；folder 过滤', async () => {
    const h = await harness();
    const apple = await newDeck(h, 'Apple Notes');
    const banana = await newDeck(h, 'banana 手册');
    expect((await deckIds(h, '?q=apple')).sort()).toEqual([apple.id]);
    expect((await deckIds(h, '?q=BANANA')).sort()).toEqual([banana.id]);
    expect((await deckIds(h, '?q=zzz'))).toEqual([]);

    const f = await newFolder(h, '笔记');
    const inFolder = await newDeck(h, '在分类里', f.id);
    expect((await deckIds(h, `?folder=${f.id}`))).toEqual([inFolder.id]);
    expect((await deckIds(h, '?folder=nope'))).toEqual([]);
  });

  it('recent 只含打开过的、按打开时间降序，forget-recent 后消失', async () => {
    const h = await harness();
    const d1 = await newDeck(h, '一');
    const d2 = await newDeck(h, '二');
    await post(h, `/api/decks/${d1.id}/open`);
    h.setNow(T + 10 * MIN);
    await post(h, `/api/decks/${d2.id}/open`);
    expect(await deckIds(h, '?view=recent')).toEqual([d2.id, d1.id]);

    expect((await post<{ ok: boolean }>(h, `/api/decks/${d2.id}/forget-recent`)).body).toEqual({ ok: true });
    expect(await deckIds(h, '?view=recent')).toEqual([d1.id]);
    expect((await get<DeckSummary>(h, `/api/decks/${d2.id}`)).body.openedAt).toBe(null);
  });

  it('删除 → 回收站 → restore → purge 清掉 items 和 card_states', async () => {
    const h = await harness();
    const d = await newDeck(h, '要删的');
    const c1 = await addCard(h, d.id);
    await addCard(h, d.id);
    saveState(h.ctx.db, c1, stateOf(T - 1000));

    expect((await del<{ ok: boolean }>(h, `/api/decks/${d.id}`)).body).toEqual({ ok: true });
    expect(await deckIds(h)).toEqual([]);
    expect(await deckIds(h, '?view=trash')).toEqual([d.id]);
    // 回收站里的也能取
    const trashed = await get<DeckSummary>(h, `/api/decks/${d.id}`);
    expect(trashed.body.deletedAt).toBe(T);
    expect(trashed.body.counts.total).toBe(2);

    const restored = await post<DeckSummary>(h, `/api/decks/${d.id}/restore`);
    expect(restored.body.deletedAt).toBe(null);
    expect(await deckIds(h)).toEqual([d.id]);
    expect(await deckIds(h, '?view=trash')).toEqual([]);

    // 分类被删光后 restore 时 folderId 归零
    const f = await newFolder(h, '临时');
    const d2 = await newDeck(h, '恢复用', f.id);
    await del(h, `/api/decks/${d2.id}`);
    h.ctx.db.prepare('DELETE FROM folders WHERE id = ?').run(f.id);
    expect((await post<DeckSummary>(h, `/api/decks/${d2.id}/restore`)).body.folderId).toBe(null);

    expect((await del<{ ok: boolean }>(h, `/api/decks/${d.id}/purge`)).body).toEqual({ ok: true });
    expect((await get(h, `/api/decks/${d.id}`)).status).toBe(404);
    expect(countRows(h, 'SELECT COUNT(*) AS c FROM items WHERE deck_id = ?', d.id)).toBe(0);
    expect(countRows(h, 'SELECT COUNT(*) AS c FROM card_states WHERE card_id = ?', c1)).toBe(0);
    expect(countRows(h, 'SELECT COUNT(*) AS c FROM decks WHERE id = ?', d.id)).toBe(0);
    expect(await deckIds(h)).toEqual([d2.id]);
  });

  it('DELETE /api/trash 清空回收站', async () => {
    const h = await harness();
    const keep = await newDeck(h, '保留');
    const a = await newDeck(h, '删a');
    const b = await newDeck(h, '删b');
    await addCard(h, b.id);
    await del(h, `/api/decks/${a.id}`);
    await del(h, `/api/decks/${b.id}`);
    expect((await del<{ ok: boolean }>(h, '/api/trash')).body).toEqual({ ok: true });
    expect(await deckIds(h, '?view=trash')).toEqual([]);
    expect(await deckIds(h)).toEqual([keep.id]);
    expect(countRows(h, 'SELECT COUNT(*) AS c FROM items WHERE deck_id = ?', b.id)).toBe(0);
  });

  it('counts：due 用自己的到期判定，mastered 不算待复习', async () => {
    const h = await harness();
    const d = await newDeck(h, '计数');
    const c1 = await addCard(h, d.id);
    const c2 = await addCard(h, d.id);
    const c3 = await addCard(h, d.id); // 没写过状态
    saveState(h.ctx.db, c1, stateOf(T - 1000));
    saveState(h.ctx.db, c2, stateOf(T + 30 * DAY));

    const expected = { total: 3, fresh: 1, due: 1, learned: 2, pct: 67, nextDue: T - 1000 };
    const single = await get<DeckSummary>(h, `/api/decks/${d.id}`);
    expect(single.body.counts).toEqual(expected);
    const listed = await get<DeckSummary[]>(h, '/api/decks');
    expect(listed.body.find((x) => x.id === d.id)?.counts).toEqual(expected);

    saveState(h.ctx.db, c1, { ...newCardState(), mastered: true });
    const after = await get<DeckSummary>(h, `/api/decks/${d.id}`);
    expect(after.body.counts.due).toBe(0);
    expect(after.body.counts.nextDue).toBe(T + 30 * DAY);

    void c3;
  });

  it('duplicate：标题加“ 副本”、卡片数相同、id 全新、没有状态', async () => {
    const h = await harness();
    const f = await newFolder(h, '原分类');
    const d = await newDeck(h, '原版', f.id);
    const c1 = await addCard(h, d.id, { cardType: 'qa', front: '问题', back: '答案' });
    const c2 = await addCard(h, d.id);
    saveState(h.ctx.db, c1, stateOf(T - 60_000));
    expect((await get<{ id: string }[]>(h, `/api/decks/${d.id}/items`)).body.length).toBe(2);

    const copy = await post<DeckSummary>(h, `/api/decks/${d.id}/duplicate`);
    expect(copy.body.title).toBe('原版 副本');
    expect(copy.body.folderId).toBe(f.id);
    const ids = (await get<Json[]>(h, `/api/decks/${copy.body.id}/items`)).body;
    expect(ids.length).toBe(2);
    expect(copy.body.counts.total).toBe(2);
    expect((await get<DeckSummary>(h, `/api/decks/${d.id}`)).body.counts.total).toBe(2);
    expect(ids.some((i) => [c1, c2].includes(i.id as string))).toBe(false);
    expect(ids.every((i) => i.state === null)).toBe(true);
    const orig = (await get<Json[]>(h, `/api/decks/${d.id}/items`)).body;
    expect(orig.map((i) => i.position)).toEqual(ids.map((i) => i.position));
    expect((await get<Json[]>(h, `/api/decks/${copy.body.id}/items`)).body[0])
      .toEqual(expect.objectContaining({ cardType: 'qa', front: '问题', back: '答案' }));
  });

  it('reset-progress：状态清空并写 reset 日志', async () => {
    const h = await harness();
    const d = await newDeck(h, '重来');
    const c1 = await addCard(h, d.id);
    const c2 = await addCard(h, d.id);
    await addCard(h, d.id);
    saveState(h.ctx.db, c1, stateOf(T + DAY));
    saveState(h.ctx.db, c2, stateOf(T + 2 * DAY));

    expect((await post<{ ok: boolean }>(h, `/api/decks/${d.id}/reset-progress`)).body).toEqual({ ok: true });
    const items = await get<Json[]>(h, `/api/decks/${d.id}/items`);
    expect(items.body.every((i) => i.state === null)).toBe(true);
    expect(reviewLogCount(h, d.id, 'reset')).toBe(2);
    expect(countRows(h, 'SELECT COUNT(*) AS c FROM card_states WHERE card_id IN (?, ?)', c1, c2)).toBe(0);
  });
});

describe('目录和卡片接口', () => {
  it('顺序与 afterId 位置规则', async () => {
    const h = await harness();
    const d = await newDeck(h, '位置');
    const a = await addSection(h, d.id, { title: '目录 A' });
    const c1 = await addCard(h, d.id);
    const c2 = await addCard(h, d.id);
    expect(await order(h, d.id)).toEqual([a, c1, c2]);

    const front = await addCard(h, d.id, { afterId: null });
    expect(await order(h, d.id)).toEqual([front, a, c1, c2]);

    const mid = await addCard(h, d.id, { afterId: a });
    expect(await order(h, d.id)).toEqual([front, a, mid, c1, c2]);

    // afterId 不存在或不属于本卡片集
    expect((await post(h, '/api/items', { deckId: d.id, kind: 'card', afterId: 'nope' })).status).toBe(400);
    const other = await newDeck(h, '别的集');
    const otherCard = await addCard(h, other.id);
    expect((await post(h, '/api/items', { deckId: d.id, kind: 'card', afterId: otherCard })).status).toBe(400);
    expect((await post(h, '/api/items', { deckId: 'nope', kind: 'card' })).status).toBe(404);
    expect((await post(h, '/api/items', { deckId: d.id, kind: 'other' })).status).toBe(400);
    expect((await get(h, '/api/decks/nope/items')).status).toBe(404);
  });

  it('新建的默认值', async () => {
    const h = await harness();
    const d = await newDeck(h);
    const s = await call<Json>(h, 'POST', '/api/items', { deckId: d.id, kind: 'section' });
    expect(s.status).toBe(200);
    expect(s.body).toEqual(expect.objectContaining({ kind: 'section', level: 1, title: '新目录', collapsed: false }));
    const c = await call<Json>(h, 'POST', '/api/items', { deckId: d.id, kind: 'card' });
    expect(c.status).toBe(200);
    expect(c.body).toEqual(expect.objectContaining({
      kind: 'card', cardType: 'note', color: 'default', front: '', hint: '', back: '', state: null,
    }));
    expect(editLogCount(h, c.body.id as string, 'create')).toBe(1);
    // 非法取值
    expect((await post(h, '/api/items', { deckId: d.id, kind: 'section', level: 6 })).status).toBe(400);
    expect((await post(h, '/api/items', { deckId: d.id, kind: 'card', color: 'pink' })).status).toBe(400);
    expect((await post(h, '/api/items', { deckId: d.id, kind: 'card', cardType: 'x' })).status).toBe(400);
  });

  it('PATCH 改 front 写 update 日志；只改 collapsed 不刷新 updatedAt', async () => {
    const h = await harness();
    const d = await newDeck(h);
    const c = await addCard(h, d.id);
    const s = await addSection(h, d.id);

    h.setNow(T + MIN);
    const edited = await patch<Json>(h, `/api/items/${c}`, { front: '新内容' });
    expect(edited.status).toBe(200);
    expect(edited.body.front).toBe('新内容');
    expect(edited.body.updatedAt).toBe(T + MIN);
    expect(editLogCount(h, c, 'update')).toBe(1);
    expect((await get<DeckSummary>(h, `/api/decks/${d.id}`)).body.updatedAt).toBe(T + MIN);

    // 只改目录的 collapsed：卡片集和本项的 updatedAt 都不动
    h.setNow(T + 2 * MIN);
    const collapsed = await patch<Json>(h, `/api/items/${s}`, { collapsed: true });
    expect(collapsed.body.collapsed).toBe(true);
    expect((await get<DeckSummary>(h, `/api/decks/${d.id}`)).body.updatedAt).toBe(T + MIN);
    expect((await get<Json[]>(h, `/api/decks/${d.id}/items`)).body.find((i) => i.id === s)?.updatedAt).toBe(T);
    expect(editLogCount(h, s, 'update')).toBe(0);

    h.setNow(T + 3 * MIN);
    await patch(h, `/api/items/${c}`, { color: 'blue' });
    expect((await get<DeckSummary>(h, `/api/decks/${d.id}`)).body.updatedAt).toBe(T + 3 * MIN);

    // 非法值
    expect((await patch(h, `/api/items/${s}`, { level: 6 })).status).toBe(400);
    expect((await patch(h, `/api/items/${c}`, { color: 'pink' })).status).toBe(400);
    expect((await patch(h, '/api/items/nope', { front: 'x' })).status).toBe(404);
  });

  it('delete 与 restore 保持位置', async () => {
    const h = await harness();
    const d = await newDeck(h);
    const a = await addSection(h, d.id, { title: 'A' });
    const c1 = await addCard(h, d.id);
    const c2 = await addCard(h, d.id);

    expect((await post<{ ok: boolean }>(h, '/api/items/delete', { ids: [c1, c2] })).body).toEqual({ ok: true });
    expect(await order(h, d.id)).toEqual([a]);
    expect(editLogCount(h, c1, 'delete')).toBe(1);
    expect(editLogCount(h, c2, 'delete')).toBe(1);
    expect((await post(h, '/api/items/delete', { ids: ['nope'] })).status).toBe(200);

    expect((await post(h, '/api/items/restore', { ids: [c1, c2] })).body).toEqual({ ok: true });
    expect(await order(h, d.id)).toEqual([a, c1, c2]);
  });

  it('move：先摘掉再插入，跨卡片集带着状态走', async () => {
    const h = await harness();
    const d1 = await newDeck(h, '集一');
    const d2 = await newDeck(h, '集二');
    const a = await addSection(h, d1.id, { title: 'A' });
    const c1 = await addCard(h, d1.id);
    const c2 = await addCard(h, d1.id);
    const c3 = await addCard(h, d1.id);
    saveState(h.ctx.db, c3, stateOf(T + DAY));

    expect((await post(h, '/api/items/move', { ids: [c3, c1], afterId: a })).body).toEqual({ ok: true });
    expect(await order(h, d1.id)).toEqual([a, c3, c1, c2]);

    expect((await post(h, '/api/items/move', { ids: [c2], afterId: null })).body).toEqual({ ok: true });
    expect(await order(h, d1.id)).toEqual([c2, a, c3, c1]);

    h.setNow(T + 5 * MIN);
    expect((await post(h, '/api/items/move', { ids: [c3], deckId: d2.id })).body).toEqual({ ok: true });
    expect((await order(h, d1.id)).includes(c3)).toBe(false);
    expect(await order(h, d2.id)).toEqual([c3]);
    expect((await get<DeckSummary>(h, `/api/decks/${d1.id}`)).body.updatedAt).toBe(T + 5 * MIN);
    expect((await get<DeckSummary>(h, `/api/decks/${d2.id}`)).body.updatedAt).toBe(T + 5 * MIN);
    const inNew = await get<Json[]>(h, `/api/decks/${d2.id}/items`);
    expect(inNew.body[0].state).not.toBe(null);
    expect(countRows(h, 'SELECT COUNT(*) AS c FROM card_states WHERE card_id = ?', c3)).toBe(1);

    // afterId 不在目标卡片集里 → 放末尾
    await post(h, '/api/items/move', { ids: [c2], deckId: d2.id, afterId: c1 });
    expect(await order(h, d2.id)).toEqual([c3, c2]);
  });

  it('duplicate 一张卡：紧跟原卡、内容相同、没有状态', async () => {
    const h = await harness();
    const d = await newDeck(h);
    const c1 = await addCard(h, d.id, { cardType: 'qa', front: '问', hint: '提示', back: '答', color: 'blue' });
    const c2 = await addCard(h, d.id);
    saveState(h.ctx.db, c1, stateOf(T + DAY));

    const dup = await post<Json>(h, `/api/items/${c1}/duplicate`);
    expect(dup.status).toBe(200);
    expect(await order(h, d.id)).toEqual([c1, dup.body.id, c2]);
    expect(dup.body.state).toBe(null);
    for (const k of ['cardType', 'front', 'hint', 'back', 'color']) {
      expect(dup.body[k]).toBe((await get<Json[]>(h, `/api/decks/${d.id}/items`)).body
        .find((i) => i.id === c1)?.[k]);
    }
    expect((await post(h, '/api/items/nope/duplicate')).status).toBe(404);
  });
});

describe('位置间隔', () => {
  it('反复插到同一位置后仍保持顺序', async () => {
    const { app } = await buildApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-gap-')), memory: true });
    const deck = (await app.inject({ method: 'POST', url: '/api/decks', payload: {} })).json() as { id: string };
    const first = (await app.inject({ method: 'POST', url: '/api/items', payload: { deckId: deck.id, kind: 'card', front: 'first' } })).json() as { id: string };
    await app.inject({ method: 'POST', url: '/api/items', payload: { deckId: deck.id, kind: 'card', front: 'last' } });
    const fronts = ['first'];
    for (let i = 0; i < 80; i++) {
      await app.inject({ method: 'POST', url: '/api/items', payload: { deckId: deck.id, kind: 'card', front: `n${i}`, afterId: first.id } });
    }
    for (let i = 79; i >= 0; i--) fronts.push(`n${i}`);
    fronts.push('last');
    const items = (await app.inject({ method: 'GET', url: `/api/decks/${deck.id}/items` })).json() as { front: string }[];
    expect(items.map((x) => x.front)).toEqual(fronts);
  });
});
