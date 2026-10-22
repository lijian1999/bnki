/** 卡片字段：所见即所得（Tiptap）和 Markdown 源码两种形态，主题卡用纯文本输入框。 */
import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Placeholder } from '@tiptap/extensions';
import type { Editor } from '@tiptap/core';
import { renderMarkdown } from '@bnki/shared/markdown';
import { api } from '../api';
import { toast } from '../ui/toast';
import { editorExtensions } from './schema';
import { editorOf } from './commands';
import type { FieldKey } from './commands';
import type { ReactNode, JSX } from 'react';

/** 长得像 Markdown 的纯文本：粘贴时按 Markdown 解析（判断照原型）。 */
const MD_TEXT = /(^|\n)\s*([-*] |\d+\. |#{1,6} |> |```)|\{\{|\*\*|==|\$/;

const isImage = (f: File): boolean => f.type.startsWith('image/');

/** 文本域按内容增高，最小 110px（原型 autoGrow）。 */
export function grow(t: HTMLTextAreaElement): void {
  t.style.height = 'auto';
  t.style.height = Math.max(110, t.scrollHeight + 4) + 'px';
}

/** 上传并插到光标处。 */
async function uploadInto(ed: Editor, file: File): Promise<void> {
  try {
    const { path } = await api.media.upload(file);
    ed.chain().focus().setImage({ src: '/' + path }).run();
  } catch {
    toast('图片上传失败');
  }
}

/** 光标前正好敲了第二个 [ 时返回插入点（[[ 后面），不该触发时返回 null。 */
export function cardLinkAt(ed: Editor): number | null {
  const { empty, $from } = ed.state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  // 代码块、行内公式里不算；行内代码看光标处的 mark
  if (ed.isActive('codeBlock') || ed.isActive('code')) return null;
  if ($from.nodeBefore?.type.name === 'mathInline' || $from.nodeAfter?.type.name === 'mathInline') return null;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 2), $from.parentOffset, undefined, '\ufffc');
  // 中文输入法下 [ 打出来是【
  return before === '[[' || before === '【【' ? $from.pos : null;
}

export interface RichFieldProps {
  field: FieldKey;
  label: string;
  placeholder: string;
  value: string;
  src: boolean;
  focused: boolean;
  small?: boolean;
  /** 源码模式里改了文本。 */
  onInput(v: string): void;
  /** 编辑器内容变了（改过内容要提示能保存 / 放弃）。 */
  onDirty(): void;
  onFocusField(): void;
  onSelection(): void;
  onToggleSrc(): void;
  onImage(): void;
  /** 输入了 [[，要开卡片链接选择框（参数是 [[ 之后的位置）。 */
  onCardLink?(from: number): void;
  register(ed: Editor | null): void;
  /** 源码模式的文本域，工具栏要拿它的光标选区。 */
  registerText(el: HTMLTextAreaElement | null): void;
}

export function RichField(p: RichFieldProps): JSX.Element {
  // 编辑器实例的回调只在创建时建一次，运行时要拿最新的界面状态就从这里走
  const cur = useRef(p);
  cur.current = p;
  const ta = useRef<HTMLTextAreaElement | null>(null);

  const editor = useEditor(
    {
      extensions: [...editorExtensions(), Placeholder.configure({ placeholder: p.placeholder, showOnlyCurrent: false })],
      content: p.value ? renderMarkdown(p.value, { editor: true }) : '',
      editorProps: {
        handlePaste: (view, e) => {
          const cd = e.clipboardData;
          if (!cd) return false;
          const files = Array.from(cd.files).filter(isImage);
          if (files.length) {
            e.preventDefault();
            const ed = editorOf(view);
            if (ed) files.forEach((f) => void uploadInto(ed, f));
            return true;
          }
          const text = cd.getData('text/plain');
          if (!text || cd.getData('text/html') || !MD_TEXT.test(text)) return false;
          e.preventDefault();
          editorOf(view)?.chain().focus().insertContent(renderMarkdown(text, { editor: true })).run();
          return true;
        },
        handleDrop: (view, e) => {
          const files = Array.from(e.dataTransfer?.files ?? []).filter(isImage);
          if (!files.length) return false;
          e.preventDefault();
          const ed = editorOf(view);
          if (!ed) return true;
          const pos = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos ?? null;
          const range = pos ?? { from: ed.state.selection.from, to: ed.state.selection.to };
          files.forEach((f) => {
            void api.media
              .upload(f)
              .then(({ path }) =>
                ed.chain().focus().insertContentAt(range, { type: 'image', attrs: { src: '/' + path } }).run(),
              )
              .catch(() => toast('图片上传失败'));
          });
          return true;
        },
      },
      onUpdate: ({ editor: ed, transaction: tr }) => {
        cur.current.onDirty();
        // 文档变长、光标前正好是 [[ 才弹：键盘、输入法、自动化输入都走这里；删字退回到 [[ 后面不弹
        if (tr.getMeta('paste') || tr.doc.content.size <= tr.before.content.size) return;
        const at = cardLinkAt(ed);
        if (at !== null) cur.current.onCardLink?.(at);
      },
      onFocus: () => {
        cur.current.onFocusField();
        cur.current.onSelection();
      },
      onSelectionUpdate: () => cur.current.onSelection(),
    },
    // options 只在创建时读一次，字段名不变就不重建实例
    [p.field],
  );

  useEffect(() => {
    p.register(editor);
    return () => p.register(null);
  }, [editor]);

  return (
    <div className={'field' + (p.focused ? ' focus' : '')}>
      <span className="field-label">{p.label}</span>
      <div className="field-tools">
        <button className={p.src ? 'on' : ''} title="切换 Markdown 源码" onClick={p.onToggleSrc}>
          M↓ 源码
        </button>
      </div>
      {p.src ? (
        <textarea
          className="src"
          value={p.value}
          placeholder={p.placeholder}
          spellCheck={false}
          ref={(el) => {
            ta.current = el;
            cur.current.registerText(el);
            if (el) grow(el);
          }}
          onChange={(e) => {
            const el = e.currentTarget;
            cur.current.onInput(el.value);
            grow(el);
          }}
          onFocus={p.onFocusField}
        />
      ) : (
        <div className={'wysiwyg md' + (p.small ? ' small' : '')} onFocus={p.onFocusField}>
          <EditorContent editor={editor} />
        </div>
      )}
      <div className="field-foot">
        <button title="插入图片（也可以直接粘贴、拖入）" onClick={p.onImage}>
          🖼
        </button>
      </div>
    </div>
  );
}

export interface TopicProps {
  front: string;
  back: string;
  active: FieldKey | null;
  onInput(f: FieldKey, v: string): void;
  onFocusField(f: FieldKey): void;
  register(f: FieldKey, el: HTMLTextAreaElement | HTMLInputElement | null): void;
}

/** 主题卡：标题加纯文本内容，样式和图片在这里活不下来。 */
export function TopicFields(p: TopicProps): JSX.Element {
  const area = (f: FieldKey, node: ReactNode) => <div className={'field' + (p.active === f ? ' focus' : '')}>{node}</div>;
  return (
    <>
      {area(
        'front',
        <>
          <span className="field-label">标题</span>
          <input
            className="text-input"
            style={{ border: 0, fontSize: 17, fontWeight: 600, height: 48, padding: '0 14px' }}
            value={p.front}
            placeholder="主题标题"
            onChange={(e) => p.onInput('front', e.currentTarget.value)}
            onFocus={() => p.onFocusField('front')}
            ref={(el) => {
              p.register('front', el);
            }}
          />
        </>,
      )}
      {area(
        'back',
        <>
          <span className="field-label">内容（纯文本，无样式）</span>
          <textarea
            className="src"
            style={{ fontFamily: 'inherit', fontSize: 14, background: 'none' }}
            value={p.back}
            placeholder="内容"
            onChange={(e) => {
              p.onInput('back', e.currentTarget.value);
              grow(e.currentTarget);
            }}
            onFocus={() => p.onFocusField('back')}
            ref={(el) => {
              p.register('back', el);
              if (el) grow(el);
            }}
          />
        </>,
      )}
    </>
  );
}
