// 命令行入口：tsx src/cli.ts [--port 18420] [--host 127.0.0.1] [--data ../data] [--web ../web/dist]
import path from 'node:path';
import { buildApp } from './app';
import { autoBackup } from './routes/backup';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const port = Number(arg('port', process.env.BNKI_PORT ?? '18420'));
const host = arg('host', '127.0.0.1');
const dataDir = path.resolve(arg('data', process.env.BNKI_DATA ?? 'data'));
const webDir = arg('web', '');

const { app, ctx } = await buildApp({ dataDir, webDir: webDir ? path.resolve(webDir) : undefined, logger: false });
try {
  autoBackup(ctx);
} catch (e) {
  console.error('自动备份失败：', e);
}
await app.listen({ port, host });
console.log(`bnki 已启动：http://localhost:${port}  数据目录：${dataDir}`);
