// 学习接口测试（contracts.md §3.4）。不依赖 /api/decks、/api/items，直接用 ctx.db 插行。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, type Ctx } from '../app';
import { putSettings } from '../settings';
import { rowToState, saveState } from '../mappers';
import { newCardState, type CardState, type QueueEntry } from '@bnki/shared';

const DAY = 86_400_000;
const DECK = 'd1';

interface SessionResp {
  label: string;
  queue: QueueEntry[];
  cards: { id: string }[];
}

async function setup(): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-'));
  const clock = new Date(2026, 9, 22, 15, 30).getTime();
  const { app, ctx } = await buildApp({ dataDir: dir, memory: true, now: () => clock });
  // 关掉随机抖动，文字断言才稳定
  putSettings(ctx.db, { fuzz: false });
  ctx.db.prepare('INSERT INTO decks (id, title, created_at, updated_at, study_cfg) VALUES (?, ?, ?, ?, ?)')
    .run(DECK, '测试卡片集', clock, clock, '{}');
  insSection(ctx, 'sA', 1, 1);
  insCard(ctx, 'c1', 2, 'note', 'default');
  insCard(ctx, 'c2', 3, 'note', 'default');
  insSection(ctx, 'sB', 4, 1);
  insCard(ctx, 'c3', 5, 'qa', 'default');
  insCard(ctx, 'c4', 6, 'note', 'red');
  return { app, ctx };
}

function insSection(ctx: Ctx, id: string, pos: number, level: number): void {
  const now = ctx.now();
  ctx.db.prepare('INSERT INTO items (id, deck_id, kind, position, level, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, DECK, 'section', pos, level, `目录 ${id}`, now, now);
}

function insCard(ctx: Ctx, id: string, pos: number, cardType: string, color: string): void {
  const now = ctx.now();
  ctx.db.prepare('INSERT INTO items (id, deck_id, kind, position, card_type, front, hint, back, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, DECK, 'card', pos, cardType, '正面', '', cardType === 'qa' ? '背面' : '', color, now, now);
}

function setCfg(ctx: Ctx, cfg: unknown): void {
  ctx.db.prepare('UPDATE decks SET study_cfg = ? WHERE id = ?').run(JSON.stringify(cfg), DECK);
}

function setState(ctx: Ctx, id: string, st: Partial<CardState>): void {
  saveState(ctx.db, id, { ...newCardState(), stability: 5, difficulty: 5, ...st });
}

async function session(app: FastifyInstance, payload: object = {}): Promise<SessionResp> {
  const res = await app.inject({ method: 'POST', url: `/api/study/${DECK}/session`, payload });
  expect(res.statusCode).toBe(200);
  return res.json() as unknown as SessionResp;
}

const q = (s: SessionResp): string[] => s.queue.map((e) => e.cardId);

describe('study 接口', () => {
  it('全是新卡：默认推荐队列按卡片集顺序', async () => {
    const { app } = await setup();
    const s = await session(app);
    expect(s.label).toBe('系统推荐');
    expect(q(s)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(s.cards).toHaveLength(4);
    expect(s.queue.every((e) => !e.rep)).toBe(true);
    await app.close();
  });

  it('按目录和颜色筛选', async () => {
    const { app, ctx } = await setup();
    setCfg(ctx, { sections: ['sB'] });
    expect(q(await session(app))).toEqual(['c3', 'c4']);
    setCfg(ctx, { colors: ['red'] });
    expect(q(await session(app))).toEqual(['c4']);
    await app.close();
  });

  it('每日新学上限要扣掉今天已学', async () => {
    const { app, ctx } = await setup();
    setCfg(ctx, { plan: { newPerDay: 2 } });
    expect(q(await session(app))).toEqual(['c1', 'c2']);
    const rev = await app.inject({ method: 'POST', url: '/api/study/review', payload: { cardId: 'c1', rating: 3 } });
    expect(rev.statusCode).toBe(200);
    expect(q(await session(app))).toEqual(['c2']);
    await app.close();
  });

  it('内容四选一：推荐 / 仅复习 / 仅未学 / 全部', async () => {
    const { app, ctx } = await setup();
    const now = ctx.now();
    setState(ctx, 'c1', { state: 2, due: now - DAY, scheduledDays: 3, lastReview: now - 4 * DAY });
    setState(ctx, 'c2', { state: 2, due: now + 10 * DAY, scheduledDays: 10, lastReview: now - 2 * DAY });
    expect(q(await session(app))).toEqual(['c1', 'c3', 'c4']);
    expect(q(await session(app, { content: 'review' }))).toEqual(['c1']);
    expect(q(await session(app, { content: 'new' }))).toEqual(['c3', 'c4']);
    expect(q(await session(app, { content: 'all' }))).toEqual(['c1', 'c2', 'c3', 'c4']);
    await app.close();
  });

  it('到期优先时 due 早的在前', async () => {
    const { app, ctx } = await setup();
    const now = ctx.now();
    setState(ctx, 'c1', { state: 2, due: now - 10 * DAY, scheduledDays: 10, lastReview: now - 10 * DAY });
    setState(ctx, 'c2', { state: 2, due: now - 3_600_000, scheduledDays: 2, lastReview: now - 2 * DAY });
    setCfg(ctx, { order: 'due_first' });
    const s = await session(app);
    expect(q(s).slice(0, 2)).toEqual(['c1', 'c2']);
    await app.close();
  });

  it('答案优先只翻问答卡', async () => {
    const { app, ctx } = await setup();
    setCfg(ctx, { direction: 'back' });
    const s = await session(app);
    const flipped = new Map(s.queue.map((e) => [e.cardId, e.flipped]));
    expect(flipped.get('c3')).toBe(true);
    expect([flipped.get('c1'), flipped.get('c2'), flipped.get('c4')].every((v) => !v)).toBe(true);
    await app.close();
  });

  it('已掌握的卡不出现在任何队列', async () => {
    const { app, ctx } = await setup();
    setState(ctx, 'c3', { state: 2, due: ctx.now() - DAY, mastered: true });
    for (const content of ['recommend', 'new', 'review', 'all']) {
      const s = await session(app, content === 'recommend' ? {} : { content });
      expect(q(s), content).not.toContain('c3');
      expect(s.cards.map((c) => c.id), content).not.toContain('c3');
    }
    await app.close();
  });

  it('评"记住了"：写状态、写日志、刷新 studied_at', async () => {
    const { app, ctx } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/study/review', payload: { cardId: 'c1', rating: 3 } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { state: CardState; label: string; requeue: boolean };
    expect(body.state.state).toBe(2);
    expect(body.state.due).toBeGreaterThan(ctx.now());
    expect(body.label).toBe('3天');
    expect(body.requeue).toBe(false);
    const st = ctx.db.prepare('SELECT COUNT(*) AS c FROM card_states WHERE card_id = ?').get('c1') as { c: number };
    expect(st.c).toBe(1);
    const logs = ctx.db.prepare("SELECT rating, state FROM review_logs WHERE kind = 'grade'").all() as
      { rating: number; state: number }[];
    expect(logs).toHaveLength(1);
    expect(logs[0].rating).toBe(3);
    expect(logs[0].state).toBe(0);
    const deck = ctx.db.prepare('SELECT studied_at FROM decks WHERE id = ?').get(DECK) as { studied_at: number };
    expect(deck.studied_at).toBe(ctx.now());
    await app.close();
  });

  it('评"忘记了"要本轮再练', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/study/review', payload: { cardId: 'c1', rating: 1 } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { label: string; requeue: boolean };
    expect(body.requeue).toBe(true);
    expect(body.label.startsWith('本轮再练·')).toBe(true);
    await app.close();
  });

  it('practice 只记日志、不改状态', async () => {
    const { app, ctx } = await setup();
    await app.inject({ method: 'POST', url: '/api/study/review', payload: { cardId: 'c1', rating: 3 } });
    const row = ctx.db.prepare('SELECT * FROM card_states WHERE card_id = ?').get('c1') as Record<string, unknown>;
    const before = rowToState(row);
    const res = await app.inject({ method: 'POST', url: '/api/study/review', payload: { cardId: 'c1', rating: 1, practice: true } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { state: CardState | null; label: string; requeue: boolean };
    expect(body.state).toEqual(before);
    expect(body.label).toBe('');
    expect(body.requeue).toBe(false);
    const n = ctx.db.prepare("SELECT COUNT(*) AS c FROM review_logs WHERE kind = 'practice'").get() as { c: number };
    expect(n.c).toBe(1);
    await app.close();
  });

  it('非法评分 400，不存在的卡片 404', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/study/review', payload: { cardId: 'c1', rating: 5 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/study/review', payload: { cardId: 'nope', rating: 3 } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/study/nosuch/session', payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/study/${DECK}/session`, payload: { content: 'bogus' } })).statusCode).toBe(400);
    await app.close();
  });

  it('手动：due / master / unmaster / forget', async () => {
    const { app, ctx } = await setup();
    const due = ctx.now() + 7 * DAY;
    let res = await app.inject({ method: 'POST', url: '/api/study/manual', payload: { cardId: 'c1', action: 'due', due } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { state: CardState }).state.due).toBe(due);
    res = await app.inject({ method: 'POST', url: '/api/study/manual', payload: { cardId: 'c1', action: 'master' } });
    expect((res.json() as { state: CardState }).state.mastered).toBe(true);
    res = await app.inject({ method: 'POST', url: '/api/study/manual', payload: { cardId: 'c1', action: 'unmaster' } });
    expect((res.json() as { state: CardState }).state.mastered).toBe(false);
    res = await app.inject({ method: 'POST', url: '/api/study/manual', payload: { cardId: 'c1', action: 'forget' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBeNull();
    const st = ctx.db.prepare('SELECT COUNT(*) AS c FROM card_states WHERE card_id = ?').get('c1') as { c: number };
    expect(st.c).toBe(0);
    const n = ctx.db.prepare("SELECT COUNT(*) AS c FROM review_logs WHERE kind = 'reset' AND card_id = ?").get('c1') as { c: number };
    expect(n.c).toBe(1);
    await app.close();
  });

  it('间隔预测：3 个键，打开很简单按钮后 4 个', async () => {
    const { app, ctx } = await setup();
    let res = await app.inject({ method: 'GET', url: '/api/study/preview/c1' });
    expect(res.statusCode).toBe(200);
    let p = res.json().previews as Record<string, string>;
    expect(Object.keys(p).sort()).toEqual(['1', '2', '3']);
    expect(p['3']).toBe('3天');
    putSettings(ctx.db, { easyButton: true });
    res = await app.inject({ method: 'GET', url: '/api/study/preview/c1' });
    p = res.json().previews as Record<string, string>;
    expect(Object.keys(p)).toHaveLength(4);
    await app.close();
  });
});
