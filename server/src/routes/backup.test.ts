import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { buildApp } from '../app';
import type { Ctx } from '../app';
import { autoBackup } from './backup';
import { newId } from '../util';

let tmpDir: string;
let app: any;
let ctx: Ctx;
let fakeNow: () => number;

let currentTs: number;
function setNow(y: number, m: number, d: number, h = 12, min = 0, s = 0) {
  currentTs = new Date(y, m - 1, d, h, min, s).getTime();
}

beforeEach(async () => {
  currentTs = new Date(2025, 0, 15, 10, 30, 0).getTime();
  fakeNow = () => currentTs;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-backup-'));
  ({ app, ctx } = await buildApp({ dataDir: tmpDir, memory: false, now: fakeNow }));
});

afterEach(async () => {
  await app.close();
  fs.rmSync(tmpDir, { recursive: true });
});

function insertDeck(title = '测试集'): string {
  const id = newId();
  const now = ctx.now();
  ctx.db.prepare(`INSERT INTO decks (id, title, description, created_at, updated_at)
    VALUES (?, ?, '', ?, ?)`).run(id, title, now, now);
  return id;
}

describe('POST /api/backup & GET /api/backups', () => {
  it('备份后目录有 bnki.sqlite 和 media/，GET 列出它', async () => {
    insertDeck();
    const res = await app.inject({ method: 'POST', url: '/api/backup' });
    expect(res.statusCode).toBe(200);
    const name = res.json().name;
    expect(name).toMatch(/^\d{8}-\d{6}$/);

    const dir = path.join(ctx.backupsDir, name);
    expect(fs.existsSync(path.join(dir, 'bnki.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'media'))).toBe(true);

    const listRes = await app.inject({ method: 'GET', url: '/api/backups' });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe(name);
    expect(list[0].size).toBeGreaterThan(0);
    expect(typeof list[0].createdAt).toBe('number');
  });
});

describe('POST /api/restore', () => {
  it('恢复后卡片集回来，多了 -before-restore', async () => {
    const deckId = insertDeck('重要卡片集');
    await app.inject({ method: 'POST', url: '/api/backup' });

    // 删除卡片集
    ctx.db.prepare('DELETE FROM items WHERE deck_id = ?').run(deckId);
    ctx.db.prepare('DELETE FROM decks WHERE id = ?').run(deckId);
    expect(ctx.db.prepare('SELECT id FROM decks WHERE id = ?').get(deckId)).toBeUndefined();

    // 恢复
    const backups = (await app.inject({ method: 'GET', url: '/api/backups' })).json();
    const backupName = backups[0].name;
    const restoreRes = await app.inject({ method: 'POST', url: '/api/restore', payload: { name: backupName } });
    expect(restoreRes.statusCode).toBe(200);
    expect(restoreRes.json()).toEqual({ ok: true });

    // 卡片集回来了
    const deck = ctx.db.prepare('SELECT id FROM decks WHERE id = ?').get(deckId);
    expect(deck).toBeDefined();

    // GET /api/backups 里多了 -before-restore
    const list = (await app.inject({ method: 'GET', url: '/api/backups' })).json();
    const names = list.map((b: any) => b.name);
    expect(names.some((n: string) => n.endsWith('-before-restore'))).toBe(true);
  });

  it('恢复不存在的名字 → 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/restore', payload: { name: 'noexist' } });
    expect(res.statusCode).toBe(404);
  });
});

describe('autoBackup', () => {
  it('同一天调两次只产生一个备份', () => {
    insertDeck();
    autoBackup(ctx);
    autoBackup(ctx);
    const dirs = fs.readdirSync(ctx.backupsDir).filter(d =>
      fs.existsSync(path.join(ctx.backupsDir, d, 'bnki.sqlite')));
    expect(dirs.length).toBe(1);
  });

  it('连续 16 天各调一次 → 只剩 14 个', () => {
    insertDeck();
    for (let i = 0; i < 16; i++) {
      setNow(2025, 1, 1 + i, 10, 0, 0);
      autoBackup(ctx);
    }
    const dirs = fs.readdirSync(ctx.backupsDir).filter(d =>
      fs.existsSync(path.join(ctx.backupsDir, d, 'bnki.sqlite')));
    expect(dirs.length).toBe(14);
  });

  it('内存库调 autoBackup 不报错、不产生备份', () => {
    // 用 memory: true 创建
    const memDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-mem-'));
    const memApp = buildApp({ dataDir: memDir, memory: true });
    expect(() => autoBackup({ dbFile: ':memory:' } as any)).not.toThrow();
    const dirs = fs.readdirSync(path.join(memDir, 'backups')).filter(d =>
      fs.existsSync(path.join(memDir, 'backups', d, 'bnki.sqlite')));
    expect(dirs.length).toBe(0);
    fs.rmSync(memDir, { recursive: true });
  });
});
