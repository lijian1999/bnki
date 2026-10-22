// Markdown → renderMarkdown(editor) → Tiptap → docToMarkdown 应该原样回来（编辑器打开再保存不改内容）。
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { renderMarkdown } from '@bnki/shared/markdown';
import { editorExtensions, docToMarkdown } from './schema';

const roundtrip = (src: string) => {
  const ed = new Editor({ extensions: editorExtensions(), content: renderMarkdown(src, { editor: true }) });
  const out = docToMarkdown(ed.state.doc);
  ed.destroy();
  return out;
};

const SAMPLES = [
  '进程是 {{**资源**分配}} 的单位',
  '==黄== <mark data-c="red" data-s="wavy">红波</mark> <span data-tc="blue">蓝</span> <span data-fs="22">大</span> <u>下</u>',
  '**粗** *斜* ~~删~~ `code` [链](https://x.com)',
  '公式 $x^2$ 行内',
  '$$\n\\sum_i i\n$$',
  '## 标题\n\n段落一\n第二行\n\n段落二',
  '- a\n- b\n  - c',
  '1. 一\n2. 二',
  '- [ ] 待办\n- [x] 完成',
  '> 引用\n> 第二行',
  '```java\nint x = 1;\n// {{no}}\n```',
  '| 甲 | 乙 |\n| --- | --- |\n| 1 | **2** |',
  '![](media/ab12.png)',
  '\\{{ 字面 \\==b \\$5',
  '---',
];

describe('Markdown 往返', () => {
  for (const src of SAMPLES) {
    it(JSON.stringify(src), () => {
      expect(roundtrip(src)).toBe(src);
    });
  }
});
