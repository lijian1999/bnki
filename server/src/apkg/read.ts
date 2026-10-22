// 读取 .apkg 包：zip → 集合数据库（SQLite）+ 媒体文件清单。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { unzipSync } from 'fflate';
import Database from 'better-sqlite3';
import { badRequest, HttpError } from '../util';

export interface ApkgNote { id: number; fields: string[]; deckPath: string[] }
export interface ApkgData { notes: ApkgNote[]; media: Map<string, Buffer> }

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const DB_NAMES = ['collection.anki21b', 'collection.anki21', 'collection.anki2'];

const isZstd = (b: Buffer): boolean => b.length >= 4 && b.subarray(0, 4).equals(ZSTD_MAGIC);
const inflate = (b: Buffer): Buffer => (isZstd(b) ? zlib.zstdDecompressSync(b) : b);

export function readApkg(buf: Buffer): ApkgData {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf);
  } catch {
    throw badRequest('不是有效的 .apkg 文件');
  }
  const raw = (k: string): Buffer | undefined => {
    const f = files[k];
    return f ? Buffer.from(f) : undefined;
  };
  let dbBytes: Buffer | undefined;
  for (const name of DB_NAMES) {
    const f = raw(name);
    if (f) { dbBytes = inflate(f); break; }
  }
  if (!dbBytes) throw badRequest('不是有效的 .apkg 文件');

  const media = readMedia(raw);
  const notes = readDatabase(dbBytes);
  return { notes, media };
}

function readMedia(raw: (k: string) => Buffer | undefined): Map<string, Buffer> {
  const media = new Map<string, Buffer>();
  const manifest = raw('media');
  if (!manifest) return media;
  // 清单本身是 zstd 的即新格式：protobuf 条目按顺序对应 zip 文件 "0" "1"…
  if (isZstd(manifest)) {
    const names = parseMediaEntries(zlib.zstdDecompressSync(manifest));
    names.forEach((name, i) => {
      const f = raw(String(i));
      if (f && name) media.set(name, inflate(f));
    });
  } else {
    let map: Record<string, unknown>;
    try {
      map = JSON.parse(manifest.toString('utf8'));
    } catch {
      return media;
    }
    for (const [k, v] of Object.entries(map)) {
      const f = raw(k);
      if (f && typeof v === 'string' && v) media.set(v, inflate(f));
    }
  }
  return media;
}

function readDatabase(dbBytes: Buffer): ApkgNote[] {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-apkg-'));
  const tmpFile = path.join(tmpDir, 'collection.sqlite');
  fs.writeFileSync(tmpFile, dbBytes);
  let db: Database.Database | undefined;
  const bad = () => badRequest('不是有效的 .apkg 文件');
  try {
    try {
      db = new Database(tmpFile, { readonly: true, fileMustExist: true });
    } catch {
      throw bad();
    }
    const hasTable = (name: string) =>
      !!db!.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
    if (!hasTable('notes') || !hasTable('cards')) throw bad();

    const deckNames = new Map<number, string[]>();
    if (hasTable('decks')) {
      for (const r of db.prepare('SELECT id, name FROM decks').all() as { id: number | bigint; name: string }[]) {
        deckNames.set(Number(r.id), r.name.split('\u001f'));
      }
    } else if (hasTable('col')) {
      const row = db.prepare('SELECT decks FROM col LIMIT 1').get() as { decks: string | null } | undefined;
      try {
        for (const [id, d] of Object.entries(JSON.parse(row?.decks ?? '{}'))) {
          const name = (d as { name?: unknown })?.name;
          if (typeof name === 'string') deckNames.set(Number(id), name.split('::'));
        }
      } catch {
        // decks JSON 坏了就当作没有牌组名
      }
    } else {
      throw bad();
    }

    // 每张笔记取 ord 最小的那张卡片的 did
    const best = new Map<number, { did: number; ord: number }>();
    for (const c of db.prepare('SELECT nid, did, ord FROM cards').all() as { nid: number | bigint; did: number | bigint; ord: number }[]) {
      const nid = Number(c.nid);
      const cur = best.get(nid);
      if (!cur || c.ord < cur.ord) best.set(nid, { did: Number(c.did), ord: c.ord });
    }
    const notes: ApkgNote[] = [];
    for (const r of db.prepare('SELECT id, flds FROM notes').all() as { id: number | bigint; flds: string }[]) {
      const card = best.get(Number(r.id));
      if (!card) continue; // 没有卡片的笔记丢掉
      notes.push({ id: Number(r.id), fields: r.flds.split('\u001f'), deckPath: deckNames.get(card.did) ?? [] });
    }
    notes.sort((x, y) => comparePaths(x.deckPath, y.deckPath) || x.id - y.id);
    return notes;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw bad();
  } finally {
    db?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** deckPath 逐级比较的字典序，短的在前。 */
function comparePaths(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

// ---- 最小 protobuf 解析：MediaEntries{ repeated MediaEntry entries=1 } ----

function parseMediaEntries(data: Buffer): string[] {
  const names: string[] = [];
  let pos = 0;
  while (pos < data.length) {
    const key = readVarint(data, pos);
    if (!key) break;
    pos = key.next;
    const field = key.value >> 3;
    const type = key.value & 7;
    if (field === 1 && type === 2) {
      const len = readVarint(data, pos);
      if (!len) break;
      pos = len.next;
      names.push(readEntryName(data.subarray(pos, pos + len.value)));
      pos += len.value;
    } else if (type === 0) {
      const v = readVarint(data, pos);
      if (!v) break;
      pos = v.next;
    } else if (type === 1) pos += 8;
    else if (type === 5) pos += 4;
    else break; // group / packed 字段用不到
  }
  return names;
}

function readEntryName(b: Buffer): string {
  let pos = 0;
  while (pos < b.length) {
    const key = readVarint(b, pos);
    if (!key) return '';
    pos = key.next;
    const field = key.value >> 3;
    const type = key.value & 7;
    if (field === 1 && type === 2) {
      const len = readVarint(b, pos);
      if (!len) return '';
      pos = len.next;
      return b.subarray(pos, pos + len.value).toString('utf8');
    }
    if (type === 0) {
      const v = readVarint(b, pos);
      if (!v) return '';
      pos = v.next;
    } else if (type === 1) pos += 8;
    else if (type === 5) pos += 4;
    else break;
  }
  return '';
}

function readVarint(b: Buffer, p: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  while (p < b.length) {
    const c = b[p++];
    value += (c & 0x7f) * 2 ** shift;
    if ((c & 0x80) === 0) return { value, next: p };
    shift += 7;
    if (shift > 49) return null;
  }
  return null;
}
