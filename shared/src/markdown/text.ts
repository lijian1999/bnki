/** 从 Markdown 里取纯文本和挖空个数（搜索、朗读、导图用）。 */
import type MarkdownIt from 'markdown-it';

type Tokens = ReturnType<MarkdownIt['parse']>;

/** 标记换成空格：块之间、换行都算一个分隔，最后合并空白 */
function collect(tokens: Tokens, out: string[]): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'inline':
        if (token.children) collect(token.children, out);
        break;
      case 'text':
      case 'code_inline':
      case 'code_block':
      case 'fence':
      case 'math_inline':
      case 'math_block':
        out.push(token.content);
        break;
      case 'image':
        out.push('[图片]');
        break;
      case 'softbreak':
      case 'hardbreak':
      case 'cloze_open':
      case 'cloze_close':
        out.push(' ');
        break;
      case 'html_inline':
      case 'html_block':
        break;
      default:
        // 块级标记算一个分隔；加粗之类的行内标记不产生文字
        if (token.block) out.push(' ');
        break;
    }
  }
}

export function plainText(md: MarkdownIt, src: string): string {
  const out: string[] = [];
  collect(md.parse(src, {}), out);
  return out.join('').replace(/\s+/g, ' ').trim();
}

export function countCloze(md: MarkdownIt, src: string): number {
  let n = 0;
  const walk = (tokens: Tokens): void => {
    for (const token of tokens) {
      if (token.type === 'cloze_open') n++;
      if (token.children) walk(token.children);
    }
  };
  walk(md.parse(src, {}));
  return n;
}
