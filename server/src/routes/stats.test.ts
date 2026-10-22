// 统计接口测试（contracts.md §3.5）。直接往日志和 items/card_states 插行。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, type Ctx } from '../app';
import { saveState } from '../mappers';
import { dayStart, newCardState } from '@bnki/shared';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const TODAY = '2026-10-22';
const YDAY = '2026-10-21';

async function setup(): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-'));
  const clock = new Date(2026, 9, 22, 15, 30).getTime();
  const { app, ctx } = await buildApp({ dataDir: dir, memory: true, now: () => clock });
  ctx.db.prepare('INSERT INTO decks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run('d1', '测试卡片集', clock, clock);
  return { app, ctx };
}

/** 第 n 个学习日内的一次时间戳（n=0 今天，往前数），默认上午 10 点，肯定落在当天。 */
function when(ctx: Ctx, n: number, hour = 10): number {
  const d = new Date(ctx.now());
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

function keyOf(ctx: Ctx, n: number): string {
  const d = new Date(dayStart(when(ctx, n), 4));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function grade(ctx: Ctx, cardId: string, at: number, rating = 3, state = 0): void {
  ctx.db.prepare('INSERT INTO review_logs (card_id, deck_id, kind, rating, state, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(cardId, 'd1', 'grade', rating, state, at);
}

function addCard(ctx: Ctx, id: string, pos: number): void {
  const now = ctx.now();
  ctx.db.prepare('INSERT INTO items (id, deck_id, kind, position, card_type, front, hint, back, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, 'd1', 'card', pos, 'note', 'f', '', '', 'default', now, now);
}

function setDue(ctx: Ctx, id: string, due: number): void {
  saveState(ctx.db, id, { ...newCardState(), state: 2, due, stability: 5, difficulty: 5, scheduledDays: 7, lastReview: ctx.now() - DAY });
}

interface StatsResp {
  today: number;
  total: number;
  deckCount: number;
  cardCount: number;
  streak: number;
  best: { days: number; start: string | null; end: string | null };
  monthDays: number;
  calendar: Record<string, number>;
  series: { date: string; reviews: number; edits: number }[];
  forecast: { date: string; count: number }[];
  retention: { actual: number | null; target: number; samples: number };
}

async function stats(app: FastifyInstance, query = ''): Promise<StatsResp> {
  const res = await app.inject({ method: 'GET', url: `/api/stats${query}` });
  expect(res.statusCode).toBe(200);
  return res.json() as StatsResp;
}

describe('stats 接口', () => {
  it('空库：全 0，series 7 项，forecast 30 项', async () => {
    const { app } = await setup();
    const s = await stats(app);
    expect(s.today).toBe(0);
    expect(s.total).toBe(0);
    expect(s.streak).toBe(0);
    expect(s.best.days).toBe(0);
    expect(s.best.start).toBeNull();
    expect(s.best.end).toBeNull();
    expect(s.series).toHaveLength(7);
    expect(s.series.every((p) => p.reviews === 0 && p.edits === 0)).toBe(true);
    expect(s.forecast).toHaveLength(30);
    expect(s.retention.actual).toBeNull();
    expect(s.retention.target).toBe(0.9);
    await app.close();
  });

  it('streak 3 天、best 5 天、日历有今天', async () => {
    const { app, ctx } = await setup();
    for (const n of [0, 1, 2, 4, 5, 6, 7, 8]) grade(ctx, 'x', when(ctx, n));
    const s = await stats(app);
    expect(s.streak).toBe(3);
    expect(s.best.days).toBe(5);
    expect(s.best.start).toBe(keyOf(ctx, 8));
    expect(s.best.end).toBe(keyOf(ctx, 4));
    expect(s.calendar[TODAY]).toBe(1);
    await app.close();
  });

  it('今天没学则从今天往前数昨天起算', async () => {
    const { app, ctx } = await setup();
    grade(ctx, 'x', when(ctx, 1));
    grade(ctx, 'y', when(ctx, 2));
    const s = await stats(app);
    expect(s.streak).toBe(2);
    await app.close();
  });

  it('today 是评分卡片去重数', async () => {
    const { app, ctx } = await setup();
    grade(ctx, 'x', when(ctx, 0));
    grade(ctx, 'x', when(ctx, 0) + HOUR);
    grade(ctx, 'y', when(ctx, 0));
    const s = await stats(app);
    expect(s.today).toBe(2);
    expect(s.calendar[TODAY]).toBe(3);
    await app.close();
  });

  it('凌晨 3 点算前一天的学习日', async () => {
    const { app, ctx } = await setup();
    grade(ctx, 'x', new Date(2026, 9, 22, 3, 0).getTime());
    const s = await stats(app);
    expect(s.today).toBe(0);
    expect(s.calendar[YDAY]).toBe(1);
    expect(s.streak).toBe(1);
    await app.close();
  });

  it('range=30 的 series 到今天，编辑数计入', async () => {
    const { app, ctx } = await setup();
    ctx.db.prepare('INSERT INTO edit_logs (card_id, action, at) VALUES (?, ?, ?)').run('x', 'create', when(ctx, 0));
    ctx.db.prepare('INSERT INTO edit_logs (card_id, action, at) VALUES (?, ?, ?)').run('y', 'create', when(ctx, 0));
    ctx.db.prepare('INSERT INTO edit_logs (card_id, action, at) VALUES (?, ?, ?)').run('z', 'create', when(ctx, 0));
    const s = await stats(app, '?range=30');
    expect(s.series).toHaveLength(30);
    expect(s.series[29].date).toBe(TODAY);
    expect(s.series[29].edits).toBe(3);
    expect(s.series[0].date).toBe(keyOf(ctx, 29));
    await app.close();
  });

  it('retention：只算评分前为复习状态的日志', async () => {
    const { app, ctx } = await setup();
    grade(ctx, 'x', ctx.now() - 1 * DAY, 1, 2);
    grade(ctx, 'x', ctx.now() - 2 * DAY, 2, 2);
    grade(ctx, 'x', ctx.now() - 3 * DAY, 3, 2);
    grade(ctx, 'x', ctx.now() - 4 * DAY, 3, 2);
    grade(ctx, 'x', ctx.now() - 5 * DAY, 4, 0);
    const s = await stats(app);
    expect(s.retention.actual).toBeCloseTo(0.75, 10);
    expect(s.retention.samples).toBe(4);
    await app.close();
  });

  it('forecast：今天含逾期，之后按学习日分桶', async () => {
    const { app, ctx } = await setup();
    addCard(ctx, 'k1', 1);
    addCard(ctx, 'k2', 2);
    addCard(ctx, 'k3', 3);
    setDue(ctx, 'k1', ctx.now() - DAY); // 昨天下午，逾期
    setDue(ctx, 'k2', when(ctx, 0, 13)); // 今天下午
    setDue(ctx, 'k3', when(ctx, -3, 10)); // 3 个学习日之后
    const s = await stats(app);
    expect(s.forecast[0].count).toBe(2);
    expect(s.forecast[0].date).toBe(TODAY);
    expect(s.forecast[3].count).toBe(1);
    expect(s.forecast[3].date).toBe(keyOf(ctx, -3));
    await app.close();
  });

  it('range 非 7/30/90 返回 400', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/stats?range=8' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
