import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions, docToMarkdown } from './schema';

const md = (html: string) => {
  const ed = new Editor({ extensions: editorExtensions(), content: html });
  const out = docToMarkdown(ed.state.doc);
  ed.destroy();
  return out;
};

describe('docToMarkdown', () => {
  it('挖空包在格式最外层', () => {
    expect(md('<p>进程是 <span class="cloze" data-i="0"><strong>资源</strong>分配</span> 单位</p>')).toBe('进程是 {{**资源**分配}} 单位');
  });
  it('马克笔、文字颜色、下划线、链接、公式', () => {
    expect(
      md('<p><mark>黄</mark> <mark data-c="red" data-s="wavy">红波</mark> <span data-tc="blue">蓝</span> <span data-fs="22">大</span> <u>下</u> <a href="https://x.com">链</a> <span class="math" data-tex="x^2" data-display="0">K</span></p>'),
    ).toBe('==黄== <mark data-c="red" data-s="wavy">红波</mark> <span data-tc="blue">蓝</span> <span data-fs="22">大</span> <u>下</u> [链](https://x.com) $x^2$');
  });
  it('扩展语法的字面量被转义', () => {
    expect(md('<p>{{ a==b $5 &lt;u&gt; | <code>a*b</code></p>')).toBe('\\{{ a\\==b \\$5 \\<u> \\| `a*b`');
  });
  it('块级：标题、公式块、图片、列表、任务、引用、代码、表格', () => {
    const out = md(`<h2>标题</h2><div class="math-block"><span class="math" data-tex="\\sum_i i" data-display="1">K</span></div>
<p><img src="/media/ab12.png" alt=""></p><ol><li><p>一</p></li><li><p>二</p><ul><li><p>子</p></li></ul></li></ol>
<ul><li class="task"><input type="checkbox" disabled> 待办</li><li class="task"><input type="checkbox" disabled checked> 完成</li></ul>
<blockquote><p>引用</p></blockquote><pre><code class="language-java">int x = 1;
// {{no}}</code></pre><table><thead><tr><th>甲</th><th>乙</th></tr></thead><tbody><tr><td>1</td><td><strong>2</strong></td></tr></tbody></table>`);
    expect(out).toBe(`## 标题

$$
\\sum_i i
$$

![](media/ab12.png)

1. 一
2. 二
   - 子

- [ ] 待办
- [x] 完成

> 引用

\`\`\`java
int x = 1;
// {{no}}
\`\`\`

| 甲 | 乙 |
| --- | --- |
| 1 | **2** |`);
  });
  it('段内换行写成换行，列表和引用里行首的标记被转义', () => {
    expect(md('<p>a<br>b</p>')).toBe('a\nb');
    expect(md('<ul><li><p>x<br>- y</p></li></ul>')).toBe('- x\n  \\- y');
    expect(md('<blockquote><p>q1<br>q2</p></blockquote>')).toBe('> q1\n> q2');
    expect(md('<ul><li><p>a<br>1. b<br># c</p></li></ul>')).toBe('- a\n  1\\. b\n  \\# c');
    expect(md('<p>- top</p>')).toBe('\\- top');
  });
});

describe('输入规则', () => {
  const type = (ed: Editor, text: string) => {
    for (const ch of text) {
      const { from, to } = ed.state.selection;
      const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)));
      if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to));
    }
  };
  it('{{x}} 和 ==x== 自动转换', () => {
    const ed = new Editor({ extensions: editorExtensions(), content: '<p></p>' });
    ed.commands.focus('end');
    type(ed, '进程是{{资源}}的==单位==');
    expect(docToMarkdown(ed.state.doc)).toBe('进程是{{资源}}的==单位==');
    expect(ed.getHTML()).toContain('<span class="cloze">资源</span>');
    expect(ed.getHTML()).toContain('<mark>单位</mark>');
    ed.destroy();
  });
});

describe('快捷键', () => {
  it('Mod-e 不再触发行内代码（留给挖空）', () => {
    const ed = new Editor({ extensions: editorExtensions(), content: '<p>abc</p>' });
    ed.commands.setTextSelection({ from: 1, to: 4 });
    const ev = new KeyboardEvent('keydown', { key: 'e', ctrlKey: true });
    ed.view.someProp('handleKeyDown', (f) => f(ed.view, ev));
    expect(ed.getHTML()).toBe('<p>abc</p>');
    ed.destroy();
  });
});
