// ChatGPT 学习模式对话导入：把每条 AI 回答转成一张笔记卡的 Markdown。
// 回答正文里混着 DIL 组件标记（<box>、<icon>、<radio-group> 等），文字部分直接保留 Markdown，
// 图示/组件重画成 SVG（foreignObject + HTML，和网页里的盒子、图标、徽章、连接线一致）；
// 选择题按复制出来的静态文字保留，不做成交互组件。
import { createHash } from 'node:crypto';

/** 组件树节点：文本或 DIL 标签。 */
export interface DilNode {
  type: 'text' | 'tag';
  tag?: string;
  attrs?: Record<string, DilAttr>;
  children?: DilNode[];
  text?: string;
}

export type DilAttr =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'object'; value: Record<string, string | number | boolean> }
  | { kind: 'raw'; value: string };

export interface ChatgptMessage {
  id: string;
  role: string;
  contentType: string;
  text: string;
}

export interface RenderOptions {
  /** 保存一张 SVG；已经存在时返回同一路径并标 created=false。 */
  saveMedia: (svg: string) => { path: string; created: boolean };
}

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;

const FONT_STACK =
  "-apple-system-body, ui-sans-serif, -apple-system, system-ui, 'Segoe UI', Helvetica, 'Apple Color Emoji', Arial, sans-serif, 'Segoe UI Emoji', 'Segoe UI Symbol'";

const COMPONENT_WIDTH = 768;

const STYLE = `
strong { font-weight: 600; }
.dil-code { font-family: ui-monospace, SFMono-Regular, "SF Mono", menlo, consolas, monospace; font-size: 14.88px; background: rgba(243,243,243,0.82); border-radius: 3.72px; padding: 0.744px 4.1664px; }
.dil-item:not(:last-child)::after { content: ""; position: absolute; left: 11px; top: 28px; width: 2px; height: calc(100% - 22px); background: rgba(13,13,13,0.1); }
`;

const ICONS: Record<string, string> = {
  // Lucide 线性图标
  'arrow-down-up':
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/></svg>',
  server:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>',
  // ChatGPT 自己的填充图标（从页面里取到的 path）
  terminal:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor"><path d="M8.7587 3H15.2413C16.0463 2.99999 16.7106 2.99998 17.2518 3.04419C17.8139 3.09012 18.3306 3.18868 18.816 3.43597C19.5686 3.81947 20.1805 4.43139 20.564 5.18404C20.8113 5.66937 20.9099 6.18608 20.9558 6.74817C21 7.28936 21 7.95372 21 8.75868V15.2413C21 16.0463 21 16.7106 20.9558 17.2518C20.9099 17.8139 20.8113 18.3306 20.564 18.816C20.1805 19.5686 19.5686 20.1805 18.816 20.564C18.3306 20.8113 17.8139 20.9099 17.2518 20.9558C16.7106 21 16.0463 21 15.2413 21H8.75868C7.95372 21 7.28936 21 6.74817 20.9558C6.18608 20.9099 5.66937 20.8113 5.18404 20.564C4.43139 20.1805 3.81947 19.5686 3.43597 18.816C3.18868 18.3306 3.09012 17.8139 3.04419 17.2518C2.99998 16.7106 2.99999 16.0463 3 15.2413V8.7587C2.99999 7.95373 2.99998 7.28937 3.04419 6.74817C3.09012 6.18608 3.18868 5.66937 3.43597 5.18404C3.81947 4.43139 4.43139 3.81947 5.18404 3.43597C5.66937 3.18868 6.18608 3.09012 6.74817 3.04419C7.28937 2.99998 7.95373 2.99999 8.7587 3ZM6.91104 5.03755C6.47262 5.07337 6.24842 5.1383 6.09202 5.21799C5.7157 5.40973 5.40973 5.7157 5.21799 6.09202C5.1383 6.24842 5.07337 6.47262 5.03755 6.91104C5.00078 7.36113 5 7.94342 5 8.8V15.2C5 16.0566 5.00078 16.6389 5.03755 17.089C5.07337 17.5274 5.1383 17.7516 5.21799 17.908C5.40973 18.2843 5.7157 18.5903 6.09202 18.782C6.24842 18.8617 6.47262 18.9266 6.91104 18.9624C7.36113 18.9992 7.94342 19 8.8 19H15.2C16.0566 19 16.6389 18.9992 17.089 18.9624C17.5274 18.9266 17.7516 18.8617 17.908 18.782C18.2843 18.5903 18.5903 18.2843 18.782 17.908C18.8617 17.7516 18.9266 17.5274 18.9624 17.089C18.9992 16.6389 19 16.0566 19 15.2V8.8C19 7.94342 18.9992 7.36113 18.9624 6.91104C18.9266 6.47262 18.8617 6.24842 18.782 6.09202C18.5903 5.7157 18.2843 5.40973 17.908 5.21799C17.7516 5.1383 17.5274 5.07337 17.089 5.03755C16.6389 5.00078 16.0566 5 15.2 5H8.8C7.94342 5 7.36113 5.00078 6.91104 5.03755ZM7.29289 9.29289C7.68342 8.90237 8.31658 8.90237 8.70711 9.29289L10.7071 11.2929C11.0976 11.6834 11.0976 12.3166 10.7071 12.7071L8.70711 14.7071C8.31658 15.0976 7.68342 15.0976 7.29289 14.7071C6.90237 14.3166 6.90237 13.6834 7.29289 13.2929L8.58579 12L7.29289 10.7071C6.90237 10.3166 6.90237 9.68342 7.29289 9.29289ZM12 14C12 13.4477 12.4477 13 13 13H16C16.5523 13 17 13.4477 17 14C17 14.5523 16.5523 15 16 15H13C12.4477 15 12 14.5523 12 14Z"/></svg>',
  square:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor"><path d="M8.7587 3H15.2413C16.0463 2.99999 16.7106 2.99998 17.2518 3.04419C17.8139 3.09012 18.3306 3.18868 18.816 3.43597C19.5686 3.81947 20.1805 4.43139 20.564 5.18404C20.8113 5.66937 20.9099 6.18608 20.9558 6.74817C21 7.28936 21 7.95372 21 8.75868V15.2413C21 16.0463 21 16.7106 20.9558 17.2518C20.9099 17.8139 20.8113 18.3306 20.564 18.816C20.1805 19.5686 19.5686 20.1805 18.816 20.564C18.3306 20.8113 17.8139 20.9099 17.2518 20.9558C16.7106 21 16.0463 21 15.2413 21H8.75868C7.95372 21 7.28936 21 6.74817 20.9558C6.18608 20.9099 5.66937 20.8113 5.18404 20.564C4.43139 20.1805 3.81947 19.5686 3.43597 18.816C3.18868 18.3306 3.09012 17.8139 3.04419 17.2518C2.99998 16.7106 2.99999 16.0463 3 15.2413V8.7587C2.99999 7.95373 2.99998 7.28937 3.04419 6.74817C3.09012 6.18608 3.18868 5.66937 3.43597 5.18404C3.81947 4.43139 4.43139 3.81947 5.18404 3.43597C5.66937 3.18868 6.18608 3.09012 6.74817 3.04419C7.28937 2.99998 7.95373 2.99999 8.7587 3ZM6.91104 5.03755C6.47262 5.07337 6.24842 5.1383 6.09202 5.21799C5.7157 5.40973 5.40973 5.7157 5.21799 6.09202C5.1383 6.24842 5.07337 6.47262 5.03755 6.91104C5.00078 7.36113 5 7.94342 5 8.8V15.2C5 16.0566 5.00078 16.6389 5.03755 17.089C5.07337 17.5274 5.1383 17.7516 5.21799 17.908C5.40973 18.2843 5.7157 18.5903 6.09202 18.782C6.24842 18.8617 6.47262 18.9266 6.91104 18.9624C7.36113 18.9992 7.94342 19 8.8 19H15.2C16.0566 19 16.6389 18.9992 17.089 18.9624C17.5274 18.9266 17.7516 18.8617 17.908 18.782C18.2843 18.5903 18.5903 18.2843 18.782 17.908C18.8617 17.7516 18.9266 17.5274 18.9624 17.089C18.9992 16.6389 19 16.0566 19 15.2V8.8C19 7.94342 18.9992 7.36113 18.9624 6.91104C18.9266 6.47262 18.8617 6.24842 18.782 6.09202C18.5903 5.7157 18.2843 5.40973 17.908 5.21799C17.7516 5.1383 17.5274 5.07337 17.089 5.03755C16.6389 5.00078 16.0566 5 15.2 5H8.8C7.94342 5 7.36113 5.00078 6.91104 5.03755Z"/></svg>',
  'trash-2':
    '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.5555 4C10.099 4 9.70052 4.30906 9.58693 4.75114L9.29382 5.8919H14.715L14.4219 4.75114C14.3083 4.30906 13.9098 4 13.4533 4H10.5555ZM16.7799 5.8919L16.3589 4.25342C16.0182 2.92719 14.8226 2 13.4533 2H10.5555C9.18616 2 7.99062 2.92719 7.64985 4.25342L7.22886 5.8919H4C3.44772 5.8919 3 6.33961 3 6.8919C3 7.44418 3.44772 7.8919 4 7.8919H4.10069L5.31544 19.3172C5.47763 20.8427 6.76455 22 8.29863 22H15.7014C17.2354 22 18.5224 20.8427 18.6846 19.3172L19.8993 7.8919H20C20.5523 7.8919 21 7.44418 21 6.8919C21 6.33961 20.5523 5.8919 20 5.8919H16.7799ZM17.888 7.8919H6.11196L7.30423 19.1057C7.3583 19.6142 7.78727 20 8.29863 20H15.7014C16.2127 20 16.6417 19.6142 16.6958 19.1057L17.888 7.8919ZM10 10C10.5523 10 11 10.4477 11 11V16C11 16.5523 10.5523 17 10 17C9.44772 17 9 16.5523 9 16V11C9 10.4477 9.44772 10 10 10ZM14 10C14.5523 10 15 10.4477 15 11V16C15 16.5523 14.5523 17 14 17C13.4477 17 13 16.5523 13 16V11C13 10.4477 13.4477 10 14 10Z"/></svg>',
};

const DEFAULT_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function attr(node: DilNode, name: string): DilAttr | undefined {
  return node.attrs?.[name];
}

function strAttr(node: DilNode, name: string, fallback = ''): string {
  const a = attr(node, name);
  if (!a) return fallback;
  if (a.kind === 'string' || a.kind === 'raw') return a.value;
  if (a.kind === 'number' || a.kind === 'boolean') return String(a.value);
  return fallback;
}

function numAttr(node: DilNode, name: string, fallback = 0): number {
  const a = attr(node, name);
  if (!a) return fallback;
  if (a.kind === 'number') return a.value;
  if (a.kind === 'string' || a.kind === 'raw') {
    const n = Number(a.value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function boolAttr(node: DilNode, name: string): boolean {
  const a = attr(node, name);
  return !!a && (a.kind === 'boolean' ? a.value : true);
}

/** 标签结束位置：跳过引号和 {} 里的内容，避免把箭头函数的 `>` 当成标签结尾。 */
function findTagEnd(src: string, start: number): number {
  let quote: string | null = null;
  let braces = 0;
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      braces++;
      continue;
    }
    if (ch === '}') {
      braces = Math.max(0, braces - 1);
      continue;
    }
    if (ch === '>' && braces === 0) return i;
  }
  return -1;
}

function parseAttrValue(raw: string): DilAttr {
  const v = raw.trim();
  if (v.startsWith('"') && v.endsWith('"')) return { kind: 'string', value: v.slice(1, -1) };
  if (v.startsWith("'") && v.endsWith("'")) return { kind: 'string', value: v.slice(1, -1) };
  if (v.startsWith('{') && v.endsWith('}')) {
    const inner = v.slice(1, -1).trim();
    if (inner.startsWith('{') && inner.endsWith('}')) {
      const obj = parseObjectLiteral(inner.slice(1, -1));
      return { kind: 'object', value: obj };
    }
    const n = Number(inner);
    if (Number.isFinite(n)) return { kind: 'number', value: n };
    return { kind: 'raw', value: inner };
  }
  const n = Number(v);
  if (Number.isFinite(n) && v !== '') return { kind: 'number', value: n };
  if (v === 'true') return { kind: 'boolean', value: true };
  if (v === 'false') return { kind: 'boolean', value: false };
  return { kind: 'raw', value: v };
}

function parseObjectLiteral(src: string): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /[\s,]/.test(src[i])) i++;
    if (i >= src.length) break;
    let key = '';
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      i++;
      while (i < src.length && src[i] !== q) key += src[i++];
      i++;
    } else {
      while (i < src.length && /[\w$-]/.test(src[i])) key += src[i++];
    }
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== ':') break;
    i++;
    while (i < src.length && /\s/.test(src[i])) i++;
    let val = '';
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      i++;
      while (i < src.length && src[i] !== q) val += src[i++];
      i++;
      out[key] = val;
    } else {
      while (i < src.length && !/[,}]/.test(src[i])) val += src[i++];
      const t = val.trim();
      const n = Number(t);
      out[key] = Number.isFinite(n) && t !== '' ? n : t === 'true' ? true : t === 'false' ? false : t;
    }
  }
  return out;
}

function parseTag(raw: string): { tag: string; attrs: Record<string, DilAttr>; closing: boolean; selfClosing: boolean } | null {
  const closing = raw.startsWith('</');
  const selfClosing = raw.endsWith('/>');
  const body = raw.slice(closing ? 2 : 1, raw.length - (selfClosing ? 2 : 1)).trim();
  const m = body.match(/^([a-zA-Z][\w-]*)/);
  if (!m) return null;
  const tag = m[1];
  const attrs: Record<string, DilAttr> = {};
  let i = m[0].length;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) break;
    const nm = body.slice(i).match(/^([a-zA-Z][\w-]*)/);
    if (!nm) break;
    const name = nm[1];
    i += name.length;
    while (i < body.length && /\s/.test(body[i])) i++;
    if (body[i] === '=') {
      i++;
      while (i < body.length && /\s/.test(body[i])) i++;
      const start = i;
      if (body[i] === '"' || body[i] === "'") {
        const q = body[i];
        i++;
        while (i < body.length && body[i] !== q) i++;
        i++;
      } else if (body[i] === '{') {
        let depth = 0;
        while (i < body.length) {
          if (body[i] === '{') depth++;
          else if (body[i] === '}') {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
          i++;
        }
      } else {
        while (i < body.length && !/\s/.test(body[i])) i++;
      }
      attrs[name] = parseAttrValue(body.slice(start, i));
    } else {
      attrs[name] = { kind: 'boolean', value: true };
    }
  }
  return { tag, attrs, closing, selfClosing };
}

/** 把回答正文解析成组件树。`{@body ...}` 这类 JSX 初始化代码不是回答内容，直接丢掉。 */
export function parseDil(src: string): DilNode[] {
  const root: DilNode[] = [];
  const stack: DilNode[] = [];
  let i = 0;
  let textStart = 0;
  const pushText = (t: string) => {
    if (!t) return;
    const node: DilNode = { type: 'text', text: t };
    if (stack.length) stack[stack.length - 1].children!.push(node);
    else root.push(node);
  };
  while (i < src.length) {
    if (src[i] === '{' && src.slice(i, i + 6) === '{@body') {
      // 先把 JSX 初始化代码之前的正文推出去，再跳过整行初始化代码。
      pushText(src.slice(textStart, i));
      const end = src.indexOf('\n', i);
      i = end >= 0 ? end + 1 : src.length;
      textStart = i;
      continue;
    }
    if (src[i] === '<') {
      const end = findTagEnd(src, i);
      if (end < 0) {
        i++;
        continue;
      }
      const parsed = parseTag(src.slice(i, end + 1));
      if (!parsed) {
        i = end + 1;
        continue;
      }
      pushText(src.slice(textStart, i));
      if (parsed.closing) {
        const idx = stack.map((n) => n.tag).lastIndexOf(parsed.tag);
        if (idx >= 0) stack.length = idx;
      } else {
        const node: DilNode = { type: 'tag', tag: parsed.tag, attrs: parsed.attrs, children: [] };
        if (stack.length) stack[stack.length - 1].children!.push(node);
        else root.push(node);
        if (!parsed.selfClosing) stack.push(node);
      }
      i = end + 1;
      textStart = i;
      continue;
    }
    i++;
  }
  pushText(src.slice(textStart));
  return root;
}

function isMeaningful(node: DilNode): boolean {
  if (node.type === 'text') return (node.text ?? '').trim().length > 0;
  return true;
}

function textContent(node: DilNode): string {
  return (node.children ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : textContent(c))).join('');
}

function paragraphs(node: DilNode): string[] {
  const raw = (node.type === 'text' ? node.text ?? '' : textContent(node)).trim();
  if (!raw) return [];
  return raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

function inlineHtml(text: string): string {
  const codes: string[] = [];
  let s = escapeHtml(text);
  // 先把行内代码换成占位符，这样 **粗体里带 `代码`** 也能被粗体正则整体匹配。
  s = s.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(escapeHtml(code));
    return `\u0000CODE${codes.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_, idx: string) => `<code class="dil-code">${codes[Number(idx)]}</code>`);
  return s;
}

function mapTextColor(name: string): string {
  switch (name) {
    case 'secondary':
      return '#5d5d5d';
    case 'info':
      return 'rgb(2,133,255)';
    case 'success':
      return 'rgb(0,105,42)';
    case 'danger':
      return 'rgb(250,66,62)';
    case 'subtle':
      return 'rgba(0,0,0,0.1)';
    default:
      return '#0d0d0d';
  }
}

function mapIconColor(name: string): string {
  return mapTextColor(name);
}

function mapBackground(name: string): string {
  switch (name) {
    case 'surface-secondary':
      return '#fcfcfc';
    case 'surface':
      return '#f3f3f3';
    case 'subtle':
      return 'rgba(0,0,0,0.03)';
    default:
      return name.startsWith('rgba(') || name.startsWith('rgb(') || name.startsWith('#') ? name : '';
  }
}

function mapRadius(name: string): number {
  switch (name) {
    case 'xl':
      return 16;
    case 'lg':
      return 12;
    case 'md':
      return 8;
    case 'sm':
      return 4;
    default:
      return 8;
  }
}

function mapBorderColor(name: string): string {
  switch (name) {
    case 'info':
      return 'rgba(2,133,255,0.2)';
    case 'success':
      return 'rgba(22,163,74,0.3)';
    case 'danger':
      return 'rgba(220,38,38,0.3)';
    case 'subtle':
      return 'rgba(0,0,0,0.05)';
    default:
      return name.startsWith('rgba(') || name.startsWith('rgb(') || name.startsWith('#') ? name : 'rgba(0,0,0,0.1)';
  }
}

function badgeColors(name: string): { bg: string; fg: string } {
  switch (name) {
    case 'info':
      return { bg: 'rgba(2,133,255,0.13)', fg: 'rgb(2,133,255)' };
    case 'success':
      return { bg: 'rgba(22,163,74,0.13)', fg: 'rgb(0,105,42)' };
    case 'danger':
      return { bg: 'rgba(220,38,38,0.13)', fg: 'rgb(250,66,62)' };
    default:
      return { bg: 'rgba(0,0,0,0.06)', fg: '#0d0d0d' };
  }
}

function fontSpec(size: string): { size: number; line: number } {
  switch (size) {
    case 'xs':
      return { size: 12, line: 16 };
    case 'sm':
      return { size: 14, line: 20 };
    case '3xs':
      return { size: 9, line: 9 };
    default:
      return { size: 16, line: 26 };
  }
}

function mapWeight(name: string): number {
  switch (name) {
    case 'medium':
      return 500;
    case 'bold':
      return 600;
    default:
      return 400;
  }
}

/** 估算一段文字在给定宽度里占几行。宁可多估一行，也不要让 SVG 把内容裁掉。 */
function estimateLines(text: string, width: number, fontSize: number, weight: number): number {
  const plain = text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/==([^=]+)==/g, '$1');
  const boldFactor = weight >= 600 ? 1.08 : 1;
  let lines = 1;
  let x = 0;
  for (const ch of plain) {
    let w: number;
    if (ch === ' ') w = fontSize * 0.3;
    else if (CJK.test(ch)) w = fontSize;
    else w = fontSize * 0.58;
    w *= boldFactor;
    if (x + w > width && x > 0) {
      lines++;
      x = 0;
    }
    x += w;
  }
  return lines;
}

interface LayoutCtx {
  width: number;
  gap: number;
  prevType: string | null;
  isFirst: boolean;
}

interface RenderedNode {
  html: string;
  height: number;
  marginTop: number;
}

function renderParagraph(text: string, size: string, color: string, weight: string, width: number, marginTop: number): RenderedNode {
  const f = fontSpec(size);
  const lines = estimateLines(text, width, f.size, mapWeight(weight));
  const hasCode = /`[^`]+`/.test(text);
  const height = marginTop + lines * f.line + (hasCode ? 1 : 0);
  const style = [
    `margin:${marginTop}px 0 0 0`,
    `font-size:${f.size}px`,
    `line-height:${f.line}px`,
    `color:${mapTextColor(color)}`,
    `font-weight:${mapWeight(weight)}`,
  ].join(';');
  return { html: `<p style="${style}">${inlineHtml(text)}</p>`, height, marginTop };
}

function renderTextNode(node: DilNode, ctx: LayoutCtx): RenderedNode {
  const paras = paragraphs(node);
  const size = strAttr(node, 'size');
  const color = strAttr(node, 'color');
  const weight = strAttr(node, 'weight');
  const marginTop = ctx.prevType && ctx.prevType !== 'text' && ctx.gap === 0 && !ctx.isFirst ? 12 : 0;
  const parts: RenderedNode[] = [];
  for (let i = 0; i < paras.length; i++) {
    parts.push(renderParagraph(paras[i], size, color, weight, ctx.width, i === 0 ? marginTop : 0));
  }
  return {
    html: parts.map((p) => p.html).join(''),
    height: parts.reduce((s, p) => s + p.height, 0),
    marginTop,
  };
}

function renderIcon(node: DilNode): RenderedNode {
  const size = strAttr(node, 'size') === 'sm' ? 14 : strAttr(node, 'size') === 'lg' ? 18 : 18;
  const color = mapIconColor(strAttr(node, 'color'));
  const svg = ICONS[strAttr(node, 'name')] ?? DEFAULT_ICON;
  return {
    html: `<span style="display:inline-flex;align-items:center;justify-content:center;color:${color};font-size:${size}px;line-height:${size}px;">${svg}</span>`,
    height: size,
    marginTop: 0,
  };
}

function renderBadge(node: DilNode): RenderedNode {
  const { bg, fg } = badgeColors(strAttr(node, 'color', 'info'));
  return {
    html: `<span style="display:inline-flex;align-items:center;height:20px;padding:0 6.65px;border-radius:9999px;background:${bg};color:${fg};font-size:12px;font-weight:500;line-height:20px;white-space:nowrap;">${inlineHtml(textContent(node).trim())}</span>`,
    height: 20,
    marginTop: 0,
  };
}

function renderCaption(node: DilNode): RenderedNode {
  return {
    html: `<div style="font-size:14px;line-height:18.2px;color:#5d5d5d;">${inlineHtml(textContent(node).trim())}</div>`,
    height: 18.2,
    marginTop: 0,
  };
}

function renderDivider(node: DilNode): RenderedNode {
  const color = strAttr(node, 'color') === 'subtle' ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.1)';
  return {
    html: `<div style="height:17px;display:flex;align-items:center;"><div style="width:100%;height:1px;background:${color};"></div></div>`,
    height: 17,
    marginTop: 0,
  };
}

function renderListItem(node: DilNode, width: number, gap: number, marker: string, index: number): RenderedNode {
  const contentWidth = Math.max(0, width - 24 - gap);
  const children = (node.children ?? []).filter(isMeaningful);
  const rendered: RenderedNode[] = [];
  let prevType: string | null = null;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const r = renderNode(child, { width: contentWidth, gap: 0, prevType, isFirst: i === 0 });
    rendered.push(r);
    prevType = child.type === 'tag' ? child.tag ?? null : 'text';
  }
  const contentHeight = rendered.reduce((s, r) => s + r.height, 0);
  const height = Math.max(26, contentHeight);
  const markerText = marker === 'number' ? String(index + 1) : '•';
  return {
    html: `<div class="dil-item" style="display:flex;gap:${gap}px;position:relative;"><div class="dil-marker" style="width:24px;height:26px;display:flex;align-items:center;justify-content:center;color:#0d0d0d;font-size:16px;line-height:26px;">${markerText}</div><div class="dil-content" style="flex:1;">${rendered.map((r) => r.html).join('')}</div></div>`,
    height,
    marginTop: 0,
  };
}

function renderList(node: DilNode, ctx: LayoutCtx): RenderedNode {
  const gap = numAttr(node, 'gap', 0) * 4;
  const marker = strAttr(node, 'marker', 'bullet');
  const items = (node.children ?? []).filter((c) => c.tag === 'list-item');
  const rendered = items.map((item, i) => renderListItem(item, ctx.width, gap, marker, i));
  const height = rendered.reduce((s, r) => s + r.height, 0) + gap * Math.max(0, items.length - 1);
  return {
    html: `<div style="display:flex;flex-direction:column;gap:${gap}px;">${rendered.map((r) => r.html).join('')}</div>`,
    height,
    marginTop: 0,
  };
}

function renderBox(node: DilNode, ctx: LayoutCtx): RenderedNode {
  const padding = numAttr(node, 'padding', 0) * 4;
  const gap = numAttr(node, 'gap', 0) * 4;
  const radius = mapRadius(strAttr(node, 'radius', 'md'));
  const background = mapBackground(strAttr(node, 'background'));
  const widthAttr = strAttr(node, 'width');
  const sizeAttr = strAttr(node, 'size');
  const flexAttr = strAttr(node, 'flex');
  const align = strAttr(node, 'align') === 'center';
  const justify = strAttr(node, 'justify') === 'center';
  const direction = strAttr(node, 'direction', 'col') === 'row' ? 'row' : 'column';

  const borderAttr = attr(node, 'border');
  let borderSize = 0;
  let borderCss = '';
  if (borderAttr) {
    if (borderAttr.kind === 'object') {
      borderSize = Number(borderAttr.value.size ?? 1);
      borderCss = `border:${borderSize}px solid ${mapBorderColor(String(borderAttr.value.color ?? 'default'))};`;
    } else {
      borderSize = 1;
      borderCss = `border:1px solid ${mapBorderColor('default')};`;
    }
  }

  let width = ctx.width;
  if (widthAttr.endsWith('%')) width = ctx.width * (Number.parseFloat(widthAttr) / 100);
  else if (widthAttr.endsWith('px')) width = Number.parseFloat(widthAttr);
  else if (sizeAttr.endsWith('px')) width = Number.parseFloat(sizeAttr);

  const contentWidth = Math.max(0, width - padding * 2 - borderSize * 2);
  const children = (node.children ?? []).filter(isMeaningful);
  const rendered: RenderedNode[] = [];
  let prevType: string | null = null;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const r = renderNode(child, { width: contentWidth, gap, prevType, isFirst: i === 0 });
    rendered.push(r);
    prevType = child.type === 'tag' ? child.tag ?? null : 'text';
  }

  let height = padding * 2 + borderSize * 2 + rendered.reduce((s, r) => s + r.height, 0) + gap * Math.max(0, children.length - 1);
  if (sizeAttr.endsWith('px')) height = Number.parseFloat(sizeAttr);

  const style = [
    'display:flex',
    `flex-direction:${direction}`,
    `gap:${gap}px`,
    `padding:${padding}px`,
    `border-radius:${radius}px`,
    borderCss,
    background ? `background:${background}` : '',
    widthAttr ? `width:${widthAttr}` : sizeAttr ? `width:${sizeAttr};height:${sizeAttr};flex-shrink:0` : '',
    flexAttr ? `flex:${flexAttr}` : '',
    align ? 'align-items:center' : '',
    justify ? 'justify-content:center' : '',
    'box-sizing:border-box',
  ]
    .filter(Boolean)
    .join(';');

  return {
    html: `<div style="${style}">${rendered.map((r) => r.html).join('')}</div>`,
    height,
    marginTop: 0,
  };
}

function renderRow(node: DilNode, ctx: LayoutCtx): RenderedNode {
  const gap = numAttr(node, 'gap', 0) * 4;
  const align = strAttr(node, 'align') === 'center';
  const justify = strAttr(node, 'justify');
  const children = (node.children ?? []).filter(isMeaningful);

  // 先算每个孩子的宽度：百分比/固定像素/flex 三种。
  const widths: number[] = [];
  let flexCount = 0;
  let fixedTotal = 0;
  for (const child of children) {
    if (child.type === 'tag' && child.tag === 'box') {
      const w = strAttr(child, 'width');
      const size = strAttr(child, 'size');
      const flex = strAttr(child, 'flex');
      if (w.endsWith('%')) widths.push(ctx.width * (Number.parseFloat(w) / 100));
      else if (w.endsWith('px')) widths.push(Number.parseFloat(w));
      else if (size.endsWith('px')) widths.push(Number.parseFloat(size));
      else if (flex) {
        widths.push(-1);
        flexCount++;
      } else widths.push(ctx.width);
    } else {
      widths.push(ctx.width);
    }
    if (widths[widths.length - 1] >= 0) fixedTotal += widths[widths.length - 1];
  }
  const remaining = Math.max(0, ctx.width - fixedTotal - gap * Math.max(0, children.length - 1));
  const flexWidth = flexCount ? remaining / flexCount : 0;

  const rendered = children.map((child, i) => {
    const w = widths[i] < 0 ? flexWidth : widths[i];
    return renderNode(child, { width: w, gap: 0, prevType: null, isFirst: i === 0 });
  });
  const height = rendered.reduce((s, r) => Math.max(s, r.height), 0);

  const style = [
    'display:flex',
    'flex-direction:row',
    `gap:${gap}px`,
    align ? 'align-items:center' : '',
    justify === 'end' ? 'justify-content:flex-end' : justify === 'center' ? 'justify-content:center' : '',
    'box-sizing:border-box',
  ]
    .filter(Boolean)
    .join(';');

  return {
    html: `<div style="${style}">${rendered.map((r) => r.html).join('')}</div>`,
    height,
    marginTop: 0,
  };
}

function renderNode(node: DilNode, ctx: LayoutCtx): RenderedNode {
  if (node.type === 'text') {
    const paras = paragraphs(node);
    if (paras.length === 0) return { html: '', height: 0, marginTop: 0 };
    const marginTop = ctx.prevType && ctx.prevType !== 'text' && ctx.gap === 0 && !ctx.isFirst ? 12 : 0;
    const parts = paras.map((p, i) => renderParagraph(p, '', '', '', ctx.width, i === 0 ? marginTop : 0));
    return {
      html: parts.map((p) => p.html).join(''),
      height: parts.reduce((s, p) => s + p.height, 0),
      marginTop,
    };
  }
  switch (node.tag) {
    case 'text':
      return renderTextNode(node, ctx);
    case 'icon':
      return renderIcon(node);
    case 'badge':
      return renderBadge(node);
    case 'caption':
      return renderCaption(node);
    case 'divider':
      return renderDivider(node);
    case 'list':
      return renderList(node, ctx);
    case 'list-item':
      return renderListItem(node, ctx.width, 0, 'bullet', 0);
    case 'box':
      return renderBox(node, ctx);
    case 'row':
      return renderRow(node, ctx);
    default: {
      const text = textContent(node).trim();
      if (!text) return { html: '', height: 0, marginTop: 0 };
      return renderParagraph(text, '', '', '', ctx.width, 0);
    }
  }
}

/** 判断一个 box 是不是选择题（radio-group 或 button）：选择题保留静态文字，不画成图。 */
function isChoiceBox(node: DilNode): boolean {
  if (node.tag === 'radio-group' || node.tag === 'radio' || node.tag === 'button') return true;
  return (node.children ?? []).some(isChoiceBox);
}

function collectChoiceText(node: DilNode, out: string[]): void {
  if (node.type === 'text') {
    const t = (node.text ?? '').trim();
    if (t) out.push(t);
    return;
  }
  if (node.tag === 'radio' || node.tag === 'button' || node.tag === 'text') {
    const t = textContent(node).trim();
    if (t) out.push(t);
    return;
  }
  for (const child of node.children ?? []) collectChoiceText(child, out);
}

function choiceMarkdown(node: DilNode): string {
  const parts: string[] = [];
  collectChoiceText(node, parts);
  return parts.join('\n\n');
}

function componentSvg(node: DilNode): string {
  const rendered = renderNode(node, { width: COMPONENT_WIDTH, gap: 0, prevType: null, isFirst: true });
  const height = Math.max(1, Math.ceil(rendered.height + 4));
  const html = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${COMPONENT_WIDTH}px;font-family:${FONT_STACK};font-size:16px;line-height:26px;color:#0d0d0d;box-sizing:border-box;"><style>${STYLE}</style>${rendered.html}</div>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${COMPONENT_WIDTH}" height="${height}" viewBox="0 0 ${COMPONENT_WIDTH} ${height}"><foreignObject x="0" y="0" width="${COMPONENT_WIDTH}" height="${height}">${html}</foreignObject></svg>`;
}

/** 从对话 JSON 里挑出要导入的 AI 正文回答：每条一张卡，不查重（重复由用户自己删）。 */
export function selectAssistantMessages(conversation: unknown): ChatgptMessage[] {
  const conv = conversation as Record<string, unknown>;
  let raw: unknown[] = [];
  if (Array.isArray(conv.messages)) raw = conv.messages;
  else if (conv.mapping && typeof conv.mapping === 'object') {
    raw = Object.values(conv.mapping as Record<string, unknown>)
      .map((v) => (v as Record<string, unknown>)?.message)
      .filter(Boolean);
  }
  const out: ChatgptMessage[] = [];
  for (const item of raw) {
    const m = item as Record<string, unknown>;
    const author = (m.author ?? {}) as Record<string, unknown>;
    const content = (m.content ?? {}) as Record<string, unknown>;
    const role = String(author.role ?? '');
    const contentType = String(content.content_type ?? '');
    const parts = Array.isArray(content.parts) ? content.parts.filter((p): p is string => typeof p === 'string') : [];
    const text = parts.join('');
    const metadata = (m.metadata ?? {}) as Record<string, unknown>;
    if (metadata.is_visually_hidden_from_conversation === true) continue;
    if (role === 'assistant' && contentType === 'text' && text.trim()) {
      out.push({ id: String(m.id ?? ''), role, contentType, text });
    }
  }
  return out;
}

/** 网页里采集到的图示截图（由用户脚本上传）。 */
export interface CapturedImage {
  /** 对话消息 id（和 ChatgptMessage.id 一致）。 */
  messageId: string;
  /** 该消息里第几个图示（DOM 文档顺序，含公式）。 */
  domIndex: number;
  /** DOM 组件类型：box、badge、math… */
  type: string;
  /** data:image/png;base64,… */
  dataUrl: string;
}

export interface RenderWithImagesOptions {
  /** 保存采集到的图片字节。 */
  saveMedia: (bytes: Buffer, mime: string) => { path: string; created: boolean };
  /** 没采集到图片时退回重画 SVG，保证图示不缺失。 */
  saveFallbackSvg: (svg: string) => { path: string; created: boolean };
}

/**
 * 把一条回答转成卡片正面 Markdown：文字保留 Markdown，图示用网页真实截图。
 * 优先用采集到的图片；采集不到才退回重画 SVG，并计入 fallback。
 */
export function renderAnswerMarkdownWithImages(
  text: string,
  images: CapturedImage[],
  opts: RenderWithImagesOptions,
): { markdown: string; media: number; fallback: number } {
  const cleaned = text.replace(/<Cite\b[^>]*\/>/g, '〔引用〕');
  const nodes = parseDil(cleaned);

  // 按类型分组，组内保持 DOM 顺序；每个节点按类型取下一张。
  const byType = new Map<string, CapturedImage[]>();
  for (const im of [...images].sort((a, b) => a.domIndex - b.domIndex)) {
    const list = byType.get(im.type) ?? [];
    list.push(im);
    byType.set(im.type, list);
  }

  let media = 0;
  let fallback = 0;
  const blocks: string[] = [];

  const saveImage = (im: CapturedImage): string | null => {
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(im.dataUrl);
    if (!m) return null;
    const saved = opts.saveMedia(Buffer.from(m[2], 'base64'), m[1]);
    // media 数的是「卡片里用了多少张图」，不是「新建了多少个文件」：
    // 同一张截图重复导入时文件已存在（哈希去重），但卡片确实用上了它。
    media++;
    return saved.path;
  };

  const takeImage = (type: string): string | null => {
    const im = byType.get(type)?.shift();
    return im ? saveImage(im) : null;
  };

  for (const node of nodes) {
    if (node.type === 'text') {
      let t = (node.text ?? '').trim();
      if (!t) continue;
      // 源码里的 \[ … \] 是公式块，网页会渲染成公式组件，用截图替换。
      t = t.replace(/\\\[([\s\S]*?)\\\]/g, () => {
        const path = takeImage('math');
        return path ? `![](${path})` : '〔公式〕';
      });
      blocks.push(t);
      continue;
    }
    if (node.tag === 'Cite') continue;
    if (node.tag === 'divider') {
      blocks.push('---');
      continue;
    }
    if (node.tag === 'box' && isChoiceBox(node)) {
      const md = choiceMarkdown(node);
      if (md) blocks.push(md);
      continue;
    }
    if (node.tag === 'radio-group' || node.tag === 'radio' || node.tag === 'button') {
      const md = choiceMarkdown(node);
      if (md) blocks.push(md);
      continue;
    }
    if (node.tag === 'text') {
      const t = textContent(node).trim();
      if (t) blocks.push(t);
      continue;
    }
    const path = takeImage(node.tag ?? '');
    if (path) {
      blocks.push(`![](${path})`);
      continue;
    }
    // 采集不到 → 退回重画，避免图示缺失
    const svg = componentSvg(node);
    const saved = opts.saveFallbackSvg(svg);
    media++;
    fallback++;
    blocks.push(`![](${saved.path})`);
  }
  return { markdown: blocks.join('\n\n').trim(), media, fallback };
}

/** 把一条回答转成卡片正面 Markdown：文字保留 Markdown，组件换成 SVG 图片（旧路线，作为兜底保留）。 */
export function renderAnswerMarkdown(text: string, opts: RenderOptions): { markdown: string; media: number } {
  // Cite 是行内引用标记，复制成文字后保留一个灰色占位。
  const cleaned = text.replace(/<Cite\b[^>]*\/>/g, '〔引用〕');
  const nodes = parseDil(cleaned);
  const blocks: string[] = [];
  let media = 0;
  for (const node of nodes) {
    if (node.type === 'text') {
      const t = (node.text ?? '').trim();
      if (t) blocks.push(t);
      continue;
    }
    if (node.tag === 'Cite') continue;
    if (node.tag === 'divider') {
      blocks.push('---');
      continue;
    }
    if (node.tag === 'box' && isChoiceBox(node)) {
      const md = choiceMarkdown(node);
      if (md) blocks.push(md);
      continue;
    }
    if (node.tag === 'radio-group' || node.tag === 'radio' || node.tag === 'button') {
      const md = choiceMarkdown(node);
      if (md) blocks.push(md);
      continue;
    }
    if (node.tag === 'text') {
      const t = textContent(node).trim();
      if (t) blocks.push(t);
      continue;
    }
    const svg = componentSvg(node);
    const saved = opts.saveMedia(svg);
    if (saved.created) media++;
    blocks.push(`![](${saved.path})`);
  }
  return { markdown: blocks.join('\n\n').trim(), media };
}

/** 媒体文件名：内容哈希，重复导入不会重复写文件。 */
export function mediaFileName(svg: string): string {
  const hash = createHash('sha256').update(svg).digest('hex').slice(0, 16);
  return `${hash}.svg`;
}

/** 卡片正面内容哈希：重复导入时用来判断卡片是否被用户改过。 */
export function frontHash(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex').slice(0, 16);
}
