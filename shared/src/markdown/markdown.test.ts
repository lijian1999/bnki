import { describe, expect, it } from 'vitest';
import { countCloze, plainText, renderInline, renderMarkdown } from './index';

describe('markdown 扩展渲染', () => {
  it('挖空渲染成带序号的 span', () => {
    expect(renderMarkdown('TCP 的第二步是 {{SYN+ACK}}。')).toContain(
      '<span class="cloze" data-i="0">SYN+ACK</span>',
    );
  });

  it('一段里两个挖空按顺序编号，重复调用都从 0 开始', () => {
    const src = '第一步 {{SYN}}，第二步 {{ACK}} 再确认';
    const html = renderMarkdown(src);
    expect(html).toContain('data-i="0"');
    expect(html).toContain('data-i="1"');
    expect(renderMarkdown(src)).toBe(html);
  });

  it('挖空里可以套加粗', () => {
    expect(renderMarkdown('{{**volatile**}}')).toContain(
      '<span class="cloze" data-i="0"><strong>volatile</strong></span>',
    );
  });

  it('挖空里可以套行内代码', () => {
    const html = renderMarkdown('{{`HashMap`}}');
    expect(html).toContain('<span class="cloze" data-i="0"><code>HashMap</code></span>');
  });

  it('挖空里可以套公式，只算一个挖空', () => {
    const src = '{{$x=\\frac{1}{2}$}}';
    const html = renderMarkdown(src);
    expect(html).toContain('class="cloze"');
    expect(html).toContain('class="math"');
    expect(html.match(/class="cloze"/g)).toHaveLength(1);
    expect(countCloze(src)).toBe(1);
  });

  it('空挖空、跨行挖空、转义后的花括号都不算挖空', () => {
    expect(renderMarkdown('{{}}')).not.toContain('class="cloze"');
    expect(renderMarkdown('{{a\nb}}')).not.toContain('class="cloze"');
    const escaped = renderMarkdown('\\{{x}}');
    expect(escaped).toContain('{{x}}');
    expect(escaped).not.toContain('class="cloze"');
  });

  it('代码块和行内代码里的花括号不算挖空', () => {
    const block = renderMarkdown('```\n{{x}}\n```');
    expect(block).not.toContain('class="cloze"');
    expect(countCloze('```\n{{x}}\n```')).toBe(0);
    const inline = renderMarkdown('值 `{{x}}` 后面');
    expect(inline).not.toContain('class="cloze"');
    expect(inline).toContain('<code>{{x}}</code>');
    expect(countCloze('值 `{{x}}` 后面')).toBe(0);
  });

  it('列表项和标题里的挖空都正常', () => {
    const list = renderMarkdown('- 进程是 {{资源分配}} 的基本单位');
    expect(list).toContain('<li>');
    expect(list).toContain('class="cloze"');
    expect(renderMarkdown('### {{x}}')).toContain('<span class="cloze" data-i="0">x</span>');
  });

  it('马克笔语法，挖空里也能套', () => {
    expect(renderMarkdown('==重点==')).toContain('<mark>重点</mark>');
    expect(renderMarkdown('{{==x==}}')).toContain('<span class="cloze" data-i="0"><mark>x</mark></span>');
  });

  it('白名单内的 HTML 标签原样保留', () => {
    expect(renderMarkdown('<mark data-c="red" data-s="wavy">x</mark>')).toContain(
      '<mark data-c="red" data-s="wavy">x</mark>',
    );
    expect(renderMarkdown('<u>x</u>')).toContain('<u>x</u>');
    expect(renderMarkdown('<span data-tc="blue">x</span>')).toContain('<span data-tc="blue">x</span>');
    expect(renderMarkdown('<span data-fs="22">x</span>')).toContain('<span data-fs="22">x</span>');
  });

  it('白名单外的 HTML 被转义', () => {
    for (const src of [
      '<script>alert(1)</script>',
      '<img src=x onerror=1>',
      '<span style="color:red">x</span>',
      '<mark data-c="black">x</mark>',
      '<div>x</div>',
    ]) {
      const html = renderMarkdown(src);
      expect(html).toContain('&lt;');
      expect(html).not.toMatch(/<(script|img)|<span style/);
    }
  });

  it('行内公式，两个 $ 之间的空白不产生公式', () => {
    const html = renderMarkdown('$x^2$');
    expect(html).toContain('class="math"');
    expect(html).toContain('data-tex="x^2"');
    expect(html).toContain('data-display="0"');
    expect(html).toContain('katex');
    expect(renderMarkdown('$5 和 $6')).not.toContain('class="math"');
  });

  it('块公式支持单行和多行', () => {
    for (const src of ['$$\ne^{i\\pi}+1=0\n$$', '$$x$$']) {
      const html = renderMarkdown(src);
      expect(html).toContain('<div class="math-block">');
      expect(html).toContain('data-display="1"');
    }
  });

  it('代码块有语法高亮，编辑器模式不高亮', () => {
    const src = '```java\npublic class A { int x = 1; }\n```';
    const html = renderMarkdown(src);
    expect(html).toContain('<pre><code class="language-java">');
    expect(html).toMatch(/class="hljs-/);
    const forEditor = renderMarkdown(src, { editor: true });
    expect(forEditor).not.toContain('hljs-');
    expect(forEditor).toContain('public class A { int x = 1; }');
  });

  it('media/ 图片改成本地路径，外部链接不动', () => {
    expect(renderMarkdown('![](media/ab12.png)')).toContain('<img src="/media/ab12.png" alt="">');
    const out = renderMarkdown('![x](https://a.com/b.png)');
    expect(out).toContain('<img src="https://a.com/b.png" alt="x">');
  });

  it('外链带 target，卡片链接留 data-card-link', () => {
    expect(renderMarkdown('[a](https://x.com)')).toContain('target="_blank"');
    expect(renderMarkdown('[卡](bnki://card/abc)')).toContain('data-card-link="abc"');
  });

  it('任务列表变成勾选框', () => {
    const html = renderMarkdown('- [ ] 待办\n- [x] 完成');
    expect(html).toContain('class="task"');
    expect(html).toContain('<input type="checkbox" disabled>');
    expect(html).toContain('<input type="checkbox" disabled checked>');
    expect(html).not.toContain('[ ]');
  });

  it('GFM 表格和删除线', () => {
    expect(renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')).toContain('<table>');
    expect(renderMarkdown('~~删除~~')).toContain('<s>删除</s>');
  });

  it('中文标点紧挨 ** 时加粗、斜体、删除线照样生效', () => {
    expect(renderMarkdown('**标题：**内容')).toContain('<strong>标题：</strong>内容');
    expect(renderMarkdown('前文**“引号”**后文')).toContain('前文<strong>“引号”</strong>后文');
    expect(renderMarkdown('{{**有效**}}**。**这是')).toContain('<strong>。</strong>这是');
    expect(renderMarkdown('中文*（括号）*中文')).toContain('<em>（括号）</em>');
    expect(renderMarkdown('中文~~（删）~~中文')).toContain('<s>（删）</s>');
    expect(renderMarkdown('😀**“表情”**后文')).toContain('<strong>“表情”</strong>');
    // 原有规则不受影响：外侧是空白不能开合，下划线仍不在词中生效
    expect(renderMarkdown('中文** 加粗**')).not.toContain('<strong>');
    expect(renderMarkdown('**中文**abc')).toContain('<strong>中文</strong>abc');
    expect(renderMarkdown('中_（文）_中')).not.toContain('<em>');
  });

  it('单个换行变成 br', () => {
    expect(renderMarkdown('a\nb')).toContain('<br>');
  });

  it('plainText 去掉标记只留文字', () => {
    expect(plainText('**进程**是 {{资源分配}} 的单位\n- a\n- b')).toBe('进程是 资源分配 的单位 a b');
    expect(plainText('看图 ![](media/a.png) 结束')).toContain('[图片]');
    expect(plainText('文字\n```java\nint x = 1;\n```\n尾')).toContain('int x = 1;');
  });

  it('countCloze 数出全部挖空', () => {
    expect(countCloze('{{a}} {{b}}\n- {{c}}')).toBe(3);
  });

  it('renderInline 行内渲染，不包 p', () => {
    const html = renderInline('**x** {{y}}');
    expect(html).toContain('<strong>x</strong>');
    expect(html).toContain('class="cloze"');
    expect(html).not.toContain('<p>');
  });
});
