// 设置接口测试（contracts.md §3.6）。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../app';
import type { Settings } from '@bnki/shared';

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-'));
  return await buildApp({ dataDir: dir, memory: true });
}

describe('settings 接口', () => {
  it('GET 返回默认设置，dataDir 是运行时目录', async () => {
    const { app, ctx } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(200);
    const s = res.json() as Settings & { dataDir: string };
    expect(s.retention).toBe(0.9);
    expect(s.dataDir).toBe(ctx.dataDir);
    await app.close();
  });

  it('PUT 后 GET 能读回新值', async () => {
    const { app } = await setup();
    const put = await app.inject({ method: 'PUT', url: '/api/settings', payload: { retention: 0.85, theme: 'dark' } });
    expect(put.statusCode).toBe(200);
    expect((put.json() as Settings).retention).toBe(0.85);
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    const s = res.json() as Settings;
    expect(s.retention).toBe(0.85);
    expect(s.theme).toBe('dark');
    await app.close();
  });

  it('越界、未知键、非法枚举都返回 400', async () => {
    const { app } = await setup();
    for (const payload of [{ retention: 2 }, { foo: 1 }, { dayHour: 3 }]) {
      const res = await app.inject({ method: 'PUT', url: '/api/settings', payload });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });
});
