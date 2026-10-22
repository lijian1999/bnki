/* bnki 原型：Markdown ⇄ HTML。
 * 渲染：markdown-it + 自定义规则（挖空 {{x}}、马克笔 ==x==、公式 $x$ / $$x$$）。
 * 反向：turndown，把所见即所得编辑区的 HTML 转回 Markdown。
 * 正式实现会把这些规则放到 shared/markdown，编辑器（Tiptap）和渲染器共用。
 */
(function () {
  const md = window.markdownit({
    html: true,
    linkify: true,
    breaks: true,
    highlight(code, lang) {
      try {
        if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
        return hljs.highlightAuto(code).value;
      } catch (e) { return ''; }
    },
  });

  // {{挖空}}：同一行内，不嵌套；内部可以继续解析行内格式
  md.inline.ruler.before('emphasis', 'cloze', function (state, silent) {
    const src = state.src, start = state.pos;
    if (src.charCodeAt(start) !== 0x7b || src.charCodeAt(start + 1) !== 0x7b) return false;
    const end = findClozeEnd(src, start + 2, state.posMax);
    if (end < 0) return false;
    if (!silent) {
      const oldMax = state.posMax;
      state.push('cloze_open', 'span', 1).attrs = [['class', 'cloze']];
      state.pos = start + 2;
      state.posMax = end;
      state.md.inline.tokenize(state);
      state.posMax = oldMax;
      state.push('cloze_close', 'span', -1);
    }
    state.pos = end + 2;
    return true;
  });

  // 找挖空的结尾 }}：跳过 $公式$ 和 `代码`，因为 LaTeX 里经常有 }}
  function findClozeEnd(src, i, max) {
    while (i < max) {
      const ch = src[i];
      if (ch === '\n') return -1;
      if (ch === '$' || ch === '`') {
        const j = src.indexOf(ch, i + 1);
        if (j > i && j < max && src.slice(i, j).indexOf('\n') < 0) { i = j + 1; continue; }
      }
      if (ch === '}' && src[i + 1] === '}') return i;
      i++;
    }
    return -1;
  }

  // ==马克笔==
  md.inline.ruler.before('emphasis', 'mark', function (state, silent) {
    const src = state.src, start = state.pos;
    if (src.charCodeAt(start) !== 0x3d || src.charCodeAt(start + 1) !== 0x3d) return false;
    const end = src.indexOf('==', start + 2);
    if (end < 0 || end > state.posMax || end === start + 2) return false;
    if (!silent) {
      const oldMax = state.posMax;
      state.push('mark_open', 'mark', 1);
      state.pos = start + 2;
      state.posMax = end;
      state.md.inline.tokenize(state);
      state.posMax = oldMax;
      state.push('mark_close', 'mark', -1);
    }
    state.pos = end + 2;
    return true;
  });

  // $行内公式$
  md.inline.ruler.after('escape', 'math_inline', function (state, silent) {
    const src = state.src, start = state.pos;
    if (src[start] !== '$' || src[start + 1] === '$') return false;
    const end = src.indexOf('$', start + 1);
    if (end < 0 || end === start + 1) return false;
    if (!silent) {
      const t = state.push('math_inline', 'math', 0);
      t.content = src.slice(start + 1, end);
    }
    state.pos = end + 1;
    return true;
  });
  md.renderer.rules.math_inline = (tokens, i) => katexHTML(tokens[i].content, false);

  // $$块公式$$
  md.block.ruler.before('fence', 'math_block', function (state, startLine, endLine, silent) {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (state.src.slice(pos, pos + 2) !== '$$') return false;
    let line = startLine, content = '';
    const first = state.src.slice(pos + 2, max).trim();
    if (first.endsWith('$$') && first.length > 2) {
      content = first.slice(0, -2);
    } else {
      if (first) content = first + '\n';
      let found = false;
      while (++line < endLine) {
        const p = state.bMarks[line] + state.tShift[line], m = state.eMarks[line];
        const text = state.src.slice(p, m);
        if (text.trim().endsWith('$$')) { content += text.trim().slice(0, -2); found = true; break; }
        content += text + '\n';
      }
      if (!found) return false;
    }
    if (silent) return true;
    state.line = line + 1;
    const t = state.push('math_block', 'math', 0);
    t.content = content;
    t.map = [startLine, state.line];
    return true;
  });
  md.renderer.rules.math_block = (tokens, i) => '<div class="math-block">' + katexHTML(tokens[i].content, true) + '</div>';

  function katexHTML(tex, display) {
    try {
      const html = katex.renderToString(tex, { displayMode: display, throwOnError: false });
      // data-tex 让 turndown 能还原出原始 LaTeX
      return `<span class="math" data-tex="${escapeAttr(tex)}" data-display="${display ? 1 : 0}" contenteditable="false">${html}</span>`;
    } catch (e) { return `<code>${tex}</code>`; }
  }
  function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  function render(src) { return md.render(src || ''); }
  function renderInline(src) { return md.renderInline(src || ''); }

  // ---------- HTML → Markdown ----------
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    hr: '---',
  });
  td.addRule('cloze', {
    filter: (node) => node.nodeName === 'SPAN' && node.classList.contains('cloze'),
    replacement: (content) => (content.trim() ? '{{' + content + '}}' : ''),
  });
  td.addRule('math', {
    filter: (node) => node.nodeName === 'SPAN' && node.classList.contains('math'),
    replacement: (c, node) => {
      const tex = node.getAttribute('data-tex');
      return node.getAttribute('data-display') === '1' ? '\n\n$$\n' + tex + '\n$$\n\n' : '$' + tex + '$';
    },
  });
  td.addRule('mathBlock', {
    filter: (node) => node.nodeName === 'DIV' && node.classList.contains('math-block'),
    replacement: (c, node) => {
      const m = node.querySelector('.math');
      return '\n\n$$\n' + (m ? m.getAttribute('data-tex') : '') + '\n$$\n\n';
    },
  });
  td.addRule('mark', {
    filter: 'mark',
    replacement: (content, node) => {
      const c = node.getAttribute('data-c'), s = node.getAttribute('data-s');
      if (!c && !s) return '==' + content + '==';
      return `<mark${c ? ` data-c="${c}"` : ''}${s ? ` data-s="${s}"` : ''}>${content}</mark>`;
    },
  });
  td.addRule('underline', { filter: 'u', replacement: (c) => '<u>' + c + '</u>' });
  td.addRule('textColor', {
    filter: (node) => node.nodeName === 'SPAN' && node.hasAttribute('data-tc'),
    replacement: (c, node) => `<span data-tc="${node.getAttribute('data-tc')}">${c}</span>`,
  });
  // 列表项写成 “- x” / “1. x”，而不是 turndown 默认的 “-   x”
  td.addRule('listItem', {
    filter: 'li',
    replacement: (content, node) => {
      const parent = node.parentNode;
      let prefix = '- ';
      if (parent.nodeName === 'OL') {
        const start = parseInt(parent.getAttribute('start') || '1', 10);
        prefix = start + Array.prototype.indexOf.call(parent.children, node) + '. ';
      }
      const pad = ' '.repeat(prefix.length);
      content = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n(?!$)/g, '\n' + pad);
      return prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
    },
  });
  // GFM 表格
  td.addRule('table', {
    filter: 'table',
    replacement: (c, node) => {
      const rows = [...node.querySelectorAll('tr')].map((tr) => [...tr.children].map((cell) =>
        toMarkdown(cell.innerHTML).replace(/\n+/g, ' ').replace(/\|/g, '\\|')));
      if (!rows.length) return '';
      const n = Math.max(...rows.map((r) => r.length));
      const line = (r) => '| ' + Array.from({ length: n }, (_, i) => r[i] || '').join(' | ') + ' |';
      return '\n\n' + [line(rows[0]), '|' + ' --- |'.repeat(n), ...rows.slice(1).map(line)].join('\n') + '\n\n';
    },
  });
  // 正文里字面的 {{ 要转义，否则下次打开会变成挖空
  const baseEscape = td.escape.bind(td);
  td.escape = (str) => baseEscape(str).replace(/\{\{/g, '\\{{');
  td.addRule('strike',{ filter: ['del', 's', 'strike'], replacement: (c) => '~~' + c + '~~' });
  // 代码高亮产生的 span 不进 Markdown
  td.addRule('fencedCode', {
    filter: (node) => node.nodeName === 'PRE' && node.firstChild && node.firstChild.nodeName === 'CODE',
    replacement: (c, node) => {
      const code = node.firstChild;
      const m = (code.className || '').match(/language-(\S+)/);
      const text = code.textContent.replace(/\n$/, '');
      return '\n\n```' + (m ? m[1] : '') + '\n' + text + '\n```\n\n';
    },
  });

  function toMarkdown(html) {
    return td.turndown(html || '')
      .replace(/\u200B/g, '')           // 编辑器里用来放光标的零宽字符
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // 纯文本摘要（搜索、导图用）
  function plain(src) {
    return (src || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\{\{([^}]*)\}\}/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[#>*_`=~\-]+/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function countCloze(src) {
    const s = (src || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    return (s.match(/\{\{[^\n]*?\}\}/g) || []).length;
  }

  window.MD = { render, renderInline, toMarkdown, plain, countCloze };
})();
