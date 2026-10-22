// 卡片集、分类、目录和卡片的 HTTP 接口（contracts §3.1–3.3）。
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CARD_COLORS, isDue, isNew, resolveStudyCfg, schedCfgFor,
  type CardState, type Deck, type DeckCounts, type DeckSort, type DeckSummary, type Settings,
} from '@bnki/shared';
import type { Ctx } from '../app';
import { getSettings } from '../settings';
import { ITEM_COLUMNS, rowToDeck, rowToFolder, rowToItem, rowToState } from '../mappers';
import { badRequest, newId, notFound } from '../util';

type Obj = Record<string, unknown>;
type FolderRow = { id: string; name: string; position: number; created_at: number };
type DeckRow = {
  id: string; title: string; description: string; folder_id: string | null; cover: string | null;
  pinned_at: number | null; created_at: number; updated_at: number; opened_at: number | null;
  studied_at: number | null; deleted_at: number | null; study_cfg: string; display_cfg: string;
};
type ItemRow = {
  id: string; deck_id: string; kind: string; position: number; level: number | null; title: string | null;
  collapsed: number | null; card_type: string | null; front: string | null; hint: string | null;
  back: string | null; color: string | null; created_at: number; updated_at: number; deleted_at: number | null;
};

const COLORS = new Set<string>(CARD_COLORS.map((c) => c.key));
const CARD_TYPES = new Set(['note', 'qa', 'topic']);
const SORTS = new Set<DeckSort>(
  ['name', 'updated', 'created', 'studied', 'next_due', 'card_count', 'fresh_count'] as DeckSort[],
);
const DEFAULT_TITLE = '无标题卡片集';
const SECTION_TITLE = '新目录';

const bodyOf = (req: FastifyRequest): Obj => (req.body ?? {}) as Obj;
const has = (b: Obj, key: string) => Object.prototype.hasOwnProperty.call(b, key);
const idOf = (req: FastifyRequest): string => (req.params as { id: string }).id;

function wantStr(b: Obj, key: string, what: string): string | undefined {
  const v = b[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw badRequest(`${what} 必须是字符串`);
  return v;
}

/** 必填字符串，去掉首尾空白后不能为空。 */
function wantTrimmed(b: Obj, key: string, what: string): string {
  const v = wantStr(b, key, what);
  if (v === undefined) throw badRequest(`${what} 不能为空`);
  const t = v.trim();
  if (!t) throw badRequest(`${what} 不能为空`);
  return t;
}

function wantLevel(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) throw badRequest('level 只能是 1–5');
  return v;
}

function wantCardType(v: unknown): string {
  const s = String(v ?? '');
  if (!CARD_TYPES.has(s)) throw badRequest('cardType 只能是 note | qa | topic');
  return s;
}

function wantColor(v: unknown): string {
  const s = String(v ?? '');
  if (!COLORS.has(s)) throw badRequest('color 不是合法颜色');
  return s;
}

function wantBool(v: unknown, what: string): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 0 || v === 1) return !!v;
  throw badRequest(`${what} 必须是布尔值`);
}

function wantIds(v: unknown): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw badRequest('ids 必须是 id 数组');
  return v as string[];
}

/** 写 edit_logs。 */
function logEdit(ctx: Ctx, cardId: string, action: string): void {
  ctx.db.prepare('INSERT INTO edit_logs (card_id, action, at) VALUES (?,?,?)').run(cardId, action, ctx.now());
}

function touchDeck(ctx: Ctx, deckId: string): void {
  ctx.db.prepare('UPDATE decks SET updated_at = ? WHERE id = ?').run(ctx.now(), deckId);
}

function getFolderRow(ctx: Ctx, id: string): FolderRow {
  const row = ctx.db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow | undefined;
  if (!row) throw notFound('分类不存在');
  return row;
}

/** 卡片集挂的分类：不存在时是客户端错误（400），不是 404。 */
function assertFolder(ctx: Ctx, id: unknown): string {
  if (typeof id !== 'string') throw badRequest('folderId 不对');
  if (!ctx.db.prepare('SELECT 1 AS x FROM folders WHERE id = ?').get(id)) throw badRequest('分类不存在');
  return id;
}

function getDeckRow(ctx: Ctx, id: string): DeckRow {
  const row = ctx.db.prepare('SELECT * FROM decks WHERE id = ?').get(id) as DeckRow | undefined;
  if (!row) throw notFound('卡片集不存在');
  return row;
}

function getItemRow(ctx: Ctx, id: string): ItemRow {
  const row = ctx.db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
  if (!row) throw notFound('条目不存在');
  return row;
}

/** 卡片集里未删除的条目（按 position 升序），只取定位需要的字段。 */
function visibleItems(ctx: Ctx, deckId: string): { id: string; position: number }[] {
  return ctx.db.prepare(
    'SELECT id, position FROM items WHERE deck_id = ? AND deleted_at IS NULL ORDER BY position',
  ).all(deckId) as { id: string; position: number }[];
}

/** 带学习状态的条目（contracts §2 的 LEFT JOIN）。 */
function itemOf(ctx: Ctx, id: string) {
  const row = ctx.db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items i LEFT JOIN card_states s ON s.card_id = i.id WHERE i.id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) throw notFound('条目不存在');
  return rowToItem(row);
}

function deckSummary(ctx: Ctx, row: DeckRow, settings: Settings): DeckSummary {
  const deck: Deck = rowToDeck(row);
  return { ...deck, counts: countsOf(ctx, deck, settings) };
}

/** 计数规则见 §3.2.1：每个卡片集用自己的复习模式算到期。 */
function countsOf(ctx: Ctx, deck: Deck, settings: Settings): DeckCounts {
  const sc = schedCfgFor(settings, resolveStudyCfg(deck.studyCfg, settings));
  const now = ctx.now();
  const rows = ctx.db.prepare(
    `SELECT s.state, s.due, s.mastered FROM items i LEFT JOIN card_states s ON s.card_id = i.id
     WHERE i.deck_id = ? AND i.kind = 'card' AND i.deleted_at IS NULL`,
  ).all(deck.id) as { state: number | null; due: number | null; mastered: number | null }[];
  let fresh = 0;
  let due = 0;
  let nextDue: number | null = null;
  for (const r of rows) {
    const st: CardState | null = rowToState(r);
    if (isNew(st)) fresh++;
    if (isDue(st, sc, now)) due++;
    if (st && !st.mastered && st.state > 0 && st.due != null && (nextDue === null || st.due < nextDue)) nextDue = st.due;
  }
  const total = rows.length;
  const learned = total - fresh;
  return { total, fresh, due, learned, pct: total ? Math.round((learned / total) * 100) : 0, nextDue };
}

const descNullLast = (a: number | null, b: number | null): number =>
  (a === b ? 0 : a === null ? 1 : b === null ? -1 : b - a);

const ascNullLast = (a: number | null, b: number | null): number =>
  (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b);

/** 置顶优先，其余按 sort；同值时按标题、id 保证顺序稳定。 */
function deckComparator(sort: DeckSort) {
  const tie = (a: DeckSummary, b: DeckSummary): number =>
    (a.title.localeCompare(b.title, 'zh-CN') || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1));
  return (a: DeckSummary, b: DeckSummary): number => {
    if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1;
    if (a.pinnedAt && b.pinnedAt && a.pinnedAt !== b.pinnedAt) return b.pinnedAt - a.pinnedAt;
    switch (sort) {
      case 'name': return a.title.localeCompare(b.title, 'zh-CN') || tie(a, b);
      case 'created': return descNullLast(a.createdAt, b.createdAt) || tie(a, b);
      case 'studied': return descNullLast(a.studiedAt, b.studiedAt) || tie(a, b);
      case 'next_due': return ascNullLast(a.counts.nextDue, b.counts.nextDue) || tie(a, b);
      case 'card_count': return descNullLast(a.counts.total, b.counts.total) || tie(a, b);
      case 'fresh_count': return descNullLast(a.counts.fresh, b.counts.fresh) || tie(a, b);
      default: return descNullLast(a.updatedAt, b.updatedAt) || tie(a, b);
    }
  };
}

function purgeDeck(ctx: Ctx, deckId: string): void {
  const del = ctx.db.prepare('DELETE FROM card_states WHERE card_id IN (SELECT id FROM items WHERE deck_id = ?)');
  const run = ctx.db.transaction(() => {
    del.run(deckId);
    ctx.db.prepare('DELETE FROM items WHERE deck_id = ?').run(deckId);
    ctx.db.prepare('DELETE FROM decks WHERE id = ?').run(deckId);
  });
  run();
}

/** 反复取中点会把间隔挤到浮点精度以下：相邻间隔太小时把整个卡片集（含已删除的项，恢复时位置不变）重排成整数。 */
function ensureGaps(ctx: Ctx, deckId: string): void {
  const all = ctx.db.prepare('SELECT id, position FROM items WHERE deck_id = ? ORDER BY position, id')
    .all(deckId) as { id: string; position: number }[];
  if (!all.some((r, i) => i > 0 && r.position - all[i - 1].position < 1e-6)) return;
  const upd = ctx.db.prepare('UPDATE items SET position = ? WHERE id = ?');
  ctx.db.transaction(() => all.forEach((r, i) => upd.run(i + 1, r.id)))();
}

/** POST /api/items 的位置规则（§3.3）：省略 = 末尾，null = 最前，否则紧跟 afterId。 */
function insertPosition(ctx: Ctx, deckId: string, b: Obj): number {
  ensureGaps(ctx, deckId);
  const list = visibleItems(ctx, deckId);
  if (!has(b, 'afterId')) return list.length ? list[list.length - 1].position + 1 : 1;
  const after = b.afterId;
  if (after === null || after === undefined) return list.length ? list[0].position - 1 : 1;
  if (typeof after !== 'string') throw badRequest('afterId 不对');
  const row = ctx.db.prepare('SELECT position, deck_id FROM items WHERE id = ?').get(after) as
    { position: number; deck_id: string } | undefined;
  if (!row || row.deck_id !== deckId) throw badRequest('afterId 不存在或不属于该卡片集');
  const next = list.find((x) => x.position > row.position);
  return next ? (row.position + next.position) / 2 : row.position + 1;
}

/** move 的位置规则（§3.3）：先摘掉要移动的项，再按序插到 afterId 之后。 */
function movePositions(ctx: Ctx, deckId: string, ids: string[], afterId: unknown): Map<string, number> {
  ensureGaps(ctx, deckId);
  const moved = new Set(ids);
  const rest = visibleItems(ctx, deckId).filter((r) => !moved.has(r.id));
  let prev: number | undefined;
  let next: number | undefined;
  if (afterId === null) {
    next = rest[0]?.position;
  } else if (typeof afterId === 'string') {
    const row = ctx.db.prepare('SELECT position, deck_id FROM items WHERE id = ?').get(afterId) as
      { position: number; deck_id: string } | undefined;
    if (!row || row.deck_id !== deckId) {
      prev = rest[rest.length - 1]?.position; // 不在目标卡片集里 → 末尾
    } else if (!moved.has(afterId)) {
      // 直接在 afterId 之后、它的下一项之前
      prev = row.position;
      next = rest.find((r) => r.position > row.position)?.position;
    } else {
      // afterId 自己也要被移动：按位置找它在剩余序列里的空位
      const before = rest.filter((r) => r.position < row.position);
      prev = before.length ? before[before.length - 1].position : undefined;
      next = rest.find((r) => r.position > row.position)?.position;
    }
  } else {
    prev = rest[rest.length - 1]?.position;
  }
  const n = ids.length;
  const out = new Map<string, number>();
  ids.forEach((id, i) => {
    let p: number;
    if (prev !== undefined && next !== undefined) p = prev + ((next - prev) * (i + 1)) / (n + 1);
    else if (prev !== undefined) p = prev + (i + 1);
    else if (next !== undefined) p = next - (n - i);
    else p = i + 1;
    out.set(id, p);
  });
  return out;
}

export default async function register(app: FastifyInstance, ctx: Ctx): Promise<void> {
  // ---------- 分类 ----------
  app.get('/api/folders', async () => {
    const rows = ctx.db.prepare('SELECT * FROM folders ORDER BY position, id').all() as FolderRow[];
    return rows.map(rowToFolder);
  });

  app.post('/api/folders', async (req) => {
    const name = wantTrimmed(bodyOf(req), 'name', 'name');
    const max = ctx.db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM folders').get() as { m: number };
    const row = { id: newId(), name, position: max.m + 1, created_at: ctx.now() };
    ctx.db.prepare('INSERT INTO folders (id, name, position, created_at) VALUES (?,?,?,?)')
      .run(row.id, row.name, row.position, row.created_at);
    return rowToFolder(row);
  });

  app.patch('/api/folders/:id', async (req) => {
    const row = getFolderRow(ctx, idOf(req));
    const b = bodyOf(req);
    const set: Obj = {};
    if (has(b, 'name')) set.name = wantTrimmed(b, 'name', 'name');
    if (has(b, 'position')) {
      const p = b.position;
      if (typeof p !== 'number' || !Number.isFinite(p)) throw badRequest('position 必须是数字');
      set.position = p;
    }
    if (Object.keys(set).length) {
      const cols = Object.keys(set);
      ctx.db.prepare(`UPDATE folders SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @__id`)
        .run({ ...set, __id: row.id });
    }
    return rowToFolder(getFolderRow(ctx, row.id));
  });

  app.delete('/api/folders/:id', async (req) => {
    const row = getFolderRow(ctx, idOf(req));
    const now = ctx.now();
    ctx.db.prepare('UPDATE decks SET deleted_at = ?, folder_id = NULL WHERE folder_id = ? AND deleted_at IS NULL')
      .run(now, row.id);
    ctx.db.prepare('UPDATE decks SET folder_id = NULL WHERE folder_id = ? AND deleted_at IS NOT NULL')
      .run(row.id);
    ctx.db.prepare('DELETE FROM folders WHERE id = ?').run(row.id);
    return { ok: true };
  });

  // ---------- 卡片集 ----------
  app.get('/api/decks', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const view = q.view === 'recent' || q.view === 'trash' ? q.view : 'all';
    const sort: DeckSort = SORTS.has((q.sort ?? '') as DeckSort) ? (q.sort as DeckSort) : 'updated';
    const where = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    if (view === 'trash') where.splice(0, 1, 'deleted_at IS NOT NULL');
    if (view === 'recent') where.push('opened_at IS NOT NULL');
    if (q.folder) { where.push('folder_id = ?'); params.push(q.folder); }
    const kw = (q.q ?? '').trim().toLowerCase();
    if (kw) { where.push('instr(lower(title), ?) > 0'); params.push(kw); }
    let sql = `SELECT * FROM decks WHERE ${where.join(' AND ')}`;
    if (view === 'recent') sql += ' ORDER BY opened_at DESC, id LIMIT 50';
    else if (view === 'trash') sql += ' ORDER BY deleted_at DESC, id';
    const rows = ctx.db.prepare(sql).all(...params) as DeckRow[];
    const settings = getSettings(ctx.db, ctx.dataDir);
    const list = rows.map((r) => deckSummary(ctx, r, settings));
    if (view === 'all') list.sort(deckComparator(sort));
    return list;
  });

  app.get('/api/decks/:id', async (req) => {
    const settings = getSettings(ctx.db, ctx.dataDir);
    return deckSummary(ctx, getDeckRow(ctx, idOf(req)), settings);
  });

  app.post('/api/decks', async (req) => {
    const b = bodyOf(req);
    let title = DEFAULT_TITLE;
    if (has(b, 'title')) {
      const raw = wantStr(b, 'title', 'title');
      title = (raw ?? '').trim();
      if (!title) throw badRequest('title 不能为空');
    }
    let folderId: string | null = null;
    if (has(b, 'folderId')) {
      if (b.folderId !== null) {
        folderId = assertFolder(ctx, b.folderId);
      }
    }
    const now = ctx.now();
    const row = {
      id: newId(), title, description: '', folder_id: folderId, cover: null, pinned_at: null,
      created_at: now, updated_at: now, opened_at: null, studied_at: null, deleted_at: null,
      study_cfg: '{}', display_cfg: '{}',
    };
    ctx.db.prepare(
      `INSERT INTO decks (id, title, description, folder_id, cover, pinned_at, created_at, updated_at,
        opened_at, studied_at, deleted_at, study_cfg, display_cfg)
       VALUES (@id, @title, @description, @folder_id, @cover, @pinned_at, @created_at, @updated_at,
        @opened_at, @studied_at, @deleted_at, @study_cfg, @display_cfg)`,
    ).run(row);
    return deckSummary(ctx, getDeckRow(ctx, row.id), getSettings(ctx.db, ctx.dataDir));
  });

  app.patch('/api/decks/:id', async (req) => {
    const row = getDeckRow(ctx, idOf(req));
    const deck = rowToDeck(row);
    const b = bodyOf(req);
    const set: Obj = {};
    let touch = false;
    if (has(b, 'title')) {
      const t = wantTrimmed(b, 'title', 'title');
      if (t !== deck.title) touch = true;
      set.title = t;
    }
    if (has(b, 'description')) {
      const d = wantStr(b, 'description', 'description') ?? '';
      if (d !== deck.description) touch = true;
      set.description = d;
    }
    if (has(b, 'cover')) {
      const c = b.cover === null ? null : wantStr(b, 'cover', 'cover');
      if (c !== undefined) {
        if (c !== deck.cover) touch = true;
        set.cover = c;
      }
    }
    if (has(b, 'folderId')) {
      set.folder_id = b.folderId === null ? null : assertFolder(ctx, b.folderId);
    }
    for (const key of ['studyCfg', 'displayCfg'] as const) {
      if (!has(b, key)) continue;
      const v = b[key];
      if (typeof v !== 'object' || v === null || Array.isArray(v)) throw badRequest(`${key} 必须是对象`);
      set[key === 'studyCfg' ? 'study_cfg' : 'display_cfg'] = JSON.stringify(v);
    }
    if (has(b, 'pinned')) set.pinned_at = wantBool(b.pinned, 'pinned') ? ctx.now() : null;
    if (touch) set.updated_at = ctx.now();
    const cols = Object.keys(set);
    if (cols.length) {
      ctx.db.prepare(`UPDATE decks SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @__id`)
        .run({ ...set, __id: row.id });
    }
    return deckSummary(ctx, getDeckRow(ctx, row.id), getSettings(ctx.db, ctx.dataDir));
  });

  app.post('/api/decks/:id/open', async (req) => {
    const row = getDeckRow(ctx, idOf(req));
    ctx.db.prepare('UPDATE decks SET opened_at = ? WHERE id = ?').run(ctx.now(), row.id);
    return { ok: true };
  });

  app.post('/api/decks/:id/forget-recent', async (req) => {
    const row = getDeckRow(ctx, idOf(req));
    ctx.db.prepare('UPDATE decks SET opened_at = NULL WHERE id = ?').run(row.id);
    return { ok: true };
  });

  app.delete('/api/decks/:id', async (req) => {
    const row = getDeckRow(ctx, idOf(req));
    ctx.db.prepare('UPDATE decks SET deleted_at = ? WHERE id = ?').run(ctx.now(), row.id);
    return { ok: true };
  });

  app.post('/api/decks/:id/restore', async (req) => {
    const row = getDeckRow(ctx, idOf(req));
    if (row.folder_id) {
      const hit = ctx.db.prepare('SELECT 1 AS x FROM folders WHERE id = ?').get(row.folder_id);
      if (!hit) ctx.db.prepare('UPDATE decks SET folder_id = NULL WHERE id = ?').run(row.id);
    }
    ctx.db.prepare('UPDATE decks SET deleted_at = NULL WHERE id = ?').run(row.id);
    return deckSummary(ctx, getDeckRow(ctx, row.id), getSettings(ctx.db, ctx.dataDir));
  });

  app.delete('/api/decks/:id/purge', async (req) => {
    const row = getDeckRow(ctx, idOf(req));
    purgeDeck(ctx, row.id);
    return { ok: true };
  });

  app.delete('/api/trash', async () => {
    const rows = ctx.db.prepare('SELECT id FROM decks WHERE deleted_at IS NOT NULL').all() as { id: string }[];
    for (const r of rows) purgeDeck(ctx, r.id);
    return { ok: true };
  });

  app.post('/api/decks/:id/duplicate', async (req) => {
    const row = getDeckRow(ctx, idOf(req));
    const now = ctx.now();
    const items = ctx.db
      .prepare('SELECT * FROM items WHERE deck_id = ? AND deleted_at IS NULL ORDER BY position')
      .all(row.id) as ItemRow[];
    const newIdOf = newId();
    const insertDeck = ctx.db.prepare(
      `INSERT INTO decks (id, title, description, folder_id, cover, pinned_at, created_at, updated_at,
        opened_at, studied_at, deleted_at, study_cfg, display_cfg)
       VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,?)`,
    );
    const insertItem = ctx.db.prepare(
      `INSERT INTO items (id, deck_id, kind, position, level, title, collapsed, card_type, front, hint, back,
        color, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const tx = ctx.db.transaction(() => {
      insertDeck.run(newIdOf, `${row.title} 副本`, row.description, row.folder_id, row.cover, null, now, now,
        row.study_cfg, row.display_cfg);
      for (const it of items) {
        insertItem.run(newId(), newIdOf, it.kind, it.position, it.level, it.title, it.collapsed, it.card_type,
          it.front, it.hint, it.back, it.color ?? 'default', now, now);
      }
    });
    tx();
    return deckSummary(ctx, getDeckRow(ctx, newIdOf), getSettings(ctx.db, ctx.dataDir));
  });

  app.post('/api/decks/:id/reset-progress', async (req) => {
    const row = getDeckRow(ctx, idOf(req));
    const now = ctx.now();
    const rows = ctx.db.prepare(
      `SELECT s.card_id, s.state, s.due, s.stability, s.difficulty, s.elapsed_days, s.scheduled_days
       FROM card_states s JOIN items i ON i.id = s.card_id WHERE i.deck_id = ?`,
    ).all(row.id) as {
      card_id: string; state: number; due: number | null; stability: number; difficulty: number;
      elapsed_days: number; scheduled_days: number;
    }[];
    const log = ctx.db.prepare(
      `INSERT INTO review_logs (card_id, deck_id, kind, rating, state, due, stability, difficulty,
        elapsed_days, scheduled_days, reviewed_at, duration_ms)
       VALUES (?,?, 'reset', NULL, ?, ?, NULL, NULL, NULL, NULL, ?, NULL)`,
    );
    const del = ctx.db.prepare('DELETE FROM card_states WHERE card_id = ?');
    const tx = ctx.db.transaction(() => {
      for (const r of rows) {
        log.run(r.card_id, row.id, r.state, r.due, now);
        del.run(r.card_id);
      }
    });
    tx();
    return { ok: true };
  });

  // ---------- 目录和卡片 ----------
  app.get('/api/decks/:id/items', async (req) => {
    const row = getDeckRow(ctx, idOf(req));
    const rows = ctx.db.prepare(
      `SELECT ${ITEM_COLUMNS} FROM items i LEFT JOIN card_states s ON s.card_id = i.id
       WHERE i.deck_id = ? AND i.deleted_at IS NULL ORDER BY i.position, i.id`,
    ).all(row.id) as Record<string, unknown>[];
    return rows.map(rowToItem);
  });

  app.post('/api/items', async (req) => {
    const b = bodyOf(req);
    const deckId = wantStr(b, 'deckId', 'deckId');
    if (!deckId) throw badRequest('deckId 必填');
    getDeckRow(ctx, deckId);
    const kind = wantStr(b, 'kind', 'kind');
    if (kind !== 'section' && kind !== 'card') throw badRequest('kind 只能是 section | card');
    const level = has(b, 'level') ? wantLevel(b.level) : 1;
    const cardType = has(b, 'cardType') ? wantCardType(b.cardType) : 'note';
    const color = has(b, 'color') ? wantColor(b.color) : 'default';
    const front = has(b, 'front') ? wantStr(b, 'front', 'front') ?? '' : '';
    const hint = has(b, 'hint') ? wantStr(b, 'hint', 'hint') ?? '' : '';
    const back = has(b, 'back') ? wantStr(b, 'back', 'back') ?? '' : '';
    const position = insertPosition(ctx, deckId, b);
    const id = newId();
    const now = ctx.now();
    if (kind === 'section') {
      const title = has(b, 'title') ? wantStr(b, 'title', 'title') ?? '' : SECTION_TITLE;
      ctx.db.prepare(
        `INSERT INTO items (id, deck_id, kind, position, level, title, collapsed, created_at, updated_at)
         VALUES (?,?,?,?,?,?,0,?,?)`,
      ).run(id, deckId, kind, position, level, title, now, now);
    } else {
      ctx.db.prepare(
        `INSERT INTO items (id, deck_id, kind, position, card_type, front, hint, back, color, created_at, updated_at)
         VALUES (?,?, 'card', ?,?,?,?,?,?,?,?)`,
      ).run(id, deckId, position, cardType, front, hint, back, color, now, now);
      logEdit(ctx, id, 'create');
    }
    touchDeck(ctx, deckId);
    return itemOf(ctx, id);
  });

  app.patch('/api/items/:id', async (req) => {
    const row = getItemRow(ctx, idOf(req));
    const b = bodyOf(req);
    const set: Obj = {};
    let content = false;
    if (has(b, 'title')) {
      const t = wantStr(b, 'title', 'title') ?? '';
      if (t !== (row.title ?? '')) { set.title = t; if (row.kind === 'section') content = false; }
    }
    if (has(b, 'level')) {
      const l = wantLevel(b.level);
      if (l !== row.level) set.level = l;
    }
    if (has(b, 'collapsed')) {
      const c = wantBool(b.collapsed, 'collapsed') ? 1 : 0;
      if (c !== (row.collapsed ?? 0)) set.collapsed = c;
    }
    for (const [key, col] of [['cardType', 'card_type'], ['front', 'front'], ['hint', 'hint'], ['back', 'back']] as const) {
      if (!has(b, key)) continue;
      let v: string;
      if (key === 'cardType') v = wantCardType(b[key]);
      else v = wantStr(b, key, key) ?? '';
      if (v !== (row[col] ?? '')) {
        set[col] = v;
        if (row.kind === 'card') content = true;
      }
    }
    if (has(b, 'color')) {
      const c = wantColor(b.color);
      if (c !== (row.color ?? 'default')) set.color = c;
    }
    const keys = ['title', 'level', 'collapsed', 'cardType', 'front', 'hint', 'back', 'color'];
    const dirty = keys.some((k) => has(b, k));
    const onlyCollapsed = has(b, 'collapsed') && !keys.filter((k) => k !== 'collapsed').some((k) => has(b, k));
    if (content) logEdit(ctx, row.id, 'update');
    if (dirty && !onlyCollapsed) {
      set.updated_at = ctx.now();
      touchDeck(ctx, row.deck_id);
    }
    const cols = Object.keys(set);
    if (cols.length) {
      ctx.db.prepare(`UPDATE items SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @__id`)
        .run({ ...set, __id: row.id });
    }
    return itemOf(ctx, row.id);
  });

  app.post('/api/items/delete', async (req) => {
    const b = bodyOf(req);
    const ids = wantIds(b.ids);
    const now = ctx.now();
    const decks = new Set<string>();
    for (const id of ids) {
      const row = ctx.db.prepare('SELECT id, kind, deck_id, deleted_at FROM items WHERE id = ?').get(id) as
        { id: string; kind: string; deck_id: string; deleted_at: number | null } | undefined;
      if (!row) continue;
      decks.add(row.deck_id);
      if (row.deleted_at !== null) continue;
      ctx.db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(now, id);
      if (row.kind === 'card') logEdit(ctx, id, 'delete');
    }
    for (const d of decks) touchDeck(ctx, d);
    return { ok: true };
  });

  app.post('/api/items/restore', async (req) => {
    const b = bodyOf(req);
    const ids = wantIds(b.ids);
    const decks = new Set<string>();
    for (const id of ids) {
      const row = ctx.db.prepare('SELECT id, deck_id FROM items WHERE id = ?').get(id) as
        { id: string; deck_id: string } | undefined;
      if (!row) continue;
      ctx.db.prepare('UPDATE items SET deleted_at = NULL WHERE id = ?').run(id);
      decks.add(row.deck_id);
    }
    for (const d of decks) touchDeck(ctx, d);
    return { ok: true };
  });

  app.post('/api/items/move', async (req) => {
    const b = bodyOf(req);
    const ids = wantIds(b.ids);
    if (!ids.length) return { ok: true };
    const rows = ids.map((id) => getItemRow(ctx, id));
    const to = has(b, 'deckId') && b.deckId !== undefined && b.deckId !== null ? String(b.deckId) : rows[0].deck_id;
    getDeckRow(ctx, to);
    const positions = movePositions(ctx, to, ids, b.afterId);
    const from = new Set(rows.map((r) => r.deck_id));
    const tx = ctx.db.transaction(() => {
      for (const [id, p] of positions) {
        ctx.db.prepare('UPDATE items SET position = ?, deck_id = ? WHERE id = ?').run(p, to, id);
      }
    });
    tx();
    touchDeck(ctx, to);
    for (const d of from) if (d !== to) touchDeck(ctx, d);
    return { ok: true };
  });

  app.post('/api/items/:id/duplicate', async (req) => {
    ensureGaps(ctx, getItemRow(ctx, idOf(req)).deck_id);
    const row = getItemRow(ctx, idOf(req));
    const next = ctx.db.prepare(
      'SELECT MIN(position) AS p FROM items WHERE deck_id = ? AND deleted_at IS NULL AND position > ?',
    ).get(row.deck_id, row.position) as { p: number | null };
    const position = next?.p != null ? (row.position + next.p) / 2 : row.position + 1;
    const id = newId();
    const now = ctx.now();
    ctx.db.prepare(
      `INSERT INTO items (id, deck_id, kind, position, level, title, collapsed, card_type, front, hint, back,
        color, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, row.deck_id, row.kind, position, row.level, row.title, row.collapsed ?? 0, row.card_type, row.front,
      row.hint, row.back, row.color ?? 'default', now, now);
    if (row.kind === 'card') logEdit(ctx, id, 'create');
    touchDeck(ctx, row.deck_id);
    return itemOf(ctx, id);
  });
}
