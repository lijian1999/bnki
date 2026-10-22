// 统计接口（contracts.md §3.5）。日期一律按学习日（dayStart 换日）换算成 'YYYY-MM-DD'。
import type { FastifyInstance } from 'fastify';
import { dayStart } from '@bnki/shared';
import type { Ctx } from '../app';
import { getSettings } from '../settings';
import { badRequest } from '../util';

/** 学习日加 n 天（用日期运算，避免跨夏令时漂移）。 */
function addDay(dayStartMs: number, dayHour: number, n: number): number {
  const d = new Date(dayStartMs);
  d.setDate(d.getDate() + n);
  d.setHours(dayHour, 0, 0, 0);
  return d.getTime();
}

/** 学习日起点 → 本地日期 key 'YYYY-MM-DD'。 */
function keyOf(dayStartMs: number): string {
  const d = new Date(dayStartMs);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default async function register(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/api/stats', async (req) => {
    const db = ctx.db;
    const now = ctx.now();
    const raw = (req.query as { range?: unknown }).range;
    let range = 7;
    if (raw !== undefined) {
      const n = typeof raw === 'string' ? Number(raw) : NaN;
      if (!Number.isInteger(n) || (n !== 7 && n !== 30 && n !== 90)) throw badRequest('range');
      range = n;
    }
    const settings = getSettings(db, ctx.dataDir);
    const dayHour = settings.dayHour;
    const today = dayStart(now, dayHour);

    // grade 日志按学习日分桶
    type Log = { card_id: string; state: number | null; rating: number | null; reviewed_at: number };
    const logs = db.prepare(`SELECT card_id, state, rating, reviewed_at FROM review_logs WHERE kind = 'grade'`)
      .all() as Log[];
    const byDay = new Map<number, { n: number; cards: Set<string> }>();
    const allCards = new Set<string>();
    for (const l of logs) {
      const ms = dayStart(l.reviewed_at, dayHour);
      let e = byDay.get(ms);
      if (!e) { e = { n: 0, cards: new Set() }; byDay.set(ms, e); }
      e.n++;
      e.cards.add(l.card_id);
      allCards.add(l.card_id);
    }
    const studied = (ms: number): boolean => (byDay.get(ms)?.n ?? 0) > 0;

    const todayCount = byDay.get(today)?.cards.size ?? 0;
    const total = allCards.size;

    // 连续学习天数：今天学过从今天起，否则从昨天起
    let t = studied(today) ? today : addDay(today, dayHour, -1);
    let streak = 0;
    while (studied(t)) { streak++; t = addDay(t, dayHour, -1); }

    // 最长连续记录：近 400 个学习日
    let bestDays = 0;
    let bestStart: string | null = null;
    let bestEnd: string | null = null;
    let run = 0;
    let runStart = 0;
    for (let i = 399; i >= 0; i--) {
      const ms = addDay(today, dayHour, -i);
      if (studied(ms)) {
        if (run === 0) runStart = ms;
        run++;
        if (run > bestDays) { bestDays = run; bestStart = keyOf(runStart); bestEnd = keyOf(ms); }
      } else {
        run = 0;
      }
    }

    // 本月（自然月，按学习日归属）学习天数
    const nowD = new Date(now);
    const monthSet = new Set<string>();
    for (const ms of byDay.keys()) {
      const d = new Date(ms);
      if (d.getFullYear() === nowD.getFullYear() && d.getMonth() === nowD.getMonth()) monthSet.add(keyOf(ms));
    }

    // 日历（近 400 个学习日，只含次数 > 0 的天）
    const calendar: Record<string, number> = {};
    for (const [ms, e] of byDay) {
      if (ms >= addDay(today, dayHour, -399) && e.n > 0) calendar[keyOf(ms)] = e.n;
    }

    // 最近 range 天的学习/编辑曲线
    const editByDay = new Map<number, number>();
    for (const r of db.prepare('SELECT at FROM edit_logs').all() as { at: number }[]) {
      const ms = dayStart(r.at, dayHour);
      editByDay.set(ms, (editByDay.get(ms) ?? 0) + 1);
    }
    const series: { date: string; reviews: number; edits: number }[] = [];
    for (let i = range - 1; i >= 0; i--) {
      const ms = addDay(today, dayHour, -i);
      series.push({ date: keyOf(ms), reviews: byDay.get(ms)?.n ?? 0, edits: editByDay.get(ms) ?? 0 });
    }

    // 未来 30 天到期预测：第 0 天含所有逾期
    const dueRows = db.prepare(`
      SELECT s.due AS due FROM card_states s
      JOIN items i ON i.id = s.card_id AND i.kind = 'card' AND i.deleted_at IS NULL
      JOIN decks d ON d.id = i.deck_id AND d.deleted_at IS NULL
      WHERE s.mastered = 0 AND s.state > 0 AND s.due IS NOT NULL`).all() as { due: number }[];
    const forecast: { date: string; count: number }[] = [];
    const starts: number[] = [];
    for (let i = 0; i <= 30; i++) starts.push(addDay(today, dayHour, i));
    const counts = new Array<number>(30).fill(0);
    for (const r of dueRows) {
      for (let i = 0; i < 30; i++) {
        if (r.due < starts[i + 1]) { counts[i]++; break; }
      }
    }
    for (let i = 0; i < 30; i++) forecast.push({ date: keyOf(starts[i]), count: counts[i] });

    // 记忆保持率：近 30 天、评分前为复习状态的 grade 日志里 rating >= 2 的占比
    const cutoff = now - 30 * 86_400_000;
    let good = 0;
    let samples = 0;
    for (const l of logs) {
      if (l.reviewed_at >= cutoff && l.state === 2) {
        samples++;
        if ((l.rating ?? 0) >= 2) good++;
      }
    }
    const retention = { actual: samples ? good / samples : null, target: settings.retention, samples };

    const deckCount = (db.prepare('SELECT COUNT(*) AS c FROM decks WHERE deleted_at IS NULL')
      .get() as { c: number }).c;
    const cardCount = (db.prepare(`
      SELECT COUNT(*) AS c FROM items i JOIN decks d ON d.id = i.deck_id
      WHERE i.kind = 'card' AND i.deleted_at IS NULL AND d.deleted_at IS NULL`).get() as { c: number }).c;

    return {
      today: todayCount,
      total,
      deckCount,
      cardCount,
      streak,
      best: { days: bestDays, start: bestStart, end: bestEnd },
      monthDays: monthSet.size,
      calendar,
      series,
      forecast,
      retention,
    };
  });
}
