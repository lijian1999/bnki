// 全局搜索卡片内容（items_fts，trigram 分词，大小写不敏感）。
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app';

export interface SearchHit {
  id: string;
  deckId: string;
  deckTitle: string;
  cardType: string;
  front: string;
  text: string;
}

export default async function register(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/api/search', async (req) => {
    const q = req.query as { q?: string; limit?: string };
    const kw = (q.q ?? '').replace(/\s+/g, '');
    if (!kw) return [];
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 30));
    // LIKE 走 trigram 索引（3 个字以上）；短词退化成扫描，数据量小无所谓
    const pattern = '%' + kw.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    const rows = ctx.db.prepare(`
      SELECT i.id, i.deck_id, d.title AS deck_title, i.card_type, i.front, f.text
      FROM items_fts f
      JOIN items i ON i.rowid = f.rowid AND i.deleted_at IS NULL
      JOIN decks d ON d.id = i.deck_id AND d.deleted_at IS NULL
      WHERE f.key LIKE ? ESCAPE '\\'
      ORDER BY i.updated_at DESC
      LIMIT ?`).all(pattern, limit) as {
      id: string; deck_id: string; deck_title: string; card_type: string; front: string; text: string;
    }[];
    return rows.map((r): SearchHit => ({
      id: r.id, deckId: r.deck_id, deckTitle: r.deck_title, cardType: r.card_type, front: r.front ?? '', text: r.text,
    }));
  });
}
