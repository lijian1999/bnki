import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { buildApp } from '../app';
import type { Ctx } from '../app';

let tmpDir: string;
let app: any;
let ctx: Ctx;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-media-'));
  ({ app, ctx } = await buildApp({ dataDir: tmpDir, memory: true }));
});

afterEach(async () => {
  await app.close();
  fs.rmSync(tmpDir, { recursive: true });
});

function makeMultipart(filename: string, contentType: string, data: Buffer): { body: Buffer; headers: Record<string, string> } {
  const boundary = '----BnkiTestBoundary123';
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  ];
  const header = Buffer.from(parts[0], 'utf-8');
  const trailer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
  const body = Buffer.concat([header, data, trailer]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('POST /api/media', () => {
  it('上传 PNG → path 格式正确，文件存在，media 表有一行', async () => {
    // PNG 最小文件
    const pngData = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    ]);
    const { body, headers } = makeMultipart('a.png', 'image/png', pngData);
    const res = await app.inject({ method: 'POST', url: '/api/media', payload: body, headers });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.path).toMatch(/^media\/[0-9a-f]{16}\.png$/);

    const filename = json.path.replace('media/', '');
    const filePath = path.join(ctx.mediaDir, filename);
    expect(fs.existsSync(filePath)).toBe(true);

    const rows = ctx.db.prepare('SELECT * FROM media').all();
    expect(rows.length).toBe(1);
  });

  it('同样内容再传一次 → 同一个 path，media 表仍然只有一行', async () => {
    const pngData = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    ]);
    const { body, headers } = makeMultipart('a.png', 'image/png', pngData);
    const res1 = await app.inject({ method: 'POST', url: '/api/media', payload: body, headers });
    const res2 = await app.inject({ method: 'POST', url: '/api/media', payload: body, headers });
    expect(res1.json().path).toBe(res2.json().path);

    const rows = ctx.db.prepare('SELECT * FROM media').all();
    expect(rows.length).toBe(1);
  });

  it('GET /<path> → 200，内容一致', async () => {
    const pngData = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    ]);
    const { body, headers } = makeMultipart('a.png', 'image/png', pngData);
    const res = await app.inject({ method: 'POST', url: '/api/media', payload: body, headers });
    const json = res.json();
    const getUrl = '/' + json.path;
    const res2 = await app.inject({ method: 'GET', url: getUrl });
    expect(res2.statusCode).toBe(200);
    expect(Buffer.compare(res2.rawPayload, pngData)).toBe(0);
  });

  it('上传 text/plain → 400', async () => {
    const data = Buffer.from('hello world', 'utf-8');
    const { body, headers } = makeMultipart('a.txt', 'text/plain', data);
    const res = await app.inject({ method: 'POST', url: '/api/media', payload: body, headers });
    expect(res.statusCode).toBe(400);
  });
});
