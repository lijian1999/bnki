/** bnki 的 markdown-it 扩展：挖空、马克笔、公式、任务列表、图片/链接改写、白名单 HTML。 */
import katex from 'katex';
import type MarkdownIt from 'markdown-it';

/** 卡片链接的协议前缀，点击后由前端跳到那张卡 */
const CARD_LINK = 'bnki://card/';

/** 允许原样输出的内联标签，其余 HTML 一律转义成文字（design.md §3.3） */
const ALLOWED_HTML: RegExp[] = [
  /^<\/?u>$/,
  /^<br\s*\/?>$/,
  /^<mark(?: data-c="(?:yellow|green|blue|red|purple)")?(?: data-s="(?:line|wavy)")?>$/,
  /^<\/mark>$/,
  /^<span data-tc="(?:red|blue|green|grey)">$/,
  /^<span data-fs="(?:12|16|22|26)">$/,
  /^<\/span>$/,
];

export function bnkiPlugin(md: MarkdownIt): void {
  addCloze(md);
  addMark(md);
  addMath(md);
  addTasks(md);
  addImage(md);
  addLink(md);
  addHtmlWhitelist(md);
}

/** `{{内容}}`：不跨行、不嵌套，空内容不算挖空 */
function addCloze(md: MarkdownIt): void {
  md.inline.ruler.before('emphasis', 'cloze', (state, silent) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x7b || state.src.charCodeAt(start + 1) !== 0x7b) return false;
    const end = findClozeEnd(state.src, start + 2, state.posMax);
    if (end < 0 || end === start + 2) return false;
    if (!silent) {
      state.push('cloze_open', 'span', 1);
      const oldMax = state.posMax;
      state.pos = start + 2;
      state.posMax = end;
      state.md.inline.tokenize(state);
      state.posMax = oldMax;
      state.push('cloze_close', 'span', -1);
    }
    state.pos = end + 2;
    return true;
  });

  // 编号优先取 env.clozeIndex（同一次 render 内连续），否则按 token 顺序数
  md.renderer.rules.cloze_open = (tokens, idx, _options, env) => {
    const stored = readClozeIndex(env);
    const n = stored ?? countBefore(tokens, idx);
    writeClozeIndex(env, n + 1);
    return `<span class="cloze" data-i="${n}">`;
  };
  md.renderer.rules.cloze_close = () => '</span>';
}

function readClozeIndex(env: unknown): number | null {
  if (!env || typeof env !== 'object') return null;
  const value = (env as { clozeIndex?: unknown }).clozeIndex;
  return typeof value === 'number' ? value : null;
}

function writeClozeIndex(env: unknown, value: number): void {
  if (env && typeof env === 'object') (env as { clozeIndex: number }).clozeIndex = value;
}

function countBefore(tokens: ReturnType<MarkdownIt['parse']>, idx: number): number {
  let n = 0;
  for (let i = 0; i < idx; i++) if (tokens[i].type === 'cloze_open') n++;
  return n;
}

/**
 * 从 `{{` 之后找 `}}`：跨行失败；`$` 或反引号起的一段整体跳过，
 * 因为公式和行内代码里常有 `}}`。
 */
function findClozeEnd(src: string, i: number, max: number): number {
  while (i < max) {
    const ch = src[i];
    if (ch === '\n') return -1;
    if (ch === '$' || ch === '`') {
      const next = src.indexOf(ch, i + 1);
      if (next > i && next < max && !src.slice(i, next).includes('\n')) {
        i = next + 1;
        continue;
      }
    }
    if (ch === '}' && src[i + 1] === '}') return i;
    i++;
  }
  return -1;
}

/** `==文字==` 马克笔 */
function addMark(md: MarkdownIt): void {
  md.inline.ruler.before('emphasis', 'mark', (state, silent) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x3d || state.src.charCodeAt(start + 1) !== 0x3d) return false;
    const rest = state.src.slice(start + 2, state.posMax);
    const offset = rest.indexOf('==');
    if (offset < 0) return false;
    const end = start + 2 + offset;
    if (end === start + 2) return false;
    if (!silent) {
      state.push('mark_open', 'mark', 1);
      const oldMax = state.posMax;
      state.pos = start + 2;
      state.posMax = end;
      state.md.inline.tokenize(state);
      state.posMax = oldMax;
      state.push('mark_close', 'mark', -1);
    }
    state.pos = end + 2;
    return true;
  });
}

/** `$x$` 行内公式，`$$…$$` 块公式（KaTeX 输出，data-tex 留给编辑器还原） */
function addMath(md: MarkdownIt): void {
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const start = state.pos;
    if (state.src.charAt(start) !== '$') return false;
    const first = state.src.charAt(start + 1);
    if (!first || first === '$' || /\s/.test(first)) return false;
    let end = -1;
    for (let i = start + 1; i < state.posMax; i++) {
      if (state.src[i] === '\n') break;
      if (state.src[i] === '$' && !/\s/.test(state.src[i - 1])) {
        end = i;
        break;
      }
    }
    if (end < 0) return false;
    if (!silent) state.push('math_inline', 'math', 0).content = state.src.slice(start + 1, end);
    state.pos = end + 1;
    return true;
  });

  md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    if (state.src.slice(pos, pos + 2) !== '$$') return false;
    let line = startLine;
    let content = '';
    const first = state.src.slice(pos + 2, state.eMarks[startLine]).trim();
    if (first.endsWith('$$') && first.length > 2) {
      // 单行 `$$x$$`
      content = first.slice(0, -2);
    } else {
      if (first) content = first + '\n';
      let found = false;
      while (++line < endLine) {
        const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
        if (text.trim().endsWith('$$')) {
          content += text.trim().slice(0, -2);
          found = true;
          break;
        }
        content += text + '\n';
      }
      if (!found) return false;
    }
    if (silent) return true;
    state.line = line + 1;
    const token = state.push('math_block', 'math', 0);
    token.content = content.replace(/\n+$/, '');
    token.map = [startLine, state.line];
    return true;
  });

  md.renderer.rules.math_inline = (tokens, idx) => mathSpan(md, tokens[idx].content, false);
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="math-block">${mathSpan(md, tokens[idx].content, true)}</div>`;
}

function mathSpan(md: MarkdownIt, tex: string, display: boolean): string {
  const rendered = safeKatex(tex, display);
  return `<span class="math" data-tex="${md.utils.escapeHtml(tex)}" data-display="${display ? 1 : 0}">${rendered}</span>`;
}

/** KaTeX 语法错了也不能让整页渲染失败，退化成转义后的原文 */
function safeKatex(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false });
  } catch {
    return tex;
  }
}

/** `- [ ] x` / `- [x] x`：给列表项加 class，并把勾选框放在这段内容最前面 */
function addTasks(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'tasks', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const item = tokens[i];
      if (item.type !== 'list_item_open') continue;
      const first = firstInlineOf(tokens, i);
      if (!first || first.children == null || first.children.length === 0) continue;
      const head = first.children[0];
      const marker = /^\[([ xX])\] /.exec(head.type === 'text' ? head.content : '');
      if (!marker) continue;
      head.content = head.content.slice(marker[0].length);
      if (!head.content) first.children.shift();
      first.content = first.content.slice(marker[0].length);
      const box = new state.Token('task_checkbox', 'input', 0);
      box.markup = marker[1] === ' ' ? ' ' : 'x';
      box.level = head.level;
      first.children.unshift(box);
      item.attrJoin('class', 'task');
    }
  });

  md.renderer.rules.task_checkbox = (tokens, idx) =>
    `<input type="checkbox" disabled${tokens[idx].markup === ' ' ? '' : ' checked'}> `;
}

/** 列表项里第一段文字（跳过嵌套列表，避免把子项的标记算到父项头上） */
function firstInlineOf(tokens: ReturnType<MarkdownIt['parse']>, start: number) {
  let depth = 1;
  for (let j = start + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.type === 'list_item_open') depth++;
    else if (t.type === 'list_item_close') {
      depth--;
      if (depth === 0) break;
    } else if (depth === 1 && t.type === 'inline') return t;
  }
  return undefined;
}

/** `media/` 开头的图片走本地路径，其余原样 */
function addImage(md: MarkdownIt): void {
  md.renderer.rules.image = (tokens, idx) => {
    const token = tokens[idx];
    const raw = token.attrGet('src') ?? '';
    const src = raw.startsWith('media/') ? `/${raw}` : raw;
    return `<img src="${md.utils.escapeHtml(src)}" alt="${md.utils.escapeHtml(token.content)}">`;
  };
}

function addLink(md: MarkdownIt): void {
  md.renderer.rules.link_open = (tokens, idx, options, env: { editor?: boolean } | undefined, slf) => {
    const token = tokens[idx];
    const href = token.attrGet('href') ?? '';
    // 编辑器载入时保留原地址，否则存回去就丢了
    if (href.startsWith(CARD_LINK) && !env?.editor) {
      token.attrSet('href', '#');
      token.attrSet('data-card-link', href.slice(CARD_LINK.length));
    } else {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener');
    }
    return slf.renderToken(tokens, idx, options);
  };
}

/** 白名单外的标签转义成文字，脚本之类不会进 DOM */
function addHtmlWhitelist(md: MarkdownIt): void {
  md.renderer.rules.html_inline = (tokens, idx) => {
    const content = tokens[idx].content;
    return ALLOWED_HTML.some((re) => re.test(content)) ? content : md.utils.escapeHtml(content);
  };
}
