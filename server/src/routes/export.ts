// 导出：GET /api/export/:deckId → md / html / csv / json 四种文件下载。
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app';
import type { Item } from '@bnki/shared';
import { notFound, badRequest } from '../util';
import { rowToItem } from '../mappers';
import { buildCsv, buildHtml, buildJson, buildMarkdown, fileExtension, filterSections } from '../export/formats';
import type { BuildOptions, ExportFormat } from '../export/formats';

const FORMATS: readonly ExportFormat[] = ['md', 'html', 'csv', 'json'];

const CONTENT_TYPE: Record<ExportFormat, string> = {
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

/** 查询参数同名多值时取第一个 */
function one(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined;
  return undefined;
}

function parseFormat(v: string | undefined): ExportFormat {
  const f = v ?? 'md';
  if (!(FORMATS as readonly string[]).includes(f)) throw badRequest(`不支持的导出格式：${f}`);
  return f as ExportFormat;
}

function parseSections(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/** 未删除卡片集的条目，按 position */
function deckItems(ctx: Ctx, deckId: string): Item[] {
  const rows = ctx.db
    .prepare('SELECT * FROM items WHERE deck_id = ? AND deleted_at IS NULL ORDER BY position')
    .all(deckId) as Record<string, unknown>[];
  return rows.map(rowToItem);
}

export default async function register(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/api/export/:deckId', async (req, reply) => {
    const deckId = (req.params as { deckId: string }).deckId;
    const q = (req.query ?? {}) as Record<string, unknown>;
    const format = parseFormat(one(q.format));
    const cloze = one(q.cloze) === 'answer' ? 'answer' : 'keep';

    const deck = ctx.db.prepare('SELECT title, description, deleted_at FROM decks WHERE id = ?').get(deckId) as
      | { title: string; description: string; deleted_at: number | null }
      | undefined;
    if (!deck || deck.deleted_at != null) throw notFound('卡片集不存在');

    const items = filterSections(deckItems(ctx, deckId), parseSections(one(q.sections)));
    const opts: BuildOptions = {
      cloze,
      inline: one(q.inline) === '1',
      mediaDir: ctx.mediaDir,
      now: ctx.now,
    };
    const body =
      format === 'md' ? buildMarkdown({ title: deck.title, description: deck.description }, items, opts)
      : format === 'html' ? buildHtml({ title: deck.title, description: deck.description }, items, opts)
      : format === 'csv' ? buildCsv(items, opts)
      : buildJson({ title: deck.title, description: deck.description }, items, opts);

    reply.header('content-type', CONTENT_TYPE[format]);
    // inline=1 时浏览器里直接打开（HTML 打印），不加下载头
    if (!opts.inline) {
      const name = encodeURIComponent(`${deck.title}${fileExtension(format)}`);
      reply.header('content-disposition', `attachment; filename*=UTF-8''${name}`);
    }
    return reply.send(body);
  });
}
