// 导入接口：文本 / Markdown 导入卡片。
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Ctx } from '../app';
import { newId, notFound, badRequest } from '../util';
import { parseImportText } from '@bnki/shared/importText';
import { frontHash, renderAnswerMarkdownWithImages, selectAssistantMessages, type CapturedImage } from '../import/chatgpt';

interface ImportRow { section: string | null; front: string; back: string }
interface MdStep { type: 'section' | 'card'; level?: number; title?: string; front?: string }

export default async function register(app: FastifyInstance, ctx: Ctx): Promise<void> {

  app.post('/api/import/text', async (req) => {
    const body = req.body as { deckId?: string; text?: string; format?: string; firstColumnIsSection?: boolean };
    const { deckId, text = '', format = 'tsv', firstColumnIsSection = false } = body;
    if (!deckId) throw badRequest('deckId 必填');
    assertDeckExists(ctx, deckId);
    if (format !== 'tsv' && format !== 'csv') throw badRequest('format 必须是 tsv 或 csv');
    const rows = parseImportText(text, format, firstColumnIsSection);
    if (rows.length === 0) throw badRequest('没有解析出卡片');

    const now = ctx.now();
    let pos = getMaxPosition(ctx, deckId);
    let sectionsCount = 0;
    let lastSection: string | null | undefined = undefined;

    ctx.db.transaction(() => {
    for (const row of rows) {
      if (row.section !== null && row.section !== undefined) {
        if (row.section !== lastSection) {
          pos++;
          const sid = newId();
          ctx.db.prepare(`INSERT INTO items (id, deck_id, kind, position, level, title, created_at, updated_at)
            VALUES (?, ?, 'section', ?, 1, ?, ?, ?)`).run(sid, deckId, pos, row.section, now, now);
          sectionsCount++;
        }
        lastSection = row.section;
      }
      pos++;
      const cardId = newId();
      const cardType = row.back ? 'qa' : 'note';
      ctx.db.prepare(`INSERT INTO items (id, deck_id, kind, position, card_type, front, hint, back, created_at, updated_at)
        VALUES (?, ?, 'card', ?, ?, ?, '', ?, ?, ?)`).run(cardId, deckId, pos, cardType, row.front, row.back, now, now);
      ctx.db.prepare('INSERT INTO edit_logs (card_id, action, at) VALUES (?, ?, ?)').run(cardId, 'create', now);
    }
    ctx.db.prepare('UPDATE decks SET updated_at = ? WHERE id = ?').run(now, deckId);
    })();
    return { cards: rows.length, sections: sectionsCount };
  });

  app.post('/api/import/chatgpt', async (req) => {
    const body = req.body as { deckId?: string; source?: string; conversation?: unknown; images?: CapturedImage[] };
    const { deckId, source = 'json', conversation, images = [] } = body;
    if (!deckId) throw badRequest('deckId 必填');
    const deck = ctx.db.prepare('SELECT id, display_cfg FROM decks WHERE id = ? AND deleted_at IS NULL').get(deckId) as
      | { id: string; display_cfg: string }
      | undefined;
    if (!deck) throw notFound('卡片集不存在');
    if (source !== 'json') throw badRequest('source 必须是 json');
    if (!conversation || typeof conversation !== 'object') throw badRequest('conversation 必填');
    if (!Array.isArray(images)) throw badRequest('images 必须是数组');

    // 网页截图按消息分组：每条回答只用自己的图。
    const imagesByMessage = new Map<string, CapturedImage[]>();
    for (const im of images) {
      if (!im || typeof im !== 'object') continue;
      const mid = String((im as CapturedImage).messageId ?? '');
      if (!mid) continue;
      const list = imagesByMessage.get(mid) ?? [];
      list.push(im as CapturedImage);
      imagesByMessage.set(mid, list);
    }

    const conv = conversation as Record<string, unknown>;
    const conversationId = String(conv.conversation_id ?? conv.id ?? '');
    const messages = selectAssistantMessages(conv);
    if (messages.length === 0) throw badRequest('没有找到 AI 回答');

    const now = ctx.now();
    const displayCfg = JSON.parse(deck.display_cfg || '{}') as Record<string, unknown>;
    type CardMeta = { cardId: string; frontHash: string };
    const meta = (displayCfg.chatgptImport ?? {}) as {
      conversationId?: string;
      cards?: Record<string, string | CardMeta>;
    };
    const existing = meta.conversationId === conversationId ? { ...(meta.cards ?? {}) } : {};
    let pos = getMaxPosition(ctx, deckId);
    let cards = 0;
    let media = 0;
    let fallback = 0;

    ctx.db.transaction(() => {
      for (const msg of messages) {
        const rendered = renderAnswerMarkdownWithImages(msg.text, imagesByMessage.get(msg.id) ?? [], {
          saveMedia: (bytes, mime) => saveChatgptMediaBytes(ctx, bytes, mime),
        });
        media += rendered.media;
        fallback += rendered.fallback;
        const hash = frontHash(rendered.markdown);
        const entry = existing[msg.id];
        const cardId = typeof entry === 'string' ? entry : entry?.cardId;
        const storedHash = typeof entry === 'object' ? entry.frontHash : null;
        if (cardId) {
          const row = ctx.db.prepare('SELECT id, front, deleted_at FROM items WHERE id = ? AND kind = ?').get(cardId, 'card') as
            | { id: string; front: string; deleted_at: number | null }
            | undefined;
          if (row && row.deleted_at === null) {
            // 内容没变就不写库；用户改过的卡片也不覆盖，避免重复导入冲掉编辑。
            if (row.front !== rendered.markdown && (storedHash === null || frontHash(row.front) === storedHash)) {
              ctx.db.prepare('UPDATE items SET front = ?, updated_at = ? WHERE id = ?').run(rendered.markdown, now, cardId);
              ctx.db.prepare('INSERT INTO edit_logs (card_id, action, at) VALUES (?, ?, ?)').run(cardId, 'update', now);
            }
            existing[msg.id] = { cardId, frontHash: hash };
            cards++;
            continue;
          }
        }
        pos++;
        const id = newId();
        ctx.db.prepare(`INSERT INTO items (id, deck_id, kind, position, card_type, front, hint, back, created_at, updated_at)
          VALUES (?, ?, 'card', ?, 'note', ?, '', '', ?, ?)`).run(id, deckId, pos, rendered.markdown, now, now);
        ctx.db.prepare('INSERT INTO edit_logs (card_id, action, at) VALUES (?, ?, ?)').run(id, 'create', now);
        existing[msg.id] = { cardId: id, frontHash: hash };
        cards++;
      }
      displayCfg.chatgptImport = { conversationId, cards: existing };
      ctx.db.prepare('UPDATE decks SET display_cfg = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(displayCfg), now, deckId);
    })();
    return { cards, media, fallback };
  });

  app.post('/api/import/markdown', async (req) => {
    const body = req.body as { deckId?: string; text?: string; split?: string };
    const { deckId, text = '', split = 'paragraph' } = body;
    if (!deckId) throw badRequest('deckId 必填');
    assertDeckExists(ctx, deckId);
    if (split !== 'item' && split !== 'paragraph' && split !== 'hr') throw badRequest('split 必须是 item、paragraph 或 hr');
    const steps = parseMarkdown(text, split);
    const cardCount = steps.filter(s => s.type === 'card').length;
    if (cardCount === 0) throw badRequest('没有解析出卡片');

    const now = ctx.now();
    let pos = getMaxPosition(ctx, deckId);
    let sectionsCount = 0;

    ctx.db.transaction(() => {
    for (const step of steps) {
      pos++;
      if (step.type === 'section') {
        const sid = newId();
        ctx.db.prepare(`INSERT INTO items (id, deck_id, kind, position, level, title, created_at, updated_at)
          VALUES (?, ?, 'section', ?, ?, ?, ?, ?)`).run(sid, deckId, pos, step.level, step.title, now, now);
        sectionsCount++;
      } else {
        const cardId = newId();
        ctx.db.prepare(`INSERT INTO items (id, deck_id, kind, position, card_type, front, hint, back, created_at, updated_at)
          VALUES (?, ?, 'card', ?, 'note', ?, '', '', ?, ?)`).run(cardId, deckId, pos, step.front, now, now);
        ctx.db.prepare('INSERT INTO edit_logs (card_id, action, at) VALUES (?, ?, ?)').run(cardId, 'create', now);
      }
    }
    ctx.db.prepare('UPDATE decks SET updated_at = ? WHERE id = ?').run(now, deckId);
    })();
    return { cards: cardCount, sections: sectionsCount };
  });
}

function assertDeckExists(ctx: Ctx, deckId: string): void {
  const deck = ctx.db.prepare('SELECT id FROM decks WHERE id = ? AND deleted_at IS NULL').get(deckId);
  if (!deck) throw notFound('卡片集不存在');
}

/** 保存网页采集到的图片字节（PNG/JPEG）：按内容哈希去重。 */
function saveChatgptMediaBytes(ctx: Ctx, bytes: Buffer, mime: string): { path: string; created: boolean } {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'png';
  const filename = `${hash}.${ext}`;
  const relativePath = `media/${filename}`;
  const exists = ctx.db.prepare('SELECT hash FROM media WHERE hash = ?').get(hash);
  if (exists) return { path: relativePath, created: false };
  fs.writeFileSync(path.join(ctx.mediaDir, filename), bytes);
  ctx.db.prepare('INSERT INTO media (hash, path, mime, size, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(hash, relativePath, mime, bytes.length, ctx.now());
  return { path: relativePath, created: true };
}

function getMaxPosition(ctx: Ctx, deckId: string): number {
  const r = ctx.db.prepare('SELECT MAX(position) AS mp FROM items WHERE deck_id = ? AND deleted_at IS NULL').get(deckId) as { mp: number | null };
  return r?.mp ?? 0;
}

/**
 * 解析 Markdown 为有序的 step 序列（section 和 card 交错）。
 */
function parseMarkdown(text: string, split: 'item' | 'paragraph' | 'hr'): MdStep[] {
  const lines = text.split(/\r?\n/);
  const steps: MdStep[] = [];
  let i = 0;
  let inCodeBlock = false;
  let contentLines: string[] = [];

  function flushContent() {
    if (contentLines.length === 0) return;
    const joined = contentLines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    if (joined.trim()) {
      const cards = extractCards(joined, split);
      for (const c of cards) steps.push({ type: 'card', front: c });
    }
    contentLines = [];
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      contentLines.push(line);
      inCodeBlock = !inCodeBlock;
      i++;
      continue;
    }
    if (inCodeBlock) {
      contentLines.push(line);
      i++;
      continue;
    }
    const headingMatch = line.match(/^(#{1,5}) (.*)$/);
    if (headingMatch) {
      flushContent();
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      steps.push({ type: 'section', level, title });
      i++;
      continue;
    }
    contentLines.push(line);
    i++;
  }
  flushContent();
  return steps;
}

function extractCards(content: string, split: 'item' | 'paragraph' | 'hr'): string[] {
  if (split === 'hr') {
    const parts = content.split(/^-{3,}$/m);
    return parts.map(p => p.replace(/^\n+/, '').replace(/\n+$/, '')).filter(s => s.trim());
  }
  if (split === 'item') {
    return splitItems(content);
  }
  // paragraph
  return splitParagraphs(content);
}

function splitItems(content: string): string[] {
  const lines = content.split('\n');
  const cards: string[] = [];
  let current: string[] = [];
  let inCode = false;
  let indent = 0; // 当前列表项内容的缩进（标记宽度），续行去掉这么多空格

  const dedent = (l: string) => l.replace(new RegExp(`^ {0,${indent}}`), '');
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCode = !inCode;
      current.push(dedent(line));
      continue;
    }
    if (inCode) {
      current.push(dedent(line));
      continue;
    }
    const marker = /^([-*+]|\d+\.)\s+/.exec(line);
    if (marker) {
      // 顶层列表项
      if (current.length > 0) cards.push(current.join('\n').replace(/^\n+/, '').replace(/\n+$/, ''));
      indent = marker[0].length;
      current = [line.slice(indent)];
    } else if (current.length > 0 && /^\s+\S/.test(line)) {
      // 缩进行：属于当前卡片
      current.push(dedent(line));
    } else {
      // 非列表内容
      indent = 0;
      if (current.length > 0) {
        cards.push(current.join('\n').replace(/^\n+/, '').replace(/\n+$/, ''));
        current = [];
      }
      if (line.trim() !== '') {
        current.push(line);
      }
    }
  }
  if (current.length > 0) {
    const text = current.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    if (text.trim()) cards.push(text);
  }
  return cards;
}

function splitParagraphs(content: string): string[] {
  const lines = content.split('\n');
  const parts: string[][] = [];
  let current: string[] = [];
  let inCode = false;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCode = !inCode;
      current.push(line);
      continue;
    }
    if (inCode) {
      current.push(line);
      continue;
    }
    if (line.trim() === '') {
      if (current.length > 0) {
        parts.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) parts.push(current);
  return parts.map(p => p.join('\n').replace(/^\n+/, '').replace(/\n+$/, '')).filter(s => s.trim());
}
