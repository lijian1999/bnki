/** 编辑器命令：工具栏按钮、菜单和快捷键都调这里，界面层只负责提示和弹窗。 */
import type { Editor } from '@tiptap/core';

/** 卡片内容的三个字段。 */
export type FieldKey = 'front' | 'hint' | 'back';

/** 只用编辑器命令就能完成的工具栏按钮（链接 / 公式 / 图片要开对话框或选文件，由界面层处理）。 */
export type Cmd = 'bold' | 'italic' | 'underline' | 'cloze' | 'clear' | 'undo' | 'redo' | 'ul' | 'ol' | 'quote' | 'code';

/** 块级命令。 */
export type BlockKind = 'p' | 'h1' | 'h2' | 'h3' | 'hr';

/** 命令的结果，界面对应不同提示：cross = 跨行，empty = 需要先选文字。 */
export type CmdResult = 'ok' | 'cross' | 'empty';

/** 工具栏按钮的激活态（键与 Cmd 一致，菜单按钮不算）。 */
export type ActiveMap = Partial<Record<Cmd, boolean>>;

/** 源码模式下可以照常加标记的命令，其余命令在源码模式里只是提示。 */
export const SOURCE_WRAP: Partial<Record<Cmd, readonly [string, string]>> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  cloze: ['{{', '}}'],
  underline: ['<u>', '</u>'],
};

/** 工具栏和快捷键对编辑器操作的入口，由弹窗实现后交给工具栏菜单用。 */
export interface EditorApi {
  cmd(c: Cmd): void;
  block(b: BlockKind): void;
  fontSize(fs: string | null): void;
  marker(attrs: { c?: string; s?: string }): void;
  textColor(tc: string): void;
  clearMarker(): void;
  link(): void;
  formula(): void;
  image(): void;
  /** 格式刷：sticky = 双击连续用，false = 用一次就退出。 */
  painter(sticky: boolean): void;
}

/** Tiptap 把实例挂在 view.dom 上（core 里 `dom.editor = this`），粘贴、拖放的处理函数要插内容就靠它。 */
export function editorOf(view: { dom: HTMLElement }): Editor | null {
  return (view.dom as HTMLElement & { editor?: Editor }).editor ?? null;
}

/** 选区落在哪些格式上 → 工具栏按钮是不是高亮。 */
export function activeState(ed: Editor): ActiveMap {
  return {
    bold: ed.isActive('bold'),
    italic: ed.isActive('italic'),
    underline: ed.isActive('underline'),
    cloze: ed.isActive('cloze'),
    ul: ed.isActive('bulletList'),
    ol: ed.isActive('orderedList'),
    quote: ed.isActive('blockquote'),
    code: ed.isActive('codeBlock'),
  };
}

/**
 * 挖空：跨行不做（要用户分行选），光标落在挖空里时取消整个挖空，
 * 其余情况加上或去掉挖空；无选区时之后的输入就是挖空。
 */
export function toggleCloze(ed: Editor): CmdResult {
  const { empty, $from, $to } = ed.state.selection;
  if (!empty && $from.parent !== $to.parent) return 'cross';
  if (empty && $from.marks().some((m) => m.type.name === 'cloze')) {
    ed.chain().focus().extendMarkRange('cloze').unsetMark('cloze').run();
    return 'ok';
  }
  ed.chain().focus().toggleMark('cloze').run();
  return 'ok';
}

/** 执行工具栏命令，返回结果让界面层决定要不要提示。 */
export function applyCmd(ed: Editor, cmd: Cmd): CmdResult {
  const chain = () => ed.chain().focus();
  switch (cmd) {
    case 'bold': chain().toggleBold().run(); return 'ok';
    case 'italic': chain().toggleItalic().run(); return 'ok';
    case 'underline': chain().toggleUnderline().run(); return 'ok';
    case 'cloze': return toggleCloze(ed);
    case 'clear': chain().unsetAllMarks().run(); return 'ok';
    case 'undo': ed.chain().undo().run(); return 'ok';
    case 'redo': ed.chain().redo().run(); return 'ok';
    case 'ul': chain().toggleBulletList().run(); return 'ok';
    case 'ol': chain().toggleOrderedList().run(); return 'ok';
    case 'quote': chain().toggleBlockquote().run(); return 'ok';
    case 'code': chain().toggleCodeBlock().run(); return 'ok';
    default: return 'ok';
  }
}

export function applyBlock(ed: Editor, kind: BlockKind): void {
  const chain = () => ed.chain().focus();
  if (kind === 'p') chain().setParagraph().run();
  else if (kind === 'hr') chain().setHorizontalRule().run();
  else chain().toggleHeading({ level: Number(kind.slice(1)) as 1 | 2 | 3 }).run();
}

/** 字号；null 是默认字号。 */
export function applyFontSize(ed: Editor, fs: string | null): void {
  if (fs === null) ed.chain().focus().unsetMark('fontSize').run();
  else ed.chain().focus().setMark('fontSize', { fs }).run();
}

/** 马克笔、划线：没有选区时不动，免得误改光标后面的输入。 */
export function applyMarker(ed: Editor, attrs: { c?: string; s?: string }): CmdResult {
  if (ed.state.selection.empty) return 'empty';
  ed.chain().focus().setMark('highlight', attrs).run();
  return 'ok';
}

export function applyTextColor(ed: Editor, tc: string): CmdResult {
  if (ed.state.selection.empty) return 'empty';
  ed.chain().focus().setMark('textColor', { tc }).run();
  return 'ok';
}

/** 清除马克笔和文字颜色，下划线留给“清除格式”管。 */
export function clearMarker(ed: Editor): void {
  ed.chain().focus().unsetMark('highlight').unsetMark('textColor').run();
}

/** 在文本里给选区两侧加标记，并还原选区。 */
export function wrapText(text: string, start: number, end: number, open: string, close: string): { text: string; from: number; to: number } {
  return {
    text: text.slice(0, start) + open + text.slice(start, end) + close + text.slice(end),
    from: start + open.length,
    to: end + open.length,
  };
}
