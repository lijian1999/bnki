// 四种导出格式的生成函数：卡片集介绍、目录层级、挖空处理都集中在这里。
import fs from 'node:fs';
import path from 'node:path';
import { CARD_TYPE_NAMES, type CardItem, type Item } from '@bnki/shared';
import { renderMarkdown } from '@bnki/shared/markdown';
import { applyCloze, type ClozeMode, type ExportDeck, type ExportFormat } from './common';

export type { ClozeMode, ExportDeck, ExportFormat } from './common';

/** KaTeX 的 CDN 地址；跟 shared/package.json 里声明的 katex 版本保持一致 */
const KATEX_VERSION = '0.16.25';

const EXT: Record<ExportFormat, string> = { md: '.md', html: '.html', csv: '.csv', json: '.json' };

export function fileExtension(format: ExportFormat): string {
  return EXT[format];
}

export interface BuildOptions {
  cloze: ClozeMode;
  /** HTML 导出时把 `/media/...` 换成 data: URL 用的目录 */
  mediaDir?: string;
  /** 打印模式：加载完自动调起打印 */
  inline?: boolean;
  now?: () => number;
}

/** 目录标题的 `#` 个数 / 标签：目录本身占一级，所以是 level + 1，最深 6 级 */
function hashes(level: number): string {
  return '#'.repeat(Math.min(6, level + 1));
}

function headingTag(level: number): string {
  return `h${Math.min(6, level + 1)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 纯文本：转义后保留换行，介绍和主题卡片的内容用 */
function plainTextHtml(s: string): string {
  return escapeHtml(s ?? '').replace(/\n/g, '<br>\n');
}

/**
 * 只保留选中目录的块：目录本身 + 到下一个同级或更高级目录之前。
 * 多个块按原顺序合并、去重。
 */
export function filterSections(items: Item[], sectionIds: string[]): Item[] {
  if (sectionIds.length === 0) return items;
  const index = new Map(items.map((it, i) => [it.id, i]));
  const keep = new Set<number>();
  for (const id of new Set(sectionIds)) {
    const start = index.get(id);
    const sec = start === undefined ? undefined : items[start];
    if (start === undefined || !sec || sec.kind !== 'section') continue;
    keep.add(start);
    for (let j = start + 1; j < items.length; j++) {
      const it = items[j];
      if (it.kind === 'section' && it.level <= sec.level) break;
      keep.add(j);
    }
  }
  return items.filter((_, i) => keep.has(i));
}

/** Markdown：照原型 exportDialog 的 build，目录 `#` = min(6, level + 1)，卡片之间用 `---` 分开 */
export function buildMarkdown(deck: ExportDeck, items: Item[], opts: BuildOptions): string {
  const fix = (s: string): string => applyCloze(s, opts.cloze);
  const out: string[] = [`# ${deck.title}`, ''];
  if (deck.description) out.push(deck.description, '');
  for (const it of items) {
    if (it.kind === 'section') {
      out.push(`${hashes(it.level)} ${it.title}`, '');
    } else if (it.cardType === 'qa') {
      out.push(`**Q:** ${fix(it.front)}`, '');
      if (it.hint) out.push(`> 提示：${fix(it.hint)}`, '');
      out.push(`**A:** ${fix(it.back)}`, '', '---', '');
    } else if (it.cardType === 'topic') {
      out.push(`**${fix(it.front)}**`, '', fix(it.back), '', '---', '');
    } else {
      out.push(fix(it.front), '', '---', '');
    }
  }
  return out.join('\n');
}

const HTML_STYLE = `
  body { max-width: 860px; margin: 0 auto; padding: 40px 48px 64px; color: #1f2328;
    font: 15px/1.8 -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 27px; margin: 0 0 18px; }
  h2, h3, h4, h5, h6 { margin: 30px 0 12px; line-height: 1.35; }
  .deck-desc { color: #57606a; margin: 0 0 26px; }
  .card { border: 1px solid #d8dee4; border-radius: 10px; padding: 14px 18px; margin: 14px 0; break-inside: avoid; }
  .card > :first-child { margin-top: 0; }
  .card hr { border: 0; border-top: 1px solid #d8dee4; margin: 14px 0; }
  .card .hint { color: #57606a; background: #f6f8fa; border-left: 3px solid #d8dee4;
    border-radius: 0 8px 8px 0; padding: 6px 12px; margin: 12px 0; }
  .card .topic-title { font-size: 16px; font-weight: 600; margin: 0 0 10px; }
  pre { background: #f6f8fa; border-radius: 8px; padding: 10px 12px; overflow: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #d8dee4; padding: 4px 10px; }
  ul, ol { padding-left: 22px; }
  .cloze { border-bottom: 2px solid #3b82f6; color: transparent; }
  .math-block { text-align: center; }
  @media print {
    body { max-width: none; padding: 0; }
    .card { break-inside: avoid; }
  }
`;

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

/** 渲染结果里的 `/media/<文件名>` 换成 data: URL，文件不存在就保持原样 */
function inlineImages(html: string, mediaDir: string): string {
  return html.replace(/src="\/media\/([^"]+)"/g, (all, name: string) => {
    const file = path.join(mediaDir, path.basename(name));
    if (!fs.existsSync(file)) return all;
    const mime = MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
    return `src="data:${mime};base64,${fs.readFileSync(file).toString('base64')}"`;
  });
}

/** 完整可独立打开的 HTML 文档；打印样式让每张卡片不跨页 */
export function buildHtml(deck: ExportDeck, items: Item[], opts: BuildOptions): string {
  const fix = (s: string): string => applyCloze(s, opts.cloze);
  const body: string[] = [`<h1>${escapeHtml(deck.title)}</h1>`];
  if (deck.description) body.push(`<p class="deck-desc">${plainTextHtml(deck.description)}</p>`);
  for (const it of items) {
    if (it.kind === 'section') {
      const tag = headingTag(it.level);
      body.push(`<${tag}>${escapeHtml(it.title)}</${tag}>`);
    } else {
      body.push(cardHtml(it, fix));
    }
  }
  const katex = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`;
  const print = opts.inline ? '\n<script>window.onload=()=>window.print()</script>' : '';
  const doc = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(deck.title)}</title>
<link rel="stylesheet" href="${katex}">
<style>${HTML_STYLE}</style>
</head>
<body>
${body.join('\n')}
${print}</body>
</html>
`;
  return opts.mediaDir ? inlineImages(doc, opts.mediaDir) : doc;
}

function cardHtml(card: CardItem, fix: (s: string) => string): string {
  const md = (s: string): string => renderMarkdown(fix(s));
  if (card.cardType === 'qa') {
    const hint = card.hint ? `<div class="hint">${md(card.hint)}</div>\n` : '';
    return `<section class="card">\n${md(card.front)}\n${hint}<hr>\n${md(card.back)}\n</section>`;
  }
  if (card.cardType === 'topic') {
    return `<section class="card">\n<div class="topic-title">${escapeHtml(fix(card.front))}</div>\n${plainTextHtml(fix(card.back))}\n</section>`;
  }
  return `<section class="card">\n${md(card.front)}\n</section>`;
}

function csvCell(s: string): string {
  const v = s ?? '';
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 每张卡片最近的一级目录标题（没有就空），用目录栈扫一遍 */
function nearestSection(items: Item[]): Map<string, string> {
  const stack: { level: number; title: string }[] = [];
  const map = new Map<string, string>();
  for (const it of items) {
    if (it.kind === 'section') {
      while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
      stack.push({ level: it.level, title: it.title });
      continue;
    }
    map.set(it.id, stack.length ? stack[stack.length - 1].title : '');
  }
  return map;
}

/** CSV：带 BOM，行分隔 \\r\\n，方便 Excel 直接打开 */
export function buildCsv(items: Item[], opts: BuildOptions): string {
  const fix = (s: string): string => applyCloze(s, opts.cloze);
  const titles = nearestSection(items);
  const rows: string[] = ['目录,类型,问题/内容,提示,答案'];
  for (const it of items) {
    if (it.kind !== 'card') continue;
    rows.push([titles.get(it.id) ?? '', CARD_TYPE_NAMES[it.cardType], fix(it.front), fix(it.hint), fix(it.back)].map(csvCell).join(','));
  }
  return '\uFEFF' + rows.join('\r\n');
}

/** JSON：保留原始 Markdown 和卡片颜色，够机器再导回来 */
export function buildJson(deck: ExportDeck, items: Item[], opts: BuildOptions): string {
  const fix = (s: string): string => applyCloze(s, opts.cloze);
  const out = items.map((it) =>
    it.kind === 'section'
      ? { kind: 'section', level: it.level, title: it.title }
      : { kind: 'card', cardType: it.cardType, color: it.color, front: fix(it.front), hint: fix(it.hint), back: fix(it.back) },
  );
  const body = { version: 1, title: deck.title, description: deck.description, exportedAt: opts.now ? opts.now() : Date.now(), items: out };
  return JSON.stringify(body, null, 2);
}
