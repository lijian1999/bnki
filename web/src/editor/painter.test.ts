// 格式刷的纯函数：编辑器建法照 roundtrip.test.ts，结果用 docToMarkdown 断言。
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { renderMarkdown } from '@bnki/shared/markdown';
import { editorExtensions, docToMarkdown } from './schema';
import { PAINT_MARKS, applyFormat, captureFormat } from './painter';

function open(src: string): Editor {
  return new Editor({ extensions: editorExtensions(), content: renderMarkdown(src, { editor: true }) });
}

/** 文字在文档里的绝对位置（只找第一处）。 */
function rangeOf(ed: Editor, target: string): [number, number] {
  let found: [number, number] | null = null;
  ed.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return;
    const i = node.textContent.indexOf(target);
    if (i >= 0) found = [pos + i, pos + i + target.length];
  });
  if (!found) throw new Error(`文档里找不到“${target}”`);
  return found;
}

function select(ed: Editor, target: string): void {
  const [from, to] = rangeOf(ed, target);
  ed.chain().setTextSelection({ from, to }).run();
}

describe('格式刷', () => {
  it('七种格式都在名单里', () => {
    expect(PAINT_MARKS).toEqual(['bold', 'italic', 'underline', 'strike', 'highlight', 'textColor', 'fontSize']);
  });

  it('光标处的格式能刷到别处', () => {
    const ed = open('**粗** 普通');
    const [at] = rangeOf(ed, '粗');
    ed.chain().setTextSelection(at).run();
    const marks = captureFormat(ed);
    expect(marks.map((m) => m.type.name)).toEqual(['bold']);
    select(ed, '普通');
    expect(applyFormat(ed, marks)).toBe(true);
    expect(docToMarkdown(ed.state.doc)).toBe('**粗** **普通**');
    ed.destroy();
  });

  it('字号刷过去会换掉马克笔', () => {
    const ed = open('<span data-fs="22">大</span> ==黄== 字');
    select(ed, '大');
    const marks = captureFormat(ed);
    expect(marks.map((m) => m.type.name)).toEqual(['fontSize']);
    select(ed, '黄');
    expect(applyFormat(ed, marks)).toBe(true);
    const out = docToMarkdown(ed.state.doc);
    expect(out).not.toContain('==黄==');
    expect(out).toContain('<span data-fs="22">黄</span>');
    ed.destroy();
  });

  it('刷格式不会碰挖空', () => {
    const ed = open('**a** {{b}}');
    select(ed, 'a');
    const marks = captureFormat(ed);
    select(ed, 'b');
    expect(applyFormat(ed, marks)).toBe(true);
    const out = docToMarkdown(ed.state.doc);
    expect(out).toContain('{{');
    expect(out).toContain('**b**');
    ed.destroy();
  });

  it('空选区什么都不做', () => {
    const ed = open('**粗** 普通');
    const [at] = rangeOf(ed, '粗');
    ed.chain().setTextSelection(at).run();
    const marks = captureFormat(ed);
    select(ed, '普通');
    const before = docToMarkdown(ed.state.doc);
    ed.chain().setTextSelection(at).run();
    expect(applyFormat(ed, marks)).toBe(false);
    expect(docToMarkdown(ed.state.doc)).toBe(before);
    ed.destroy();
  });
});

describe('格式刷边界', () => {
  it('选区从加粗文字的开头开始时取到加粗', () => {
    const ed = new Editor({ extensions: editorExtensions(), content: renderMarkdown('普通**粗** 尾巴', { editor: true }) });
    let start = 0;
    ed.state.doc.descendants((n, pos) => {
      if (n.isText && n.text === '粗') start = pos;
    });
    ed.commands.setTextSelection({ from: start, to: start + 1 });
    expect(captureFormat(ed).map((m) => m.type.name)).toEqual(['bold']);
    ed.destroy();
  });
});
