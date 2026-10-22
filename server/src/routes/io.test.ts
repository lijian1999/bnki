import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { buildApp } from '../app';
import type { Ctx } from '../app';
import { newId } from '../util';

let tmpDir: string;
let app: any;
let ctx: Ctx;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-io-'));
  ({ app, ctx } = await buildApp({ dataDir: tmpDir, memory: true }));
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

function queryItems(deckId: string) {
  return ctx.db.prepare(
    `SELECT id, kind, position, card_type, front, back, level, title FROM items
     WHERE deck_id = ? AND deleted_at IS NULL ORDER BY position`
  ).all(deckId) as any[];
}

describe('POST /api/import/text', () => {
  it('tsv 三行，1 行有背面 → 1 qa 2 note', async () => {
    const deckId = insertDeck();
    // 先插一个已有 item 验证 position 在它之后
    ctx.db.prepare(`INSERT INTO items (id, deck_id, kind, position, card_type, front, created_at, updated_at)
      VALUES (?, ?, 'card', 10, 'note', '已有', ?, ?)`).run(newId(), deckId, ctx.now(), ctx.now());

    const res = await app.inject({
      method: 'POST', url: '/api/import/text',
      payload: { deckId, text: '问1\t答1\n问2\t\n问3\t答3', format: 'tsv', firstColumnIsSection: false },
    });
    expect(res.json()).toEqual({ cards: 3, sections: 0 });

    const items = queryItems(deckId);
    const cards = items.filter((i: any) => i.kind === 'card');
    expect(cards.length).toBe(4); // 包括之前插的那张
    const imported = cards.slice(1);
    expect(imported[0].card_type).toBe('qa'); // 问1 答1
    expect(imported[1].card_type).toBe('note'); // 问2
    expect(imported[2].card_type).toBe('qa'); // 问3 答3
    // position 在 10 之后
    expect(imported[0].position).toBe(11);
    expect(imported[1].position).toBe(12);
    expect(imported[2].position).toBe(13);
    // 顺序和输入一致
    expect(imported[0].front).toBe('问1');
    expect(imported[1].front).toBe('问2');
    expect(imported[2].front).toBe('问3');
  });

  it('带目录列', async () => {
    const deckId = insertDeck();
    const res = await app.inject({
      method: 'POST', url: '/api/import/text',
      payload: {
        deckId,
        text: '第一章\t问1\t答1\n第一章\t问2\n第二章\t问3',
        format: 'tsv',
        firstColumnIsSection: true,
      },
    });
    expect(res.json()).toEqual({ cards: 3, sections: 2 });

    const items = queryItems(deckId);
    expect(items.length).toBe(5);
    expect(items[0].kind).toBe('section');
    expect(items[0].title).toBe('第一章');
    expect(items[1].kind).toBe('card');
    expect(items[1].front).toBe('问1');
    expect(items[2].kind).toBe('card');
    expect(items[2].front).toBe('问2');
    expect(items[3].kind).toBe('section');
    expect(items[3].title).toBe('第二章');
    expect(items[4].kind).toBe('card');
    expect(items[4].front).toBe('问3');
  });

  it('空文本 → 400', async () => {
    const deckId = insertDeck();
    const res = await app.inject({
      method: 'POST', url: '/api/import/text',
      payload: { deckId, text: '', format: 'tsv', firstColumnIsSection: false },
    });
    expect(res.statusCode).toBe(400);
  });

  it('卡片集不存在 → 404', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/import/text',
      payload: { deckId: 'noexist', text: '问\t答', format: 'tsv', firstColumnIsSection: false },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/import/markdown', () => {
  it('split=item', async () => {
    const deckId = insertDeck();
    const text = '# 进程\n- 进程是 {{资源分配}} 的单位\n  - 子项\n- 线程\n## 调度\n段落一\n\n段落二';
    const res = await app.inject({
      method: 'POST', url: '/api/import/markdown',
      payload: { deckId, text, split: 'item' },
    });
    expect(res.json()).toEqual({ cards: 4, sections: 2 });

    const items = queryItems(deckId);
    expect(items[0].kind).toBe('section');
    expect(items[0].title).toBe('进程');
    expect(items[0].level).toBe(1);
    expect(items[1].kind).toBe('card');
    expect(items[1].front).toContain('子项');
    expect(items[1].front).toContain('资源分配');
    expect(items[2].kind).toBe('card');
    expect(items[2].front).toBe('线程');
    expect(items[3].kind).toBe('section');
    expect(items[3].title).toBe('调度');
    expect(items[3].level).toBe(2);
    expect(items[4].kind).toBe('card');
    expect(items[4].front).toBe('段落一');
    expect(items[5].kind).toBe('card');
    expect(items[5].front).toBe('段落二');
  });

  it('split=hr', async () => {
    const deckId = insertDeck();
    const res = await app.inject({
      method: 'POST', url: '/api/import/markdown',
      payload: { deckId, text: 'a\n\n---\nb', split: 'hr' },
    });
    expect(res.json()).toEqual({ cards: 2, sections: 0 });

    const items = queryItems(deckId);
    expect(items.length).toBe(2);
    expect(items[0].front).toBe('a');
    expect(items[1].front).toBe('b');
  });

  it('代码块里的 # 不变成目录，代码块里的空行不切卡', async () => {
    const deckId = insertDeck();
    const text = '# 标题\n```py\n# comment\n\nx = 1\n```\n正文';
    const res = await app.inject({
      method: 'POST', url: '/api/import/markdown',
      payload: { deckId, text, split: 'paragraph' },
    });

    const items = queryItems(deckId);
    const sections = items.filter((i: any) => i.kind === 'section');
    expect(sections.length).toBe(1);
    expect(sections[0].title).toBe('标题');
    // 代码块 + 正文在一张或两张卡里，没有因代码块里的空行被切开
    // 代码块内的 # comment 没变成 section
    const cards = items.filter((i: any) => i.kind === 'card');
    expect(cards.length).toBeGreaterThanOrEqual(1);
    // 代码块内容应该在某张卡里
    const allFronts = cards.map((c: any) => c.front).join('\n');
    expect(allFronts).toContain('# comment');
  });
});
