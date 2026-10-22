// SQLite 打开与建表（design.md §4）。所有表结构只在这里定义。
import Database from 'better-sqlite3';

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
`;

/** 打开（不存在就创建）数据库。file 为 ':memory:' 时用于测试。 */
export function openDb(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
