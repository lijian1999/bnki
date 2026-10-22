// 数据库行 → API 对象（snake_case → camelCase）。
import type { CardItem, CardState, Deck, Folder, Item, SectionItem } from '@bnki/shared';

type Row = Record<string, any>;

const parseJson = (s: unknown) => {
  try { return typeof s === 'string' && s ? JSON.parse(s) : {}; } catch { return {}; }
};

export function rowToFolder(r: Row): Folder {
  return { id: r.id, name: r.name, position: r.position, createdAt: r.created_at };
}

export function rowToDeck(r: Row): Deck {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? '',
    folderId: r.folder_id ?? null,
    cover: r.cover ?? null,
    pinnedAt: r.pinned_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    openedAt: r.opened_at ?? null,
    studiedAt: r.studied_at ?? null,
    deletedAt: r.deleted_at ?? null,
    studyCfg: parseJson(r.study_cfg),
    displayCfg: parseJson(r.display_cfg),
  };
}

/** card_states 的一行；r 里没有 state 列（LEFT JOIN 为空）时返回 null。 */
export function rowToState(r: Row | undefined | null): CardState | null {
  if (!r || r.state == null) return null;
  return {
    state: r.state,
    due: r.due ?? null,
    stability: r.stability ?? 0,
    difficulty: r.difficulty ?? 0,
    elapsedDays: r.elapsed_days ?? 0,
    scheduledDays: r.scheduled_days ?? 0,
    learningSteps: r.learning_steps ?? 0,
    reps: r.reps ?? 0,
    lapses: r.lapses ?? 0,
    lastReview: r.last_review ?? null,
    mastered: !!r.mastered,
  };
}

/** items 的一行（可以 LEFT JOIN card_states，列名不冲突）。 */
export function rowToItem(r: Row): Item {
  if (r.kind === 'section') {
    const s: SectionItem = {
      id: r.id, deckId: r.deck_id, kind: 'section', position: r.position,
      level: r.level ?? 1, title: r.title ?? '', collapsed: !!r.collapsed,
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
    return s;
  }
  const c: CardItem = {
    id: r.id, deckId: r.deck_id, kind: 'card', position: r.position,
    cardType: r.card_type ?? 'note', front: r.front ?? '', hint: r.hint ?? '', back: r.back ?? '',
    color: r.color ?? 'default', createdAt: r.created_at, updatedAt: r.updated_at,
    state: rowToState(r),
  };
  return c;
}

/** 查卡片（含记忆状态）用的 SELECT 片段：SELECT ${ITEM_COLUMNS} FROM items i LEFT JOIN card_states s ON s.card_id = i.id */
export const ITEM_COLUMNS = `i.*, s.state, s.due, s.stability, s.difficulty, s.elapsed_days, s.scheduled_days,
  s.learning_steps, s.reps, s.lapses, s.last_review, s.mastered`;

/** CardState → card_states 的 UPSERT。 */
export function saveState(db: import('./db').DB, cardId: string, st: CardState): void {
  db.prepare(`INSERT INTO card_states (card_id, state, due, stability, difficulty, elapsed_days, scheduled_days,
      learning_steps, reps, lapses, last_review, mastered)
    VALUES (@cardId, @state, @due, @stability, @difficulty, @elapsedDays, @scheduledDays,
      @learningSteps, @reps, @lapses, @lastReview, @mastered)
    ON CONFLICT(card_id) DO UPDATE SET state=excluded.state, due=excluded.due, stability=excluded.stability,
      difficulty=excluded.difficulty, elapsed_days=excluded.elapsed_days, scheduled_days=excluded.scheduled_days,
      learning_steps=excluded.learning_steps, reps=excluded.reps, lapses=excluded.lapses,
      last_review=excluded.last_review, mastered=excluded.mastered`)
    .run({ ...st, cardId, mastered: st.mastered ? 1 : 0 });
}
