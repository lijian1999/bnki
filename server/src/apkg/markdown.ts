// Anki 字段 HTML → bnki Markdown（语法见 docs/contracts.md 第 4 节）。
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', lt: '<', gt: '>', amp: '&', quot: '"', apos: "'",
};

/** Anki 编辑器里的图片名可能被实体编码或 URL 编码过（空格、中文文件名） */
function lookupMedia(mediaMap: Map<string, string>, src: string): string | undefined {
  const decoded = decodeText(src);
  let uri = decoded;
  try { uri = decodeURIComponent(decoded); } catch { /* 不是合法的 URL 编码 */ }
  return mediaMap.get(src) ?? mediaMap.get(decoded) ?? mediaMap.get(uri);
}

export function ankiToMarkdown(html: string, mediaMap: Map<string, string>): string {
  let s = html.replace(/\[sound:[^\]]*\]/gi, '');
  // 挖空：{{c1::内容}} / {{c1::内容::提示}} → {{内容}}；:: 之前是内容
  s = s.replace(/\{\{c\d+::([\s\S]*?)\}\}/g, (_m, c: string) => {
    const i = c.indexOf('::');
    return `{{${i >= 0 ? c.slice(0, i) : c}}}`;
  });
  // 公式
  s = s.replace(/\\\(\s*([\s\S]+?)\s*\\\)/g, (_m, x: string) => `$${x}$`);
  s = s.replace(/\\\[\s*([\s\S]+?)\s*\\\]/g, (_m, x: string) => `\n\n$$${x}$$\n\n`);

  let out = '';
  const lists: { ol: boolean; n: number }[] = [];
  const nl = () => {
    if (out.length > 0 && !out.endsWith('\n')) out += '\n';
  };
  let last = 0;
  for (const m of s.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g)) {
    const before = s.slice(last, m.index);
    if (before) out += decodeText(before);
    last = (m.index ?? 0) + m[0].length;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    switch (tag) {
      case 'br':
        if (!closing) out += '\n';
        break;
      case 'div':
      case 'p':
        nl();
        break;
      case 'b':
      case 'strong':
        out += '**';
        break;
      case 'i':
      case 'em':
        out += '*';
        break;
      case 'u':
        out += closing ? '</u>' : '<u>';
        break;
      case 's':
      case 'strike':
      case 'del':
        out += '~~';
        break;
      case 'li':
        if (closing) out += '\n';
        else {
          nl();
          const cont = lists[lists.length - 1];
          if (cont && cont.ol) out += ++cont.n + '. ';
          else out += '- ';
        }
        break;
      case 'ul':
        if (!closing) lists.push({ ol: false, n: 0 });
        else lists.pop();
        break;
      case 'ol':
        if (!closing) lists.push({ ol: true, n: 0 });
        else lists.pop();
        break;
      case 'img': {
        const src = /src\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1];
        const mapped = src ? lookupMedia(mediaMap, src) : undefined;
        out += mapped ? `![](${mapped})` : '';
        break;
      }
      default:
        break; // 其他标签：去掉标签保留文字
    }
  }
  const rest = s.slice(last);
  if (rest) out += decodeText(rest);
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function decodeText(t: string): string {
  return t.replace(/&(nbsp|lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, tok: string) => {
    if (tok[0] === '#') {
      const code = tok[1] === 'x' ? parseInt(tok.slice(2), 16) : parseInt(tok.slice(1), 10);
      return code >= 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[tok] ?? m;
  });
}
