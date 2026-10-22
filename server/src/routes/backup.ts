// 备份与恢复：VACUUM INTO 生成数据库快照 + 复制 media 目录。
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../db';
import type { Ctx } from '../app';
import { notFound, badRequest } from '../util';

export default async function register(app: FastifyInstance, ctx: Ctx): Promise<void> {

  app.get('/api/backups', () => {
    return listBackups(ctx);
  });

  app.post('/api/backup', () => {
    const name = allocBackupName(ctx);
    doBackup(ctx, name);
    return { name };
  });

  app.post('/api/restore', (req) => {
    const { name } = req.body as { name?: string };
    if (!name) throw badRequest('name 必填');
    const backupDir = path.join(ctx.backupsDir, name);
    if (!fs.existsSync(path.join(backupDir, 'bnki.sqlite'))) throw notFound('备份不存在');
    if (ctx.dbFile === ':memory:') throw badRequest('内存库不能恢复');

    // 先备份当前数据
    doBackup(ctx, allocBackupName(ctx) + '-before-restore');

    ctx.db.close();
    fs.copyFileSync(path.join(backupDir, 'bnki.sqlite'), ctx.dbFile);
    // 清理 WAL/SHM
    for (const suffix of ['-wal', '-shm']) {
      const p = ctx.dbFile + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    // 恢复 media
    const backupMedia = path.join(backupDir, 'media');
    if (fs.existsSync(ctx.mediaDir)) fs.rmSync(ctx.mediaDir, { recursive: true });
    if (fs.existsSync(backupMedia)) {
      fs.cpSync(backupMedia, ctx.mediaDir, { recursive: true });
    } else {
      fs.mkdirSync(ctx.mediaDir, { recursive: true });
    }
    ctx.db = openDb(ctx.dbFile);
    return { ok: true };
  });
}

function listBackups(ctx: Ctx) {
  if (!fs.existsSync(ctx.backupsDir)) return [];
  const entries = fs.readdirSync(ctx.backupsDir);
  const result: { name: string; createdAt: number; size: number }[] = [];
  for (const name of entries) {
    const dbPath = path.join(ctx.backupsDir, name, 'bnki.sqlite');
    if (!fs.existsSync(dbPath)) continue;
    const stat = fs.statSync(path.join(ctx.backupsDir, name));
    const dbStat = fs.statSync(dbPath);
    result.push({ name, createdAt: stat.mtimeMs, size: dbStat.size });
  }
  result.sort((a, b) => b.name.localeCompare(a.name));
  return result;
}

function allocBackupName(ctx: Ctx): string {
  const base = backupNameFromTimestamp(ctx.now());
  let name = base;
  let i = 2;
  while (fs.existsSync(path.join(ctx.backupsDir, name))) {
    name = `${base}-${i}`;
    i++;
  }
  return name;
}

function doBackup(ctx: Ctx, name: string): void {
  const dir = path.join(ctx.backupsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const dbTarget = path.join(dir, 'bnki.sqlite');
  const escaped = dbTarget.replace(/'/g, "''");
  ctx.db.exec(`VACUUM INTO '${escaped}'`);
  if (fs.existsSync(ctx.mediaDir)) {
    fs.cpSync(ctx.mediaDir, path.join(dir, 'media'), { recursive: true });
  }
}

function backupNameFromTimestamp(ts: number): string {
  const d = new Date(ts);
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}${m}${day}-${h}${min}${s}`;
}

/** 启动时调用：今天还没有自动备份就备份一次，只保留最近 14 份。 */
export function autoBackup(ctx: Ctx): void {
  if (ctx.dbFile === ':memory:') return;

  const now = ctx.now();
  const today = backupNameFromTimestamp(now).slice(0, 8); // YYYYMMDD

  // 检查今天是否已有不带 -before-restore 的备份
  const entries = fs.existsSync(ctx.backupsDir) ? fs.readdirSync(ctx.backupsDir) : [];
  const todayExists = entries.some(e =>
    e.startsWith(today) && !e.includes('-before-restore') &&
    fs.existsSync(path.join(ctx.backupsDir, e, 'bnki.sqlite'))
  );
  if (!todayExists) {
    const name = allocBackupName(ctx);
    doBackup(ctx, name);
  }

  // 只保留按名字降序的前 14 个不带 -before-restore 的备份
  const allEntries = fs.readdirSync(ctx.backupsDir)
    .filter(e => !e.includes('-before-restore') && fs.existsSync(path.join(ctx.backupsDir, e, 'bnki.sqlite')));
  allEntries.sort((a, b) => b.localeCompare(a));
  const toDelete = allEntries.slice(14);
  for (const name of toDelete) {
    fs.rmSync(path.join(ctx.backupsDir, name), { recursive: true });
  }
}
