import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { buildApp } from '../app';
import type { Ctx } from '../app';
import { newId } from '../util';
import { buildApkg } from '../apkg/fixture';

let tmpDir: string;
let app: any;
let ctx: Ctx;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 8, 9]);

const apkg = buildApkg({
  format: 'new',
  decks: { 1: '根', 2: '根::第一章', 3: '根::第一章::1.1', 4: '根::第二章' },
  notes: [
    { id: 101, flds: ['<div>进程是什么</div>', 'CPU调度的基本单位'], did: 2 },
    { id: 102, flds: ['<div>{{c1::进程}}是资源分配的单位</div>', ''], did: 3 },
    { id: 103, flds: ['<div>见&nbsp;<img src="a.png"></div>', '图注'], did: 4 },
  ],
  media: { 'a.png': PNG },
});

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-apkg-route-'));
  ({ app, ctx } = await buildApp({ dataDir: tmpDir, memory: true }));
});

afterEach(async () => {
  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function insertDeck(title = '导入测试'): string {
  const id = newId();
  const now = ctx.now();
  ctx.db.prepare(`INSERT INTO decks (id, title, description, created_at, updated_at)
    VALUES (?, ?, '', ?, ?)`).run(id, title, now, now);
  return id;
}

function queryItems(deckId: string) {
  return ctx.db.prepare(
    `SELECT id, kind, position, card_type, front, back, level, title FROM items
     WHERE deck_id = ? AND deleted_at IS NULL ORDER BY position`
  ).all(deckId) as any[];
}

function upload(deckId: string, data: Buffer) {
  const boundary = '----BnkiApkgBoundary789';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="deck.apkg"\r\nContent-Type: application/octet-stream\r\n\r\n`, 'utf-8'),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'),
  ]);
  return app.inject({
    method: 'POST',
    url: `/api/import/apkg?deckId=${deckId}`,
    payload: body,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
}

describe('POST /api/import/apkg', () => {
  it('导入 3 条笔记：目录和卡片顺序、层级、内容', async () => {
    const deckId = insertDeck();
    const res = await upload(deckId, apkg);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cards: 3, sections: 3 });

    const items = queryItems(deckId);
    expect(items.map((i) => i.kind)).toEqual(['section', 'card', 'section', 'card', 'section', 'card']);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3, 4, 5, 6]);

    expect(items[0].title).toBe('第一章');
    expect(items[0].level).toBe(1);
    expect(items[1].card_type).toBe('qa');
    expect(items[1].front).toBe('进程是什么');
    expect(items[1].back).toBe('CPU调度的基本单位');
    expect(items[2].title).toBe('1.1');
    expect(items[2].level).toBe(2);
    expect(items[3].card_type).toBe('note');
    expect(items[3].front).toBe('{{进程}}是资源分配的单位');
    expect(items[4].title).toBe('第二章');
    expect(items[4].level).toBe(1);
    expect(items[5].card_type).toBe('qa');
    expect(items[5].front).toContain('![](media/');
    expect(items[5].back).toBe('图注');

    expect(fs.readdirSync(ctx.mediaDir)).toHaveLength(1);
    const rows = ctx.db.prepare('SELECT * FROM media').all();
    expect(rows).toHaveLength(1);
    const logs = ctx.db.prepare('SELECT card_id, action FROM edit_logs').all();
    expect(logs).toHaveLength(3);
    expect(new Set(logs.map((l: any) => l.action))).toEqual(new Set(['create']));
  });

  it('卡片集不存在 → 404', async () => {
    const res = await upload('no-such-deck', apkg);
    expect(res.statusCode).toBe(404);
  });

  it('上传非 zip → 400', async () => {
    const deckId = insertDeck();
    const res = await upload(deckId, Buffer.from('这不是一个 apkg 文件'));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad_request');
  });
});
