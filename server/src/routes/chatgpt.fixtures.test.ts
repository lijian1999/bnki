import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { buildApp } from '../app';
import type { Ctx } from '../app';

/**
 * 回归语料：真实 ChatGPT 学习模式对话。
 * 不针对某个组件断言，而是检查结构不变量 + 输出快照：
 * 任何改动只要让某段对话的输出变了、或者违反不变量，这里就会失败。
 */

let tmpDir: string;
let app: any;
let ctx: Ctx;

const FIXTURES = ['conv-ros.json', 'conv-docker.json', 'conv-coords.json', 'conv-tf.json', 'conv-deform.json'];
const FIXTURE_DIR = path.join(__dirname, 'fixtures');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-fixtures-'));
  ({ app, ctx } = await buildApp({ dataDir: tmpDir, memory: true, now: () => 1_700_000_000_000 }));
});

afterEach(async () => {
  await app.close();
  fs.rmSync(tmpDir, { recursive: true });
});

function insertDeck(id: string): string {
  ctx.db.prepare(`INSERT INTO decks (id, title, description, created_at, updated_at) VALUES (?, ?, '', ?, ?)`)
    .run(id, id, 1_700_000_000_000, 1_700_000_000_000);
  return id;
}

function load(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

async function importFixture(deckId: string, conv: Record<string, unknown>, images: unknown[] = []) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/import/chatgpt',
    payload: { deckId, source: 'json', conversation: conv, images },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

/** 按每条回答的视觉节点数，造出等量的假截图（1x1 PNG）。 */
function fakeImages(reports: { messageId: string; visualNodes: number }[]): unknown[] {
  const out: unknown[] = [];
  for (const r of reports) {
    for (let i = 0; i < r.visualNodes; i++) {
      out.push({ messageId: r.messageId, domIndex: i, type: 'component', dataUrl: DATA_URL });
    }
  }
  return out;
}

describe.each(FIXTURES)('%s', (name) => {
  it('结构不变量：没有残留标签/公式、表格完整、文字不丢、图不缺', async () => {
    const conv = load(name);

    // 第一遍：不提供截图，拿到每条回答的视觉节点数
    const probe = await importFixture(insertDeck('probe-' + name), conv);
    expect(probe.fallback).toBeGreaterThanOrEqual(0);

    // 第二遍：给每个视觉节点一张截图
    const deckId = insertDeck('deck-' + name);
    const body = await importFixture(deckId, conv, fakeImages(probe.reports));
    expect(body.mismatch).toBe(0);
    expect(body.issues).toEqual([]);
    expect(body.fallback).toBe(0);
  });

  it('输出快照：每张卡片的 Markdown 不变', async () => {
    const conv = load(name);
    const deckId = insertDeck('snap-' + name);
    const body = await importFixture(deckId, conv);

    const items = ctx.db
      .prepare(`SELECT front FROM items WHERE deck_id = ? AND kind = 'card' ORDER BY position`)
      .all(deckId) as any[];
    expect(items.length).toBe(body.cards);
    expect(items.map((i) => i.front)).toMatchSnapshot();
  });
});
