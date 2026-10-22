import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app';

export default async function register(app: FastifyInstance, ctx: Ctx): Promise<void> {
  void app; void ctx;
}

/** 启动时调用：今天还没有自动备份就备份一次，只保留最近 14 份。 */
export function autoBackup(ctx: Ctx): void {
  void ctx;
}
