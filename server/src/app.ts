// Fastify 应用工厂。路由模块各自导出 register(app, ctx)，在这里统一挂载。
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { openDb, type DB } from './db';
import { HttpError } from './util';
import registerLibrary from './routes/library';
import registerStudy from './routes/study';
import registerStats from './routes/stats';
import registerSettings from './routes/settings';
import registerMedia from './routes/media';
import registerIo from './routes/io';
import registerBackup from './routes/backup';
import registerExport from './routes/export';
import registerApkg from './routes/apkg';
import registerSearch from './routes/search';

export interface Ctx {
  /** 当前数据库连接。恢复备份时会被替换，所以路由里每次请求都要从 ctx.db 取，不要缓存。 */
  db: DB;
  dataDir: string; // 绝对路径
  dbFile: string; // <dataDir>/bnki.sqlite，测试时为 ':memory:'
  mediaDir: string; // <dataDir>/media
  backupsDir: string; // <dataDir>/backups
  /** 关闭并重新打开 dbFile（恢复备份后调用）。 */
  reopen(): void;
  /** 当前时间（毫秒）。测试可以替换。 */
  now(): number;
}

export interface AppOptions {
  dataDir: string;
  /** 测试用：true 时数据库放内存里。 */
  memory?: boolean;
  /** 打包好的前端目录；给了就同时提供静态文件和 SPA 回退。 */
  webDir?: string;
  logger?: boolean;
  now?: () => number;
}

export async function buildApp(opts: AppOptions): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const dataDir = path.resolve(opts.dataDir);
  const mediaDir = path.join(dataDir, 'media');
  const backupsDir = path.join(dataDir, 'backups');
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(backupsDir, { recursive: true });
  const dbFile = opts.memory ? ':memory:' : path.join(dataDir, 'bnki.sqlite');
  const ctx: Ctx = {
    db: openDb(dbFile),
    dataDir,
    dbFile,
    mediaDir,
    backupsDir,
    reopen() {
      ctx.db.close();
      ctx.db = openDb(dbFile);
    },
    now: opts.now ?? (() => Date.now()),
  };

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 50 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      reply.status(err.status).send({ error: err.code, message: err.message });
      return;
    }
    const status = (err as any).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    reply.status(status).send({ error: status >= 500 ? 'internal' : 'bad_request', message: (err as Error).message });
  });

  await app.register(fastifyStatic, { root: mediaDir, prefix: '/media/', decorateReply: false });

  await registerLibrary(app, ctx);
  await registerStudy(app, ctx);
  await registerStats(app, ctx);
  await registerSettings(app, ctx);
  await registerMedia(app, ctx);
  await registerIo(app, ctx);
  await registerBackup(app, ctx);
  await registerExport(app, ctx);
  await registerApkg(app, ctx);
  await registerSearch(app, ctx);

  if (opts.webDir && fs.existsSync(opts.webDir)) {
    await app.register(fastifyStatic, { root: path.resolve(opts.webDir), prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/media/')) {
        return reply.sendFile('index.html');
      }
      reply.status(404).send({ error: 'not_found', message: req.url });
    });
  }

  app.addHook('onClose', async () => { ctx.db.close(); });
  return { app, ctx };
}
