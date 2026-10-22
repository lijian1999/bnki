// 导入 Anki 牌组：POST /api/import/apkg?deckId=（multipart，字段 file）。
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { Ctx } from '../app';
import { newId, notFound, badRequest } from '../util';
import { readApkg } from '../apkg/read';
import { ankiToMarkdown } from '../apkg/markdown';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export default async function register(app: FastifyInstance, ctx: Ctx): Promise<void> {

  app.post('/api/import/apkg', async (req) => {
    const deckId = (req.query as { deckId?: string }).deckId;
    if (!deckId || !ctx.db.prepare('SELECT id FROM decks WHERE id = ? AND deleted_at IS NULL').get(deckId)) {
      throw notFound('卡片集不存在');
    }
    const file = await req.file();
    if (!file) throw badRequest('没有上传文件');
    const data = readApkg(await file.toBuffer());
    if (data.notes.length === 0) throw badRequest('没有解析出卡片');

    const now = ctx.now();
    // 媒体：按 routes/media.ts 的规则存盘，只收图片扩展名
    const mediaMap = new Map<string, string>();
    for (const [name, bytes] of data.media) {
      const ext = path.extname(name).replace('.', '').toLowerCase();
      const mime = MIME_BY_EXT[ext];
      if (!mime) continue;
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
      const rel = `media/${hash}.${ext}`;
      if (!ctx.db.prepare('SELECT hash FROM media WHERE hash = ?').get(hash)) {
        fs.writeFileSync(path.join(ctx.mediaDir, `${hash}.${ext}`), bytes);
        ctx.db.prepare('INSERT INTO media (hash, path, mime, size, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(hash, rel, mime, bytes.length, now);
      }
      mediaMap.set(name, rel);
    }

    // 所有笔记第一级相同时去掉第一级（就是导出的牌组本身）
    let paths = data.notes.map((n) => n.deckPath);
    const first = paths[0]?.[0];
    if (first !== undefined && paths.every((p) => p.length > 0 && p[0] === first)) {
      paths = paths.map((p) => p.slice(1));
    }

    const pos0 = (ctx.db.prepare('SELECT MAX(position) AS mp FROM items WHERE deck_id = ? AND deleted_at IS NULL')
      .get(deckId) as { mp: number | null }).mp ?? 0;
    let pos = pos0;
    let cards = 0;
    let sections = 0;
    let current: string[] = [];

    ctx.db.transaction(() => {
      for (let i = 0; i < data.notes.length; i++) {
        const p = paths[i];
        if (!samePath(p, current)) {
          // 路径变化：从第一个不同的层级起为每一级补目录
          let d = 0;
          while (d < p.length && d < current.length && p[d] === current[d]) d++;
          for (let j = d; j < p.length; j++) {
            if (!p[j]) continue;
            pos++;
            ctx.db.prepare(`INSERT INTO items (id, deck_id, kind, position, level, title, created_at, updated_at)
              VALUES (?, ?, 'section', ?, ?, ?, ?, ?)`).run(newId(), deckId, pos, Math.min(j + 1, 5), p[j], now, now);
            sections++;
          }
          current = p;
        }
        const fields = data.notes[i].fields.map((f) => ankiToMarkdown(f, mediaMap));
        const front0 = fields[0] ?? '';
        const cloze = front0.includes('{{');
        let front = front0;
        let back: string;
        if (cloze) {
          const f1 = fields[1] ?? '';
          if (f1) front += `\n\n${f1}`;
          back = '';
        } else {
          back = fields.slice(1).filter((f) => f !== '').join('\n\n');
        }
        pos++;
        const cardId = newId();
        ctx.db.prepare(`INSERT INTO items (id, deck_id, kind, position, card_type, front, hint, back, created_at, updated_at)
          VALUES (?, ?, 'card', ?, ?, ?, '', ?, ?, ?)`).run(cardId, deckId, pos, cloze ? 'note' : 'qa', front, back, now, now);
        ctx.db.prepare('INSERT INTO edit_logs (card_id, action, at) VALUES (?, ?, ?)').run(cardId, 'create', now);
        cards++;
      }
      ctx.db.prepare('UPDATE decks SET updated_at = ? WHERE id = ?').run(now, deckId);
    })();

    return { cards, sections };
  });
}

function samePath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
