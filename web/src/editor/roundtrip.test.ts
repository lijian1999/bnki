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
  '见 [进程](bnki://card/abc123) 一节',
  '**标题：**内容，前文**“引号”**后文',
  '段落一\n\n<br>\n\n<br>\n\n段落二',
  '第一行\n<br>第三行',
  '段落\n\n<br><br>开头空两行',
  '- 列表\n\n<br>\n\n段落',
];

describe('Markdown 往返', () => {
  for (const src of SAMPLES) {
    it(JSON.stringify(src), () => {
      expect(roundtrip(src)).toBe(src);
    });
  }
});

describe('空行', () => {
  const toMd = (html: string) => {
    const ed = new Editor({ extensions: editorExtensions(), content: html });
    const out = docToMarkdown(ed.state.doc);
    ed.destroy();
    return out;
  };

  it('段落之间的空段落保留成 <br>，首尾的丢掉', () => {
    expect(toMd('<p>a</p><p></p><p>b</p>')).toBe('a\n\n<br>\n\nb');
    expect(toMd('<p></p><p>a</p><p></p><p></p>')).toBe('a');
  });

  it('连按两次换行不会并成一次', () => {
    expect(toMd('<p>a<br><br>b</p>')).toBe('a\n<br>b');
    expect(toMd('<p>a<br>b<br></p>')).toBe('a\nb');
    expect(toMd('<p>a</p><p><br><br>b</p>')).toBe('a\n\n<br><br>b');
  });

  it('保存的空行在编辑器里是空段落，不是段内换行', () => {
    const ed = new Editor({ extensions: editorExtensions(), content: renderMarkdown('a\n\n<br>\n\nb', { editor: true }) });
    expect(ed.getJSON().content?.map((n) => n.content?.length ?? 0)).toEqual([1, 0, 1]);
    ed.destroy();
  });

  it('保存后的空行在显示时还是空行', () => {
    expect(renderMarkdown('a\n\n<br>\n\nb')).toContain('<p><br></p>');
    expect(renderMarkdown('a\n<br>b')).toContain('a<br>\n<br>b');
  });
});
