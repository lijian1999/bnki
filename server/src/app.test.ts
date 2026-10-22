import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { buildApp } from './app';

describe('buildApp', () => {
  it('能启动，未知 API 返回 404', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-'));
    const { app } = await buildApp({ dataDir: dir, memory: true });
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
