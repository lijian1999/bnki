// 工具栏：顺序和图标照原型（去掉格式刷）。所有按钮按下时不让编辑器失焦。
import { MARK_COLORS, TEXT_COLORS, FONT_SIZES } from '@bnki/shared';
import { closeMenu, openMenu, type MenuItem } from '../ui/menu';
import type { ActiveMap, EditorApi } from './commands';
import type { CSSProperties, MouseEvent, ReactNode, JSX } from 'react';

/** 色块和文字色的取值见原型。 */
const MARK_HEX: Record<string, string> = { yellow: '#fff1a8', green: '#c9f0d6', blue: '#cfe2ff', red: '#ffd6d6', purple: '#e6d9ff' };
const MARK_NAME: Record<string, string> = { yellow: '黄（==x==）', green: '绿', blue: '蓝', red: '红', purple: '紫' };
const TEXT_HEX: Record<string, string> = { red: '#e5484d', blue: '#2f6fe0', green: '#1f9d5c', grey: '#a1a1a6' };
const TEXT_NAME: Record<string, string> = { red: '红', blue: '蓝', green: '绿', grey: '灰' };
const FONT_NAME: Record<string, string> = { '12': '小号', '16': '中号', '22': '大号', '26': '特大' };

function Tb(props: {
  label: ReactNode;
  title: string;
  cls?: string;
  on?: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}): JSX.Element {
  return (
    <button
      className={'tb' + (props.cls ? ' ' + props.cls : '') + (props.on ? ' on' : '')}
      title={props.title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

const clearIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M2.5 3h8M6.5 3v10M10.5 10l3.5 3.5M14 10l-3.5 3.5" />
  </svg>
);

/** 一行色块：菜单里点色块就执行并收起菜单。 */
function Row(props: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ padding: '4px 8px 6px' }}>
      <div className="hint-text" style={{ margin: '0 0 4px' }}>{props.title}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{props.children}</div>
    </div>
  );
}

function Chip(props: { title: string; style?: CSSProperties; children: ReactNode; onClick: () => void }): JSX.Element {
  return (
    <span
      title={props.title}
      style={{ cursor: 'pointer', ...props.style }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { closeMenu(); props.onClick(); }}
    >
      {props.children}
    </span>
  );
}

function Swatch(props: { hex: string; title: string; onClick: () => void }): JSX.Element {
  return (
    <Chip title={props.title} onClick={props.onClick}>
      <span className="swatch" style={{ width: 22, height: 22, background: props.hex }} />
    </Chip>
  );
}

function headingMenu(t: EditorApi): MenuItem[] {
  const items: MenuItem[] = [
    { label: '正文', onClick: () => t.block('p') },
    { label: '一级标题', kbd: '# ', onClick: () => t.block('h1') },
    { label: '二级标题', kbd: '## ', onClick: () => t.block('h2') },
    { label: '三级标题', kbd: '### ', onClick: () => t.block('h3') },
    '-',
    { label: '分隔线', onClick: () => t.block('hr') },
    { header: '字号' },
    ...FONT_SIZES.map((fs) => ({ label: `${FONT_NAME[fs]} ${fs}`, onClick: () => t.fontSize(fs) })),
    { label: '默认字号', onClick: () => t.fontSize(null) },
  ];
  return items;
}

/** 马克笔菜单：马克笔 5 色、划线 2 种、文字颜色 4 种，最后是清除。 */
function markerMenu(t: EditorApi): MenuItem[] {
  return [
    {
      render: () => (
        <Row title="马克笔">
          {MARK_COLORS.map((c) => (
            <Swatch key={c} hex={MARK_HEX[c]} title={MARK_NAME[c]} onClick={() => t.marker(c === 'yellow' ? {} : { c })} />
          ))}
        </Row>
      ),
    },
    {
      render: () => (
        <Row title="划线">
          <Chip title="马克笔下划线" style={{ height: 24 }} onClick={() => t.marker({ s: 'line' })}>
            <span className="chip" style={{ height: 24 }}>▁ 下划线</span>
          </Chip>
          <Chip title="波浪线" style={{ height: 24 }} onClick={() => t.marker({ s: 'wavy' })}>
            <span className="chip" style={{ height: 24, textDecoration: 'underline wavy #e5484d' }}>波浪线</span>
          </Chip>
        </Row>
      ),
    },
    {
      render: () => (
        <Row title="文字颜色">
          {TEXT_COLORS.map((c) => (
            <Chip key={c} title={TEXT_NAME[c]} onClick={() => t.textColor(c)}>
              <b style={{ color: TEXT_HEX[c] }}>A</b>
            </Chip>
          ))}
        </Row>
      ),
    },
    '-',
    { label: '清除马克笔和颜色', onClick: () => t.clearMarker() },
  ];
}

export default function Toolbar(props: { api: EditorApi; on: ActiveMap }): JSX.Element {
  const t = props.api;
  const open = (items: MenuItem[]) => (e: MouseEvent<HTMLButtonElement>) => openMenu(e.currentTarget, items);
  return (
    <div className="editor-toolbar">
      <Tb label="T ▾" title="正文 / 标题" onClick={open(headingMenu(t))} />
      <Tb label="🖍 ▾" title="马克笔、划线、文字颜色" onClick={open(markerMenu(t))} />
      <span className="tb-sep" />
      <Tb label={<b>B</b>} title="加粗 ⌘B" on={props.on.bold} onClick={() => t.cmd('bold')} />
      <Tb label={<i>I</i>} title="斜体 ⌘I" on={props.on.italic} onClick={() => t.cmd('italic')} />
      <Tb label={<u>U</u>} title="下划线 ⌘U" on={props.on.underline} onClick={() => t.cmd('underline')} />
      <Tb label="[ 挖空 ]" title="挖空 ⌘E（也可以直接输入 {{答案}}）" cls="cloze-btn" on={props.on.cloze} onClick={() => t.cmd('cloze')} />
      <span className="tb-sep" />
      <Tb label={clearIcon} title="清除格式" onClick={() => t.cmd('clear')} />
      <Tb label="🔗" title="链接" onClick={t.link} />
      <Tb label="↶" title="撤销 ⌘Z" onClick={() => t.cmd('undo')} />
      <Tb label="↷" title="恢复 ⌘⇧Z" onClick={() => t.cmd('redo')} />
      <span className="tb-sep" />
      <Tb label="•≡" title="无序列表（输入“- ”）" on={props.on.ul} onClick={() => t.cmd('ul')} />
      <Tb label="1≡" title="有序列表（输入“1. ”）" on={props.on.ol} onClick={() => t.cmd('ol')} />
      <Tb label="❝" title="引用（输入“> ”）" on={props.on.quote} onClick={() => t.cmd('quote')} />
      <Tb label="</>" title="代码块（输入 ```）" on={props.on.code} onClick={() => t.cmd('code')} />
      <Tb label="∑" title="插入公式（LaTeX）" onClick={t.formula} />
      <Tb label="🖼" title="插入图片" onClick={t.image} />
    </div>
  );
}
