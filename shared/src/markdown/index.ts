/**
 * 共用的 Markdown 渲染入口：网格预览、学习页、导出、编辑器载入都走这里。
 * 扩展语法见 plugins.ts，输出结构由 docs/contracts.md §4 约定。
 */
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import { bnkiPlugin } from './plugins';
import { countCloze as countClozeTokens, plainText as plainTextTokens } from './text';

/** 一次渲染内的挖空编号，从 0 起 */
type MdEnv = { clozeIndex: number; editor?: boolean };

// 两套实例常驻：编辑器不要代码高亮（还原后还要转回 Markdown）
let cachedHighlighted: MarkdownIt | null = null;
let cachedPlain: MarkdownIt | null = null;

export function createMd(opts?: { highlight?: boolean }): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: true, breaks: true });
  // 块级 HTML 一律当文字，内联标签由白名单把关
  md.disable('html_block');
  if (opts?.highlight !== false) {
    md.options.highlight = (code: string, lang: string) => {
      try {
        if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
        return hljs.highlightAuto(code).value;
      } catch {
        return '';
      }
    };
  }
  md.use(bnkiPlugin);
  return md;
}

function pick(highlight: boolean): MarkdownIt {
  if (highlight) {
    if (!cachedHighlighted) cachedHighlighted = createMd({ highlight: true });
    return cachedHighlighted;
  }
  if (!cachedPlain) cachedPlain = createMd({ highlight: false });
  return cachedPlain;
}

export function renderMarkdown(src: string, opts?: { editor?: boolean }): string {
  if (!src) return '';
  const env: MdEnv = { clozeIndex: 0, editor: !!opts?.editor };
  return pick(!opts?.editor).render(src, env);
}

export function renderInline(src: string): string {
  if (!src) return '';
  const env: MdEnv = { clozeIndex: 0 };
  return pick(true).renderInline(src, env);
}

export function plainText(src: string): string {
  return plainTextTokens(pick(false), src);
}

export function countCloze(src: string): number {
  return countClozeTokens(pick(false), src);
}
