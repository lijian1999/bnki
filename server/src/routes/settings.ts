// 全局设置接口（contracts.md §3.6）。
import type { FastifyInstance } from 'fastify';
import type { Settings } from '@bnki/shared';
import type { Ctx } from '../app';
import { getSettings, putSettings } from '../settings';

export default async function register(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/api/settings', async () => getSettings(ctx.db, ctx.dataDir));

  app.put('/api/settings', async (req) => {
    const patch = (req.body ?? {}) as Partial<Settings>;
    return putSettings(ctx.db, patch, ctx.dataDir);
  });
}
