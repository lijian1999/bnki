// 导出时的挖空处理：`{{x}}` 换成 `x`。`\{{` 是字面量、代码块和行内代码里原样保留，
// 跳过规则与 shared/src/markdown/plugins.ts 的 cloze 解析一致。

/** 这一行的结束位置（末行没有换行也算） */
function lineEnd(s: string, i: number): number {
  const n = s.indexOf('\n', i);
  return n < 0 ? s.length : n;
}

/** 从 from 之后找闭合的围栏行，返回代码块结束位置；找不到就取到文档末尾 */
function closingFence(s: string, from: number, char: string, len: number): number {
  const re = new RegExp(`^ {0,3}\\${char}{${len},}([ \\t]*)$`, 'm');
  let p = s.indexOf('\n', from);
  if (p < 0) return s.length;
  for (;;) {
    const end = lineEnd(s, p + 1);
    if (re.test(s.slice(p + 1, end))) return end;
    p = end;
    if (p >= s.length) return s.length;
  }
}

/** 从 i 起跳过一个 `` `…` `` 行内代码段；不是合法的行内代码就原样返回 i */
function codeSpan(s: string, i: number): { text: string; next: number } | null {
  let j = i;
  while (j < s.length && s[j] === '`') j++;
  const len = j - i;
  for (let k = j; k < s.length; ) {
    if (s[k] !== '`') {
      k++;
      continue;
    }
    let e = k;
    while (e < s.length && s[e] === '`') e++;
    if (e - k === len) return { text: s.slice(i, e), next: e };
    k = e; // 长度不一样，接着往后找
  }
  return null;
}

/** `{{` 之后找 `}}`：不跨行，公式和行内代码里的 `}}` 跳过 */
function closeCloze(s: string, i: number, max: number): number {
  while (i < max) {
    if (s[i] === '\n') return -1;
    const ch = s[i];
    if (ch === '$' || ch === '`') {
      const next = s.indexOf(ch, i + 1);
      if (next > i && next < max && !s.slice(i, next).includes('\n')) {
        i = next + 1;
        continue;
      }
    }
    if (ch === '}' && s[i + 1] === '}') return i;
    i++;
  }
  return -1;
}

/** 去掉 Markdown 里的挖空标记，只改标记本身，其余字符原样 */
export function unwrapCloze(md: string): string {
  if (!md.includes('{{')) return md;
  let out = '';
  let i = 0;
  const n = md.length;
  while (i < n) {
    // 代码块围栏：行首 0～3 个空格 + 3 个以上 ` 或 ~，整段原样
    if (i === 0 || md[i - 1] === '\n') {
      const head = lineEnd(md, i);
      const m = /^ {0,3}(`{3,}|~{3,})/.exec(md.slice(i, head));
      if (m) {
        const end = closingFence(md, head, m[1][0], m[1].length);
        out += md.slice(i, end);
        i = end;
        continue;
      }
    }
    if (md[i] === '`') {
      const span = codeSpan(md, i);
      if (span) {
        out += span.text;
        i = span.next;
        continue;
      }
    }
    // `\{{` 是字面量，连反斜杠一起留着
    if (md[i] === '\\' && md.startsWith('{{', i + 1)) {
      out += '\\{{';
      i += 3;
      continue;
    }
    if (md[i] === '{' && md[i + 1] === '{') {
      const end = closeCloze(md, i + 2, lineEnd(md, i));
      if (end > i + 2) {
        out += md.slice(i + 2, end);
        i = end + 2;
        continue;
      }
    }
    out += md[i];
    i += 1;
  }
  return out;
}
