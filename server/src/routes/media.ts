import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app';

export default async function register(app: FastifyInstance, ctx: Ctx): Promise<void> {
  void app; void ctx;
}
