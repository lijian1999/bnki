/** 编辑器的 Tiptap 扩展，以及文档 → Markdown 的序列化。
 * Markdown → 编辑器：用 renderMarkdown(src, { editor: true }) 得到 HTML，再交给 Tiptap 解析；
 * 这里的 parseHTML 规则对应 docs/contracts.md 第 4 节的 HTML 结构。
 */
import { Extension, Mark, Node, mergeAttributes, markInputRule, type AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Code from '@tiptap/extension-code';
import { TableKit } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { MarkdownSerializer, type MarkdownSerializerState } from 'prosemirror-markdown';
import type { Node as PMNode } from '@tiptap/pm/model';
import katex from 'katex';

// 挖空：priority 高、互斥，保证它包在加粗等格式的最外层（{{**资源**分配}}）
export const Cloze = Mark.create({
  name: 'cloze',
  priority: 1000,
  excludes: 'cloze',
  parseHTML: () => [{ tag: 'span.cloze' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { class: 'cloze' }), 0],
  // 直接敲 {{文字}} 转成挖空
  addInputRules() {
    return [markInputRule({ find: /\{\{([^{}\n]+)\}\}$/, type: this.type })];
  },
});

// 马克笔：<mark>，可带 data-c（颜色）、data-s（line / wavy）
export const Highlight = Mark.create({
  name: 'highlight',
  addAttributes: () => ({
    c: { default: null, parseHTML: (el) => el.getAttribute('data-c'), renderHTML: (a) => (a.c ? { 'data-c': a.c } : {}) },
    s: { default: null, parseHTML: (el) => el.getAttribute('data-s'), renderHTML: (a) => (a.s ? { 'data-s': a.s } : {}) },
  }),
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: ({ HTMLAttributes }) => ['mark', HTMLAttributes, 0],
  // ==文字== 转成黄色马克笔
  addInputRules() {
    return [markInputRule({ find: /==([^=\n]+)==$/, type: this.type })];
  },
});

// 文字颜色：<span data-tc="red|blue|green|grey">
export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes: () => ({
    tc: { default: null, parseHTML: (el) => el.getAttribute('data-tc'), renderHTML: (a) => ({ 'data-tc': a.tc }) },
  }),
  parseHTML: () => [{ tag: 'span[data-tc]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
});

// 字号：<span data-fs="12|16|22|26">
export const FontSize = Mark.create({
  name: 'fontSize',
  addAttributes: () => ({
    fs: { default: null, parseHTML: (el) => el.getAttribute('data-fs'), renderHTML: (a) => ({ 'data-fs': a.fs }) },
  }),
  parseHTML: () => [{ tag: 'span[data-fs]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
});

function katexView(tex: string, display: boolean, tag: 'span' | 'div') {
  const dom = document.createElement(tag);
  dom.className = display ? 'math-block' : 'math';
  dom.setAttribute('data-tex', tex);
  try {
    katex.render(tex, dom, { throwOnError: false, displayMode: display });
  } catch {
    dom.textContent = tex;
  }
  return dom;
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ tex: { default: '', parseHTML: (el) => el.getAttribute('data-tex') || '' } }),
  parseHTML: () => [{ tag: 'span.math[data-display="0"]' }],
  renderHTML: ({ node }) => ['span', { class: 'math', 'data-tex': node.attrs.tex, 'data-display': '0' }, node.attrs.tex],
  addNodeView: () => ({ node }) => ({ dom: katexView(node.attrs.tex, false, 'span') }),
});

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  addAttributes: () => ({ tex: { default: '' } }),
  parseHTML: () => [
    { tag: 'div.math-block', getAttrs: (el) => ({ tex: (el as HTMLElement).querySelector('.math')?.getAttribute('data-tex') || '' }) },
  ],
  renderHTML: ({ node }) => [
    'div',
    { class: 'math-block' },
    ['span', { class: 'math', 'data-tex': node.attrs.tex, 'data-display': '1' }, node.attrs.tex],
  ],
  addNodeView: () => ({ node }) => ({ dom: katexView(node.attrs.tex, true, 'div') }),
});

// 任务列表：renderMarkdown 输出 <ul><li class="task"><input type="checkbox" disabled [checked]> x</li></ul>
const BTaskList = TaskList.extend({
  parseHTML: () => [
    { tag: 'ul', priority: 60, getAttrs: (el) => ((el as HTMLElement).querySelector(':scope > li.task') ? {} : false) },
  ],
});
const BTaskItem = TaskItem.extend({
  parseHTML: () => [{ tag: 'li.task', priority: 60 }],
  addAttributes() {
    return {
      checked: {
        default: false,
        keepOnSplit: false,
        parseHTML: (el) => !!(el.querySelector('input') as HTMLInputElement | null)?.checked,
      },
    };
  },
});

const lowlight = createLowlight(common);

/**
 * StarterKit 的 **x** / *x* / ~~x~~ 规则要求标记前是空白或行首，中文里几乎从不成立。
 * 这里只要求前一个字不是同一种标记符；用后行断言，前一个字不进匹配，转换时不会被删掉。
 */
const CjkMarkRules = Extension.create({
  name: 'cjkMarkRules',
  addInputRules() {
    const m = this.editor.schema.marks;
    return [
      markInputRule({ find: /(?<![*\\])\*\*([^*\n]+)\*\*$/, type: m.bold }),
      markInputRule({ find: /(?<![*\\])\*([^*\n]+)\*$/, type: m.italic }),
      markInputRule({ find: /(?<![~\\])~~([^~\n]+)~~$/, type: m.strike }),
    ];
  },
});

/** 编辑器用的全部扩展（不含 Placeholder 这类只影响界面的扩展，调用方自己追加）。 */
export function editorExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({ code: false, codeBlock: false, trailingNode: false, link: { openOnClick: false, protocols: ['bnki'] } }),
    // ⌘E 留给挖空（Code 默认把 Mod-e 绑成行内代码）
    Code.extend({ addKeyboardShortcuts: () => ({}) }),
    CodeBlockLowlight.configure({ lowlight }),
    CjkMarkRules,
    Cloze,
    Highlight,
    TextColor,
    FontSize,
    MathInline,
    MathBlock,
    Image.configure({ inline: true }),
    TableKit,
    BTaskList,
    BTaskItem,
  ];
}

const attr = (k: string, v: unknown) => (v ? ` ${k}="${v}"` : '');

// 行首在列表、引用里（前面是缩进或 "> "）时，prosemirror-markdown 不会转义行首的 - + > # 1.，这里补上
function text(s: MarkdownSerializerState, n: PMNode) {
  let t = n.text || '';
  s.write();
  const st = s as unknown as { out: string; delim: string };
  if (st.delim && (st.out.endsWith('\n' + st.delim) || st.out === st.delim)) {
    const m = /^(\+(?= )|-(?= |$)|>|#{1,6}(?=\s|$)|\d+(?=\. ))/.exec(t);
    if (m) {
      const num = /^\d/.test(m[0]);
      st.out += num ? m[0] + '\\.' : '\\' + m[0];
      t = t.slice(m[0].length + (num ? 1 : 0));
    }
  }
  s.text(t);
}

const serializer = new MarkdownSerializer(
  {
    doc: (s, n) => s.renderContent(n),
    paragraph: (s, n) => {
      s.renderInline(n);
      s.closeBlock(n);
    },
    heading: (s, n) => {
      s.write(s.repeat('#', n.attrs.level) + ' ');
      s.renderInline(n, false);
      s.closeBlock(n);
    },
    blockquote: (s, n) => s.wrapBlock('> ', null, n, () => s.renderContent(n)),
    bulletList: (s, n) => s.renderList(n, '  ', () => '- '),
    orderedList: (s, n) => {
      const start = n.attrs.start || 1;
      s.renderList(n, '   ', (i) => `${start + i}. `);
    },
    listItem: (s, n) => s.renderContent(n),
    taskList: (s, n) => s.renderList(n, '  ', () => '- '),
    taskItem: (s, n) => {
      s.write(n.attrs.checked ? '[x] ' : '[ ] ');
      s.renderContent(n);
    },
    codeBlock: (s, n) => {
      const fence = n.textContent.includes('```') ? '````' : '```';
      s.write(fence + (n.attrs.language || '') + '\n');
      s.text(n.textContent, false);
      s.ensureNewLine();
      s.write(fence);
      s.closeBlock(n);
    },
    horizontalRule: (s, n) => {
      s.write('---');
      s.closeBlock(n);
    },
    // breaks 开启：段内单个换行就是 <br>；末尾的换行丢掉
    hardBreak: (s, n, parent, index) => {
      for (let j = index + 1; j < parent.childCount; j++) {
        if (parent.child(j).type !== n.type) {
          s.ensureNewLine();
          return;
        }
      }
    },
    image: (s, n) =>
      s.write(`![${s.esc(n.attrs.alt || '')}](${String(n.attrs.src || '').replace(/^\/media\//, 'media/')})`),
    mathInline: (s, n) => s.write('$' + n.attrs.tex + '$'),
    mathBlock: (s, n) => {
      s.write('$$\n' + n.attrs.tex + '\n$$');
      s.closeBlock(n);
    },
    table: (s, n) => {
      n.forEach((row, _o, ri) => {
        s.write('|');
        row.forEach((cell) => {
          s.write(' ');
          cell.forEach((p, _p, pi) => {
            if (pi) s.write('<br>');
            s.renderInline(p);
          });
          s.write(' |');
        });
        s.ensureNewLine();
        if (ri === 0) {
          s.write('|' + ' --- |'.repeat(row.childCount));
          s.ensureNewLine();
        }
      });
      s.closeBlock(n);
    },
    text,
  },
  {
    bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
    italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    underline: { open: '<u>', close: '</u>' },
    cloze: { open: '{{', close: '}}' },
    highlight: {
      open: (_s, m) => (m.attrs.c || m.attrs.s ? `<mark${attr('data-c', m.attrs.c)}${attr('data-s', m.attrs.s)}>` : '=='),
      close: (_s, m) => (m.attrs.c || m.attrs.s ? '</mark>' : '=='),
    },
    textColor: { open: (_s, m) => `<span data-tc="${m.attrs.tc}">`, close: '</span>' },
    fontSize: { open: (_s, m) => `<span data-fs="${m.attrs.fs}">`, close: '</span>' },
    link: { open: '[', close: (_s, m) => `](${m.attrs.href})` },
    code: { open: '`', close: '`', escape: false },
  },
  // 扩展语法的字面量：{{、==、$、<标签、表格分隔符
  { escapeExtraCharacters: /\{\{|==|\$|<(?=[a-zA-Z/])|\|/g },
);

/** 编辑器文档 → Markdown（去掉首尾空白）。 */
export function docToMarkdown(doc: PMNode): string {
  return serializer.serialize(doc, { tightLists: true }).trim();
}
