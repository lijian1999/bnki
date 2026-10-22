// 媒体上传：POST /api/media，存到 ctx.mediaDir 并写 media 表。
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { Ctx } from '../app';
import { badRequest } from '../util';

export default async function register(app: FastifyInstance, ctx: Ctx): Promise<void> {

  app.post('/api/media', async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('没有上传文件');
    if (!file.mimetype.startsWith('image/')) throw badRequest('只接受图片文件');
    const buf = await file.toBuffer();
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    const ext = extFromMime(file.mimetype, file.filename);
    const filename = `${hash}.${ext}`;
    const relativePath = `media/${filename}`;

    const exists = ctx.db.prepare('SELECT hash FROM media WHERE hash = ?').get(hash);
    if (!exists) {
      const fullPath = path.join(ctx.mediaDir, filename);
      fs.writeFileSync(fullPath, buf);
      ctx.db.prepare('INSERT INTO media (hash, path, mime, size, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(hash, relativePath, file.mimetype, buf.length, ctx.now());
    }
    return { path: relativePath };
  });
}

function extFromMime(mime: string, originalName: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  };
  if (map[mime]) return map[mime];
  const ext = path.extname(originalName).replace('.', '').toLowerCase();
  return ext || 'png';
}
