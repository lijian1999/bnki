// 测试用：造 .apkg 包。legacy = collection.anki2 + JSON 媒体清单；new = collection.anki21b（zstd）+ protobuf 清单。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { zipSync } from 'fflate';
import Database from 'better-sqlite3';

export interface ApkgFixtureNote { id: number; flds: string[]; did: number; noCard?: boolean }
export interface ApkgFixtureOpts {
  format: 'legacy' | 'new';
  /** 牌组 id → 名字，层级一律写 ::，new 格式会换成 \u001f */
  decks: Record<number, string>;
  notes: ApkgFixtureNote[];
  /** 原文件名 → 内容；按插入顺序对应包里的 0、1… */
  media?: Record<string, Buffer>;
}

export function buildApkg(opts: ApkgFixtureOpts): Buffer {
  const dbBuf = buildCollection(opts);
  const files: Record<string, Uint8Array> = {};
  const mediaNames = Object.keys(opts.media ?? {});
  if (opts.format === 'new') {
    files['collection.anki21b'] = zstd(dbBuf);
    files['media'] = zstd(encodeMediaEntries(mediaNames));
    mediaNames.forEach((name, i) => {
      files[String(i)] = zstd(opts.media![name]);
    });
  } else {
    files['collection.anki2'] = dbBuf;
    const manifest: Record<string, string> = {};
    mediaNames.forEach((name, i) => {
      manifest[String(i)] = name;
      files[String(i)] = opts.media![name];
    });
    files['media'] = Buffer.from(JSON.stringify(manifest), 'utf8');
  }
  return Buffer.from(zipSync(files));
}

const zstd = (b: Buffer): Uint8Array => zlib.zstdCompressSync(b);

/** MediaEntries{ entries=1: MediaEntry{ name=1, size=2, sha1=3 } } */
function encodeMediaEntries(names: string[]): Buffer {
  const parts: Buffer[] = [];
  for (const name of names) {
    const nb = Buffer.from(name, 'utf8');
    const entry = Buffer.concat([
      Buffer.from([0x0a, nb.length]), nb, // name（字段 1）
      Buffer.from([0x10, 0x14]),          // size = 20（字段 2 编码，解析时应跳过）
      Buffer.from([0x1a, 0x00]),          // sha1 = 空（字段 3）
    ]);
    parts.push(Buffer.from([0x0a, entry.length]), entry); // entries（字段 1）
  }
  return Buffer.concat(parts);
}

function buildCollection(opts: ApkgFixtureOpts): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-apkg-fixture-'));
  const file = path.join(dir, 'c.sqlite');
  const buf = (() => {
    const db = new Database(file);
    db.pragma('journal_mode = delete'); // close 后单文件即可打开
    try {
      db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT)');
      db.exec('CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER)');
      const insNote = db.prepare('INSERT INTO notes (id, mid, flds) VALUES (?, ?, ?)');
      const insCard = db.prepare('INSERT INTO cards (id, nid, did, ord) VALUES (?, ?, ?, ?)');
      opts.notes.forEach((n, i) => {
        insNote.run(n.id, 1600000000, n.flds.join('\u001f'));
        if (!n.noCard) insCard.run(i + 1, n.id, n.did, 0);
      });
      if (opts.format === 'new') {
        db.exec('CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT)');
        const insDeck = db.prepare('INSERT INTO decks (id, name) VALUES (?, ?)');
        for (const [id, name] of Object.entries(opts.decks)) insDeck.run(id, name.replace(/::/g, '\u001f'));
      } else {
        db.exec('CREATE TABLE col (id INTEGER PRIMARY KEY, decks TEXT)');
        const decks: Record<string, { name: string }> = {};
        for (const [id, name] of Object.entries(opts.decks)) decks[id] = { name };
        db.prepare('INSERT INTO col (id, decks) VALUES (1, ?)').run(JSON.stringify(decks));
      }
      return fs.readFileSync(file);
    } finally {
      db.close();
    }
  })();
  fs.rmSync(dir, { recursive: true, force: true });
  return buf;
}
