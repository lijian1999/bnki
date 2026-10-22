// SQLite 打开与建表（design.md §4）。所有表结构只在这里定义。
import Database from 'better-sqlite3';
import { plainText } from '@bnki/shared/markdown';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS folders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  position    REAL NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS decks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  folder_id     TEXT REFERENCES folders(id) ON DELETE SET NULL,
  cover         TEXT,
  pinned_at     INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  opened_at     INTEGER,
  studied_at    INTEGER,
  deleted_at    INTEGER,
  study_cfg     TEXT NOT NULL DEFAULT '{}',
  display_cfg   TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  deck_id     TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('section','card')),
  position    REAL NOT NULL,
  level       INTEGER,
  title       TEXT,
  collapsed   INTEGER DEFAULT 0,
  card_type   TEXT,
  front       TEXT,
  hint        TEXT,
  back        TEXT,
  color       TEXT DEFAULT 'default',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX IF NOT EXISTS items_deck_pos ON items(deck_id, position);

CREATE TABLE IF NOT EXISTS card_states (
  card_id        TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  state          INTEGER NOT NULL,
  due            INTEGER,
  stability      REAL,
  difficulty     REAL,
  elapsed_days   REAL,
  scheduled_days REAL,
  learning_steps INTEGER DEFAULT 0,
  reps           INTEGER DEFAULT 0,
  lapses         INTEGER DEFAULT 0,
  last_review    INTEGER,
  mastered       INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS card_states_due ON card_states(due);

CREATE TABLE IF NOT EXISTS review_logs (
  id          INTEGER PRIMARY KEY,
  card_id     TEXT NOT NULL,
  deck_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  rating      INTEGER,
  state       INTEGER,
  due         INTEGER,
  stability   REAL,
  difficulty  REAL,
  elapsed_days REAL,
  scheduled_days REAL,
  reviewed_at INTEGER NOT NULL,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS review_logs_time ON review_logs(reviewed_at);

CREATE TABLE IF NOT EXISTS edit_logs (
  id        INTEGER PRIMARY KEY,
  card_id   TEXT NOT NULL,
  action    TEXT NOT NULL,
  at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS edit_logs_time ON edit_logs(at);

CREATE TABLE IF NOT EXISTS media (
  hash       TEXT PRIMARY KEY,
  path       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- 全文搜索：text 是卡片正面、提示、背面去掉 Markdown 标记后的文本，key 是 text 去掉全部空白（搜索匹配 key，
-- 这样挖空、换行两侧补的空格不影响中文连续匹配）；rowid 对应 items.rowid
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(text, key, tokenize = 'trigram');
CREATE TRIGGER IF NOT EXISTS items_fts_ins AFTER INSERT ON items WHEN new.kind = 'card' BEGIN
  INSERT INTO items_fts (rowid, text, key) SELECT new.rowid, t, md_key(t) FROM (SELECT md_plain(new.front, new.hint, new.back) AS t);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_upd AFTER UPDATE OF front, hint, back ON items WHEN new.kind = 'card' BEGIN
  DELETE FROM items_fts WHERE rowid = old.rowid;
  INSERT INTO items_fts (rowid, text, key) SELECT new.rowid, t, md_key(t) FROM (SELECT md_plain(new.front, new.hint, new.back) AS t);
END;
CREATE TRIGGER IF NOT EXISTS items_fts_del AFTER DELETE ON items BEGIN
  DELETE FROM items_fts WHERE rowid = old.rowid;
END;
`;

/** 打开（不存在就创建）数据库。file 为 ':memory:' 时用于测试。 */
export function openDb(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // 触发器里用到，每个连接都要注册
  db.function('md_plain', { deterministic: true, varargs: true }, (...parts: unknown[]) =>
    parts.map((p) => plainText(typeof p === 'string' ? p : '')).filter(Boolean).join('\n'),
  );
  db.function('md_key', { deterministic: true }, (t: unknown) => String(t ?? '').replace(/\s+/g, ''));
  db.exec(SCHEMA);
  // 旧库或索引不全时整体重建
  const n = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  if (n("SELECT COUNT(*) AS c FROM items WHERE kind = 'card'") !== n('SELECT COUNT(*) AS c FROM items_fts')) {
    db.transaction(() => {
      db.exec('DELETE FROM items_fts');
      db.exec(`INSERT INTO items_fts (rowid, text, key)
        SELECT r, t, md_key(t) FROM (SELECT rowid AS r, md_plain(front, hint, back) AS t FROM items WHERE kind = 'card')`);
    })();
  }
  return db;
}
