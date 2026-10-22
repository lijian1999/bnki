/** 格式刷：把一处文字的“格式”刷到另一处。
 * 只算 7 种格式 mark；挖空、链接、行内代码是内容不是格式，既不读也不改。 */
import type { Editor } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';

export const PAINT_MARKS: readonly string[] = ['bold', 'italic', 'underline', 'strike', 'highlight', 'textColor', 'fontSize'];

const isPaint = (m: Mark): boolean => PAINT_MARKS.includes(m.type.name);

/** 取选区起点处的格式；没有选区（光标）时先看存下的输入格式，再看光标位置。 */
export function captureFormat(ed: Editor): Mark[] {
  const { empty, $from, from } = ed.state.selection;
  // 有选区时取第一个字本身的 mark；$from.marks() 在格式边界上拿到的是前一个字的
  const marks = empty ? (ed.state.storedMarks ?? $from.marks()) : (ed.state.doc.nodeAt(from)?.marks ?? $from.marks());
  return marks.filter(isPaint);
}

/** 在一个事务里去掉选区里的格式、加上 marks，撤销一次就能回到原样。空选区不做任何事。 */
export function applyFormat(ed: Editor, marks: Mark[]): boolean {
  const { empty, from, to } = ed.state.selection;
  if (empty) return false;
  let tr = ed.state.tr;
  for (const name of PAINT_MARKS) {
    const type = ed.state.schema.marks[name];
    if (type) tr = tr.removeMark(from, to, type);
  }
  for (const m of marks) tr = tr.addMark(from, to, m);
  ed.view.dispatch(tr);
  return true;
}
