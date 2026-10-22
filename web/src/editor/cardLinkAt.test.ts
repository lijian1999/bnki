// [[ 触发点：光标在文字末尾、两段文字之间、代码里。
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { renderMarkdown } from '@bnki/shared/markdown';
import { editorExtensions } from './schema';
import { cardLinkAt } from './fields';

function at(src: string, offsetFromEnd = 0): number | null {
  const ed = new Editor({ extensions: editorExtensions(), content: renderMarkdown(src, { editor: true }) });
  ed.commands.setTextSelection(ed.state.doc.content.size - 1 - offsetFromEnd);
  const r = cardLinkAt(ed);
  ed.destroy();
  return r;
}

describe('cardLinkAt', () => {
  it('段尾的 [[ 和【【触发', () => {
    expect(at('参见 [[')).not.toBeNull();
    expect(at('参见【【')).not.toBeNull();
  });
  it('加粗后面紧跟 [[ 也触发', () => {
    expect(at('**粗**[[')).not.toBeNull();
  });
  it('[[ 在中间、光标不紧跟时不触发', () => {
    expect(at('[[ 后面', 2)).toBeNull();
    expect(at('只有 [')).toBeNull();
  });
  it('行内代码里不触发', () => {
    expect(at('`a[[`', 0)).toBeNull();
  });
});
