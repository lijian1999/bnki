// 导出接口测试：先验 unwrapCloze，再走 app.inject 看四种格式的正文和响应头。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../app';
import type { Ctx } from '../app';
import { unwrapCloze } from '../export/cloze';

let tmpDir: string;
let app: any;
let ctx: Ctx;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-export-'));
  ({ app, ctx } = await buildApp({ dataDir: tmpDir, memory: true }));
});

afterEach(async () => {
  await app.close();
  fs.rmSync(tmpDir, { recursive: true });
});

const NOW = 1700000000000;

/** 测试集：A(1) → q1、B(1) → n1、B1(2) → n2 */
function insertDeck(): string {
  const id = 'deck1';
  const now = NOW;
  ctx.db.prepare('INSERT INTO decks (id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, '测试集', '', now, now);
  const ins = (iid: string, kind: string, position: number, cols: string, vals: unknown[]) => {
    ctx.db.prepare(`INSERT INTO items (id, deck_id, kind, position, created_at, updated_at, ${cols}) VALUES (?, ?, ?, ?, ?, ?, ${new Array(vals.length).fill('?').join(',')})`)
      .run(iid, id, kind, position, now, now, ...vals);
  };
  ins('A', 'section', 1, 'level, title', [1, 'A']);
  ins('q1', 'card', 2, "card_type, front, hint, back, color", ['qa', '问{{答}}', '提', '答案', 'default']);
  ins('B', 'section', 3, 'level, title', [1, 'B']);
  ins('n1', 'card', 4, "card_type, front, hint, back, color", ['note', '进程是 {{资源}} 的单位 \\{{x}} `{{c}}`', '', '', 'default']);
  ins('B1', 'section', 5, 'level, title', [2, 'B1']);
  ins('n2', 'card', 6, "card_type, front, hint, back, color", ['note', '第二条笔记', '', '', 'default']);
  return id;
}

function get(url: string) {
  return app.inject({ method: 'GET', url });
}

describe('unwrapCloze', () => {
  it('替换普通挖空，保留字面量和行内代码', () => {
    expect(unwrapCloze('a {{b}} \\{{c}} `{{d}}`')).toBe('a b \\{{c}} `{{d}}`');
  });

  it('代码块里的挖空原样保留', () => {
    const src = '```md\n前 {{x}} 后\n```\n\n真的 {{y}} 吗';
    expect(unwrapCloze(src)).toBe('```md\n前 {{x}} 后\n```\n\n真的 y 吗');
  });

  it('没有挖空时原样返回', () => {
    expect(unwrapCloze('普通文本')).toBe('普通文本');
  });
});

describe('GET /api/export/:deckId', () => {
  it('md 默认格式：标题、目录层级、问答卡版式', async () => {
    const id = insertDeck();
    const res = await get(`/api/export/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    const body = res.body;
    expect(body).toContain('# 测试集');
    expect(body).toContain('## A');
    expect(body).toContain('**Q:** 问{{答}}');
    expect(body).toContain('> 提示：提');
    expect(body).toContain('**A:** 答案');
    expect(body).toContain('### B1');

    const disp = String(res.headers['content-disposition']);
    const mark = "filename*=UTF-8''";
    expect(disp).toContain(mark);
    expect(decodeURIComponent(disp.slice(disp.indexOf(mark) + mark.length))).toBe('测试集.md');
  });

  it('md 的 cloze=answer 去掉挖空标记', async () => {
    const id = insertDeck();
    const res = await get(`/api/export/${id}?cloze=answer`);
    expect(res.body).toContain('**Q:** 问答');
    expect(res.body).toContain('进程是 资源 的单位');
    expect(res.body).not.toContain('{{答}}');
  });

  it('sections 只留选中目录的块', async () => {
    const id = insertDeck();
    const all = await get(`/api/export/${id}?sections=B`);
    expect(all.body).not.toContain('问{{答}}');
    expect(all.body).toContain('进程是 {{资源}}');
    expect(all.body).toContain('第二条笔记');

    const only = await get(`/api/export/${id}?sections=B1`);
    expect(only.body).toContain('## B1');
    expect(only.body).toContain('第二条笔记');
    expect(only.body).not.toContain('进程是');
    expect(only.body).not.toContain('问{{答}}');
  });

  it('html：完整文档、挖空样式、inline 打印、图片转 data URL', async () => {
    const id = insertDeck();
    const res = await get(`/api/export/${id}?format=html`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body.startsWith('<!doctype html>')).toBe(true);
    expect(res.body).toContain('class="cloze"');

    const ans = await get(`/api/export/${id}?format=html&cloze=answer`);
    expect(ans.body).not.toContain('class="cloze"');

    const inline = await get(`/api/export/${id}?format=html&inline=1`);
    expect(inline.headers['content-disposition']).toBeFalsy();
    expect(inline.body).toContain('window.print');
  });

  it('html 把 /media 图片换成 data URL', async () => {
    const id = insertDeck();
    fs.writeFileSync(path.join(ctx.mediaDir, 'ab.png'), Buffer.from('89504e47', 'hex'));
    ctx.db.prepare("INSERT INTO items (id, deck_id, kind, position, card_type, front, hint, back, color, created_at, updated_at) VALUES ('p1', ?, 'card', 7, 'note', ?, '', '', 'default', ?, ?)").run(id, '看图 ![](media/ab.png)', NOW, NOW);
    const res = await get(`/api/export/${id}?format=html`);
    expect(res.body).toContain('src="data:image/png;base64,');
  });

  it('csv：BOM + 表头 + 引号转义 + 最近目录', async () => {
    const id = insertDeck();
    const res = await get(`/api/export/${id}?format=csv`);
    expect(res.headers['content-type']).toContain('text/csv');
    const body = res.body as string;
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const lines = body.slice(1).split('\r\n');
    expect(lines[0]).toBe('目录,类型,问题/内容,提示,答案');
    const q = lines.find((l) => l.includes('问{{答}}'));
    expect(q).toBeTruthy();
    expect(q!.startsWith('A,')).toBe(true);
    const n2 = lines.find((l) => l.includes('第二条笔记'));
    expect(n2!.startsWith('B1,')).toBe(true);
    expect(q).toContain('问答卡片');
  });

  it('csv 含逗号的字段用引号包住', async () => {
    const id = insertDeck();
    ctx.db.prepare("INSERT INTO items (id, deck_id, kind, position, card_type, front, hint, back, color, created_at, updated_at) VALUES ('c1', ?, 'card', 7, 'note', ?, '', '', 'default', ?, ?)").run(id, '逗号，在, 这里"引号"', NOW, NOW);
    const res = await get(`/api/export/${id}?format=csv`);
    expect(res.body).toContain('"逗号，在, 这里""引号"""');
  });

  it('json：version、目录项和卡片项', async () => {
    const id = insertDeck();
    const res = await get(`/api/export/${id}?format=json`);
    expect(res.headers['content-type']).toContain('application/json');
    const data = JSON.parse(res.body);
    expect(data.version).toBe(1);
    expect(data.title).toBe('测试集');
    expect(data.items.length).toBe(6);
    expect(data.items[0]).toEqual({ kind: 'section', level: 1, title: 'A' });
    expect(data.exportedAt).toBeTypeOf('number');
  });

  it('不支持的格式 400，卡片集不存在 404', async () => {
    const id = insertDeck();
    expect((await get(`/api/export/${id}?format=pdf`)).statusCode).toBe(400);
    expect((await get('/api/export/不存在')).statusCode).toBe(404);
  });
});
