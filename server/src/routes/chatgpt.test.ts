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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnki-chatgpt-'));
  ({ app, ctx } = await buildApp({ dataDir: tmpDir, memory: true, now: () => 1_700_000_000_000 }));
});

afterEach(async () => {
  await app.close();
  fs.rmSync(tmpDir, { recursive: true });
});

function insertDeck(title = 'Docker'): string {
  const id = 'deck1';
  ctx.db.prepare(`INSERT INTO decks (id, title, description, created_at, updated_at) VALUES (?, ?, '', ?, ?)`)
    .run(id, title, 1_700_000_000_000, 1_700_000_000_000);
  return id;
}

function conversation(answers: string[]): Record<string, unknown> {
  const messages: Record<string, unknown>[] = [];
  let i = 0;
  for (const answer of answers) {
    messages.push({
      id: `u${i}`,
      author: { role: 'user' },
      content: { content_type: 'text', parts: [`问题 ${i}`] },
    });
    messages.push({
      id: `a${i}`,
      author: { role: 'assistant' },
      content: { content_type: 'text', parts: [answer] },
    });
    i++;
  }
  return { conversation_id: 'conv-test', messages };
}

const DIAGRAM = `<box border radius="lg" padding={3} gap={2}>
  <text color="secondary" weight="medium" size="xs">运行关系示意</text>
  <box background="surface-secondary" radius="md" padding={3} gap={2} align="center">
    <box background="surface" border radius="md" padding={3} width="85%" align="center" gap={1}>
      **宿主机终端**

      <text size="xs" color="secondary">输入 docker run -it ubuntu bash</text>
    </box>
    <icon name="arrow-down-up" color="secondary" size="lg"/>
    <box border={{size:2,color:"info"}} radius="md" padding={3} width="100%" align="center" gap={2}>
      <text weight="medium">Docker 容器</text>
      <box background="surface-secondary" radius="md" padding={3} width="85%" align="center" gap={1}>
        **Bash 进程**

        <badge color="info">容器主进程 PID 1</badge>
      </box>
    </box>
  </box>
  <caption>当前终端连接到容器内的 Bash，不代表容器本身就是一个终端。</caption>
</box>`;

const CHOICE = `<box gap={2}>
  <radio-group direction="col" value={answer} onChange={setAnswer}>
    <radio value="a">A. 只关闭 Bash，容器仍然运行。</radio>
    <radio value="b">B. Bash 退出，同时容器停止运行。</radio>
  </radio-group>
  <row justify="end">
    <button onClick={()=>GenUI.issueNewTurn("x")}>提交答案</button>
  </row>
</box>`;

const MARKDOWN = `## 一、标题

**加粗** 和 \`行内代码\`。

- 列表项 1
- 列表项 2

| 命令 | 效果 |
|---|---|
| \`docker ps\` | 查看容器 |

\`\`\`bash
docker ps
\`\`\`

${DIAGRAM}

${CHOICE}`;

describe('POST /api/import/chatgpt', () => {
  it('带网页截图导入：图示用截图，不再重画', async () => {
    const deckId = insertDeck();
    // 1x1 白色 PNG（真实截图的最小替身）
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    const conv = conversation([DIAGRAM]);
    const messageId = 'a0';
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/chatgpt',
      payload: {
        deckId,
        source: 'json',
        conversation: conv,
        images: [{ messageId, domIndex: 0, type: 'box', dataUrl }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cards: 1, media: 1, fallback: 0 });

    const front = (ctx.db.prepare(`SELECT front FROM items WHERE deck_id = ? AND kind = 'card'`).get(deckId) as any).front;
    expect(front).toMatch(/!\[\]\(media\/[0-9a-f]{16}\.png\)/);
    expect(front).not.toMatch(/!\[\]\(media\/[0-9a-f]{16}\.svg\)/);

    const media = ctx.db.prepare('SELECT * FROM media').all() as any[];
    expect(media.length).toBe(1);
    expect(media[0].mime).toBe('image/png');
    expect(fs.existsSync(path.join(tmpDir, media[0].path))).toBe(true);
  });

  it('公式块用截图替换', async () => {
    const deckId = insertDeck();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/chatgpt',
      payload: {
        deckId,
        source: 'json',
        conversation: conversation(['公式如下：\n\n\\[\nP=(2,0,0)\n\\]\n\n结束。']),
        images: [{ messageId: 'a0', domIndex: 0, type: 'math', dataUrl }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cards: 1, media: 1, fallback: 0 });
    const front = (ctx.db.prepare(`SELECT front FROM items WHERE deck_id = ? AND kind = 'card'`).get(deckId) as any).front;
    expect(front).toMatch(/!\[\]\(media\/[0-9a-f]{16}\.png\)/);
    expect(front).not.toContain('\\[');
    expect(front).toContain('结束。');
  });

  it('mermaid 代码块用截图替换', async () => {
    const deckId = insertDeck();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    const text = '管理模型：\n\n```mermaid\nflowchart TD\n    A --> B\n```\n\n注意：退出 Bash 是进程层面的操作。';
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/chatgpt',
      payload: {
        deckId,
        source: 'json',
        conversation: conversation([text]),
        images: [{ messageId: 'a0', domIndex: 0, type: 'mermaid', dataUrl }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cards: 1, media: 1, fallback: 0 });
    const front = (ctx.db.prepare(`SELECT front FROM items WHERE deck_id = ? AND kind = 'card'`).get(deckId) as any).front;
    expect(front).toMatch(/!\[\]\(media\/[0-9a-f]{16}\.png\)/);
    expect(front).not.toContain('flowchart TD');
    expect(front).toContain('注意：退出 Bash 是进程层面的操作。');
  });

  it('mermaid 采集不到时保留源码', async () => {
    const deckId = insertDeck();
    const text = '```mermaid\nflowchart TD\n    A --> B\n```';
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/chatgpt',
      payload: { deckId, source: 'json', conversation: conversation([text]) },
    });
    expect(res.statusCode).toBe(200);
    const front = (ctx.db.prepare(`SELECT front FROM items WHERE deck_id = ? AND kind = 'card'`).get(deckId) as any).front;
    expect(front).toContain('flowchart TD');
  });

  it('每条 AI 回答一张笔记卡，Markdown 保留，图示变成 SVG 图片', async () => {
    const deckId = insertDeck();
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/chatgpt',
      payload: { deckId, source: 'json', conversation: conversation([MARKDOWN]) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cards: 1, media: 1, fallback: 1 });

    const items = ctx.db.prepare(`SELECT * FROM items WHERE deck_id = ? AND kind = 'card' ORDER BY position`).all(deckId) as any[];
    expect(items.length).toBe(1);
    expect(items[0].card_type).toBe('note');
    const front: string = items[0].front;

    // 文字格式保留
    expect(front).toContain('## 一、标题');
    expect(front).toContain('**加粗**');
    expect(front).toContain('`行内代码`');
    expect(front).toContain('- 列表项 1');
    expect(front).toContain('| 命令 | 效果 |');
    expect(front).toContain('```bash\ndocker ps\n```');

    // 图示变成图片，选择题保留静态文字
    expect(front).toMatch(/!\[\]\(media\/[0-9a-f]{16}\.svg\)/);
    expect(front).toContain('A. 只关闭 Bash，容器仍然运行。');
    expect(front).toContain('B. Bash 退出，同时容器停止运行。');
    expect(front).toContain('提交答案');
    expect(front).not.toContain('<box');
    expect(front).not.toContain('<radio');
    expect(front).not.toContain('<button');

    // 媒体文件存在，SVG 里包含图示文字
    const mediaRows = ctx.db.prepare('SELECT * FROM media').all() as any[];
    expect(mediaRows.length).toBe(1);
    const svgPath = path.join(tmpDir, mediaRows[0].path);
    expect(fs.existsSync(svgPath)).toBe(true);
    const svg = fs.readFileSync(svgPath, 'utf8');
    expect(svg).toContain('<foreignObject');
    expect(svg).toContain('运行关系示意');
    expect(svg).toContain('宿主机终端');
    expect(svg).toContain('Docker 容器');
    expect(svg).toContain('Bash 进程');
    expect(svg).toContain('容器主进程 PID 1');
    expect(svg).toContain('当前终端连接到容器内的 Bash');
  });

  it('多条回答按顺序建卡', async () => {
    const deckId = insertDeck();
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/chatgpt',
      payload: { deckId, source: 'json', conversation: conversation(['第一段', '第二段']) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().cards).toBe(2);
    const items = ctx.db.prepare(`SELECT front FROM items WHERE deck_id = ? AND kind = 'card' ORDER BY position`).all(deckId) as any[];
    expect(items.map((i) => i.front)).toEqual(['第一段', '第二段']);
  });

  it('重复导入不重复建卡，内容没变就不写库', async () => {
    const deckId = insertDeck();
    const conv = conversation([MARKDOWN]);
    const first = await app.inject({ method: 'POST', url: '/api/import/chatgpt', payload: { deckId, source: 'json', conversation: conv } });
    expect(first.statusCode).toBe(200);
    const before = ctx.db.prepare(`SELECT id, front, updated_at FROM items WHERE deck_id = ? AND kind = 'card'`).get(deckId) as any;
    const second = await app.inject({ method: 'POST', url: '/api/import/chatgpt', payload: { deckId, source: 'json', conversation: conv } });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ cards: 1, media: 1, fallback: 1 });

    const items = ctx.db.prepare(`SELECT id, front, updated_at FROM items WHERE deck_id = ? AND kind = 'card'`).all(deckId) as any[];
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(before.id);
    expect(items[0].front).toBe(before.front);
    expect(items[0].updated_at).toBe(before.updated_at);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM media').get() as any).toEqual({ n: 1 });
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM edit_logs WHERE action = ?').get('update') as any).toEqual({ n: 0 });
  });

  it('重复导入不覆盖用户改过的卡片', async () => {
    const deckId = insertDeck();
    const conv = conversation([MARKDOWN]);
    const first = await app.inject({ method: 'POST', url: '/api/import/chatgpt', payload: { deckId, source: 'json', conversation: conv } });
    expect(first.statusCode).toBe(200);
    const card = ctx.db.prepare(`SELECT id FROM items WHERE deck_id = ? AND kind = 'card'`).get(deckId) as any;
    ctx.db.prepare('UPDATE items SET front = ? WHERE id = ?').run('用户改过的内容', card.id);

    const second = await app.inject({ method: 'POST', url: '/api/import/chatgpt', payload: { deckId, source: 'json', conversation: conv } });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ cards: 1, media: 1, fallback: 1 });
    const after = ctx.db.prepare(`SELECT front FROM items WHERE id = ?`).get(card.id) as any;
    expect(after.front).toBe('用户改过的内容');
  });

  it('相同提问不查重，每条回答各建一张卡', async () => {
    const deckId = insertDeck();
    const conv = {
      conversation_id: 'conv-dup',
      messages: [
        { id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['同一个问题'] } },
        { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['第一个回答'] } },
        { id: 'u2', author: { role: 'user' }, content: { content_type: 'text', parts: ['同一个问题？'] } },
        { id: 'a2', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['第二个回答'] } },
      ],
    };
    const res = await app.inject({ method: 'POST', url: '/api/import/chatgpt', payload: { deckId, source: 'json', conversation: conv } });
    expect(res.statusCode).toBe(200);
    expect(res.json().cards).toBe(2);
    const items = ctx.db.prepare(`SELECT front FROM items WHERE deck_id = ? AND kind = 'card' ORDER BY position`).all(deckId) as any[];
    expect(items.map((i) => i.front)).toEqual(['第一个回答', '第二个回答']);
  });

  it('{@body 初始化代码之前的正文不会被丢掉', async () => {
    const deckId = insertDeck();
    const content = `## 一、标题

正文第一段。

{@body const [answer,setAnswer] = DIL.useState("b")}
<box gap={2}>
  <radio-group direction="col">
    <radio value="a">A. 选项一</radio>
    <radio value="b">B. 选项二</radio>
  </radio-group>
  <button>提交答案</button>
</box>

结尾。`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/chatgpt',
      payload: { deckId, source: 'json', conversation: conversation([content]) },
    });
    expect(res.statusCode).toBe(200);
    const front = (ctx.db.prepare(`SELECT front FROM items WHERE deck_id = ? AND kind = 'card'`).get(deckId) as any).front;
    expect(front).toContain('## 一、标题');
    expect(front).toContain('正文第一段。');
    expect(front).toContain('A. 选项一');
    expect(front).toContain('B. 选项二');
    expect(front).toContain('提交答案');
    expect(front).toContain('结尾。');
    expect(front).not.toContain('{@body');
  });

  it('Cite 保留成灰色占位文字', async () => {
    const deckId = insertDeck();
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/chatgpt',
      payload: { deckId, source: 'json', conversation: conversation(['参考 <Cite refs={["1"]}/> 的说法。']) },
    });
    expect(res.statusCode).toBe(200);
    const front = (ctx.db.prepare(`SELECT front FROM items WHERE deck_id = ? AND kind = 'card'`).get(deckId) as any).front;
    expect(front).toContain('〔引用〕');
    expect(front).not.toContain('<Cite');
  });

  it('卡片集不存在 → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/chatgpt',
      payload: { deckId: 'noexist', source: 'json', conversation: conversation(['x']) },
    });
    expect(res.statusCode).toBe(404);
  });

  it('没有 conversation → 400', async () => {
    const deckId = insertDeck();
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/chatgpt',
      payload: { deckId, source: 'json' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('没有 AI 回答 → 400', async () => {
    const deckId = insertDeck();
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/chatgpt',
      payload: { deckId, source: 'json', conversation: { conversation_id: 'x', messages: [] } },
    });
    expect(res.statusCode).toBe(400);
  });
});
