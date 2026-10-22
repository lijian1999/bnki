// 学习接口（contracts.md §3.4）：生成队列、评分、手动调整、间隔预测。
// 调度一律委托 @bnki/shared 的 scheduler；这里只做数据读写和队列规则。
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CONTENT_NAMES,
  dayStart,
  isNew,
  isDue,
  manualDue,
  newCardState,
  previews,
  resolveStudyCfg,
  schedule,
  schedCfgFor,
  type CardColor,
  type CardItem,
  type CardState,
  type Deck,
  type QueueEntry,
  type Rating,
  type StudyContent,
} from '@bnki/shared';
import type { Ctx } from '../app';
import { getSettings } from '../settings';
import { badRequest, notFound } from '../util';
import { ITEM_COLUMNS, rowToDeck, rowToItem } from '../mappers';
import { saveState } from '../mappers';

const CONTENTS = ['recommend', 'new', 'review', 'all'] as const;
const ACTIONS = ['due', 'master', 'unmaster', 'forget'] as const;

type Body = Record<string, unknown>;

interface CardRef {
  item: CardItem;
  deck: Deck;
}

/** 取未删除的卡片及其卡片集（卡片集也必须未删除），否则 404。 */
function findCard(db: import('../db').DB, cardId: unknown): CardRef {
  const row = db.prepare(
    `SELECT ${ITEM_COLUMNS} FROM items i LEFT JOIN card_states s ON s.card_id = i.id
      WHERE i.id = ? AND i.kind = 'card' AND i.deleted_at IS NULL`,
  ).get(cardId as string) as Record<string, unknown> | undefined;
  if (!row) throw notFound('card');
  const deck = findDeck(db, row.deck_id);
  const item = rowToItem(row);
  if (item.kind !== 'card') throw notFound('card');
  return { item, deck };
}

function findDeck(db: import('../db').DB, deckId: unknown): Deck {
  const row = db.prepare('SELECT * FROM decks WHERE id = ? AND deleted_at IS NULL').get(deckId as string) as
    | Record<string, unknown> | undefined;
  if (!row) throw notFound('deck');
  return rowToDeck(row);
}

/** 卡片集未删除的 items（含状态），按 position 升序。 */
function deckItems(db: import('../db').DB, deckId: string) {
  const rows = db.prepare(
    `SELECT ${ITEM_COLUMNS} FROM items i LEFT JOIN card_states s ON s.card_id = i.id
      WHERE i.deck_id = ? AND i.deleted_at IS NULL ORDER BY i.position`,
  ).all(deckId) as Record<string, unknown>[];
  return rows.map(rowToItem);
}

/** 每张卡片所在目录的路径（栈式扫描，contracts §3.4.1 第 1 步）。 */
function sectionPaths(items: ReturnType<typeof rowToItem>[]): Map<string, string[]> {
  const stack: { id: string; level: number }[] = [];
  const out = new Map<string, string[]>();
  for (const it of items) {
    if (it.kind === 'section') {
      while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
      stack.push({ id: it.id, level: it.level });
    } else {
      out.set(it.id, stack.map((s) => s.id));
    }
  }
  return out;
}

function touchStudied(db: import('../db').DB, deckId: string, now: number): void {
  db.prepare('UPDATE decks SET studied_at = ? WHERE id = ?').run(now, deckId);
}

function logReview(db: import('../db').DB, f: {
  cardId: string; deckId: string; kind: string; rating: number | null; state: number | null;
  due: number | null; stability: number | null; difficulty: number | null;
  elapsedDays: number | null; scheduledDays: number | null; reviewedAt: number; durationMs: number | null;
}): void {
  db.prepare(`INSERT INTO review_logs (card_id, deck_id, kind, rating, state, due, stability, difficulty,
      elapsed_days, scheduled_days, reviewed_at, duration_ms)
    VALUES (@cardId, @deckId, @kind, @rating, @state, @due, @stability, @difficulty,
      @elapsedDays, @scheduledDays, @reviewedAt, @durationMs)`)
    .run({ ...f });
}

export default async function register(app: FastifyInstance, ctx: Ctx): Promise<void> {
  // 生成一轮学习队列
  app.post('/api/study/:deckId/session', async (req) => {
    const db = ctx.db;
    const now = ctx.now();
    const deck = findDeck(db, (req.params as { deckId: string }).deckId);
    const body: Body = (req.body ?? {}) as Body;
    if (body.content !== undefined && !CONTENTS.includes(body.content as StudyContent)) {
      throw badRequest('content');
    }
    const settings = getSettings(db, ctx.dataDir);
    const cfg = resolveStudyCfg(deck.studyCfg, settings);
    const content = (body.content ?? cfg.content) as StudyContent;
    const sc = schedCfgFor(settings, cfg);

    const items = deckItems(db, deck.id);
    const paths = sectionPaths(items);
    let filtered = items.filter((it): it is CardItem => it.kind === 'card');
    if (cfg.sections.length) {
      const wanted = new Set(cfg.sections);
      filtered = filtered.filter((c) => (paths.get(c.id) ?? []).some((p) => wanted.has(p)));
    }
    if (cfg.colors.length) {
      const wanted = new Set<CardColor>(cfg.colors);
      filtered = filtered.filter((c) => wanted.has(c.color));
    }

    // 今天学习日已学数量（按卡去重；评分前 state=0 算新学）
    const today = dayStart(now, settings.dayHour);
    const logs = db.prepare(
      `SELECT card_id, state FROM review_logs WHERE deck_id = ? AND kind = 'grade' AND reviewed_at >= ?`,
    ).all(deck.id, today) as { card_id: string; state: number }[];
    const newStudied = new Set<string>();
    const revStudied = new Set<string>();
    for (const l of logs) (l.state === 0 ? newStudied : revStudied).add(l.card_id);
    const freshLeft = Math.max(0, cfg.plan.newPerDay - newStudied.size);
    const dueLeft = Math.max(0, cfg.plan.reviewPerDay - [...revStudied].filter((id) => !newStudied.has(id)).length);

    const dueList = filtered.filter((c) => isDue(c.state, sc, now));
    if (cfg.order === 'due_first') dueList.sort((a, b) => (a.state?.due ?? 0) - (b.state?.due ?? 0));
    const dueTake = dueList.slice(0, dueLeft);
    const freshTake = filtered.filter((c) => isNew(c.state)).slice(0, freshLeft);

    let queue: CardItem[];
    switch (content) {
      case 'new': queue = freshTake; break;
      case 'review': queue = dueTake; break;
      case 'all': queue = filtered.filter((c) => !c.state?.mastered); break;
      default: queue = [...dueTake, ...freshTake];
    }
    if (cfg.order === 'random') {
      queue = [...queue];
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
    }

    const entries: QueueEntry[] = queue.map((c) => ({
      cardId: c.id,
      rep: false,
      flipped: c.cardType === 'qa' && (cfg.direction === 'back' || (cfg.direction === 'random' && Math.random() < 0.5)),
    }));
    const cards: CardItem[] = [];
    const seen = new Set<string>();
    for (const c of queue) {
      if (!seen.has(c.id)) { seen.add(c.id); cards.push(c); }
    }
    return { label: CONTENT_NAMES[content], queue: entries, cards };
  });

  // 评分 / 纯练习
  app.post('/api/study/review', async (req) => {
    const db = ctx.db;
    const now = ctx.now();
    const body: Body = (req.body ?? {}) as Body;
    const rating = body.rating;
    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 4) {
      throw badRequest('rating');
    }
    const { item, deck } = findCard(db, body.cardId);
    const settings = getSettings(db, ctx.dataDir);
    const sc = schedCfgFor(settings, resolveStudyCfg(deck.studyCfg, settings));
    const prev = item.state;
    const durationMs = typeof body.durationMs === 'number' ? body.durationMs : null;

    if (body.practice) {
      // 本轮重练的再出现不改变状态，只记练习日志
      logReview(db, {
        cardId: item.id, deckId: deck.id, kind: 'practice', rating,
        state: prev?.state ?? 0, due: prev?.due ?? null, stability: prev?.stability ?? 0,
        difficulty: prev?.difficulty ?? 0, elapsedDays: prev?.elapsedDays ?? 0, scheduledDays: prev?.scheduledDays ?? 0,
        reviewedAt: now, durationMs,
      });
      touchStudied(db, deck.id, now);
      return { state: prev, label: '', requeue: false };
    }

    const r = schedule(prev, rating as Rating, now, sc);
    saveState(db, item.id, { ...r.state, mastered: false });
    logReview(db, {
      cardId: item.id, deckId: deck.id, kind: 'grade', rating,
      state: prev?.state ?? 0, // 评分前的状态
      due: r.state.due, stability: r.state.stability, difficulty: r.state.difficulty,
      elapsedDays: r.state.elapsedDays, scheduledDays: r.state.scheduledDays,
      reviewedAt: now, durationMs,
    });
    touchStudied(db, deck.id, now);
    return { state: r.state, label: r.label, requeue: r.requeue };
  });

  // 手动调整
  app.post('/api/study/manual', async (req) => {
    const db = ctx.db;
    const now = ctx.now();
    const body: Body = (req.body ?? {}) as Body;
    const action = body.action;
    if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) throw badRequest('action');
    const due = body.due;
    let dueMs = 0;
    if (action === 'due') {
      if (typeof due !== 'number' || !Number.isFinite(due)) throw badRequest('due');
      dueMs = due;
    }
    const { item, deck } = findCard(db, body.cardId);
    const settings = getSettings(db, ctx.dataDir);
    const sc = schedCfgFor(settings, resolveStudyCfg(deck.studyCfg, settings));
    const prev = item.state;

    if (action === 'forget') {
      db.prepare('DELETE FROM card_states WHERE card_id = ?').run(item.id);
      logReview(db, {
        cardId: item.id, deckId: deck.id, kind: 'reset', rating: null, state: null, due: null,
        stability: null, difficulty: null, elapsedDays: null, scheduledDays: null, reviewedAt: now, durationMs: null,
      });
      return { state: null };
    }

    let out: CardState;
    let kind: string;
    if (action === 'due') {
      out = manualDue(prev, dueMs, now, sc);
      kind = 'manual';
    } else {
      out = { ...(prev ?? newCardState()), mastered: action === 'master' };
      kind = action === 'master' ? 'master' : 'unmaster';
    }
    saveState(db, item.id, out);
    logReview(db, {
      cardId: item.id, deckId: deck.id, kind, rating: null, state: out.state, due: out.due,
      stability: out.stability, difficulty: out.difficulty, elapsedDays: out.elapsedDays,
      scheduledDays: out.scheduledDays, reviewedAt: now, durationMs: null,
    });
    return { state: out };
  });

  // 间隔预测
  app.get('/api/study/preview/:cardId', async (req) => {
    const db = ctx.db;
    const now = ctx.now();
    const { item, deck } = findCard(db, (req.params as { cardId: string }).cardId);
    const settings = getSettings(db, ctx.dataDir);
    const sc = schedCfgFor(settings, resolveStudyCfg(deck.studyCfg, settings));
    return { previews: previews(item.state, now, sc, settings.easyButton ? 4 : 3) };
  });
}
