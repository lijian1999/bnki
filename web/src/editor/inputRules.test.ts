// 行内 Markdown 输入规则：中文紧挨着标记时也要转换（StarterKit 自带的规则要求标记前是空白或行首）。
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions, docToMarkdown } from './schema';

/** 一个字一个字地“敲”进去，和真实输入一样经过 handleTextInput（输入规则就挂在这里） */
function typed(chars: string): string {
  const ed = new Editor({ extensions: editorExtensions(), content: '<p></p>' });
  for (const ch of chars) {
    const { from, to } = ed.state.selection;
    const view = ed.view;
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
  const out = docToMarkdown(ed.state.doc);
  ed.destroy();
  return out;
}

describe('行内输入规则', () => {
  it.each([
    ['是**调度**单位', '是**调度**单位'],
    ['是*斜体*字', '是*斜体*字'],
    ['用`code`写', '用`code`写'],
    ['已~~删除~~了', '已~~删除~~了'],
    ['是==重点==啊', '是==重点==啊'],
    ['进程是{{资源}}的', '进程是{{资源}}的'],
    ['a **b** c', 'a **b** c'],
  ])('%s', (input, md) => {
    expect(typed(input)).toBe(md);
  });

  it('没有闭合时保持原文', () => {
    // 原文里的 * 输出时要转义，所以只断言没有变成格式
    expect(typed('2*3=6')).not.toContain('*3=6*');
  });
});
