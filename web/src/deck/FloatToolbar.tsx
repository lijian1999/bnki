// 选中项上方居中的浮动工具栏：portal 进 #main，位置 = 第一个选中项上方（照原型 placeFloatToolbar）。
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CARD_COLORS, type CardColor, type ID, type Item } from '@bnki/shared';
import { openMenu } from '../ui/menu';
import { Swatches } from '../ui/Swatches';
import type { DeckActions } from './menus';
import { cardMenu, sectionMenu } from './menus';
import type { JSX, MouseEvent as RMouseEvent } from 'react';

const LEVEL_NAMES = ['一', '二', '三', '四', '五'];

function colorHex(c: CardColor): string {
  return CARD_COLORS.find((x) => x.key === c)?.hex ?? '#ffffff';
}

export default function FloatToolbar(props: { items: Item[]; selIds: ID[]; actions: DeckActions }): JSX.Element | null {
  const { items, selIds, actions } = props;
  const barRef = useRef<HTMLDivElement>(null);
  const main = typeof document !== 'undefined' ? document.getElementById('main') : null;

  const first = items.find((x) => x.id === selIds[0]);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const target = document.querySelector<HTMLElement>(`[data-item="${selIds[0]}"]`);
    if (!bar || !main || !target) return;
    const r = target.getBoundingClientRect();
    const mr = main.getBoundingClientRect();
    bar.style.top = r.top - mr.top + main.scrollTop + 'px';
    bar.style.left = Math.max(8, r.left - mr.left + r.width / 2 - bar.offsetWidth / 2) + 'px';
  });

  if (!main || !first) return null;

  const cardIds = selIds.filter((id) => items.find((x) => x.id === id)?.kind === 'card');
  const firstColor = first.kind === 'card' ? first.color : 'default';
  const pickColor = (e: RMouseEvent<HTMLButtonElement>) => {
    const anchor = e.currentTarget;
    openMenu(anchor, [
      {
        render: () => (
          <Swatches
            current={firstColor}
            onPick={(c) => {
              cardIds.forEach((id) => actions.patchItem(id, { color: c }));
              void actions.rememberColor(c);
            }}
          />
        ),
      },
    ]);
  };
  const moveMenu = (e: RMouseEvent<HTMLButtonElement>) => {
    openMenu(
      e.currentTarget,
      items
        .filter((x) => x.kind === 'section')
        .map((x) => ({ label: '　'.repeat(x.level - 1) + x.title, onClick: () => actions.moveToSection(selIds, x.id) })),
    );
  };
  const levelMenu = (e: RMouseEvent<HTMLButtonElement>) => {
    if (first.kind !== 'section') return;
    const cur = first.level;
    openMenu(
      e.currentTarget,
      [1, 2, 3, 4, 5].map((l) => ({
        label: `${LEVEL_NAMES[l - 1]}级目录`,
        checked: cur === l,
        onClick: () => actions.patchItem(first.id, { level: l as 1 | 2 | 3 | 4 | 5 }),
      })),
    );
  };
  const more = (e: RMouseEvent<HTMLButtonElement>) => {
    openMenu(e.currentTarget, first.kind === 'card' ? cardMenu(actions, first) : sectionMenu(actions, first));
  };
  const renameFirst = () => actions.renameSection(first.id);
  const del = () => actions.deleteItems(selIds);

  let children: JSX.Element[];
  if (selIds.length > 1) {
    children = [
      <span key="n" style={{ padding: '0 8px', fontSize: 12 }}>
        已选 {selIds.length} 项
      </span>,
      <span key="sep" className="sep" />,
      <button key="color" title="颜色" onClick={pickColor}>
        <span className="swatch" style={{ background: '#fff' }} />
      </button>,
      <button key="move" title="移动到目录" onClick={moveMenu}>
        ⇥
      </button>,
      <button key="del" title="删除" onClick={del}>
        🗑
      </button>,
    ];
  } else if (first.kind === 'card') {
    children = [
      <button key="open" title="展开（Enter）" onClick={() => actions.openViewerFor(first.id)}>
        ⤢
      </button>,
      <button key="edit" title="编辑（E）" onClick={() => actions.openEditor({ deckId: actions.deckId, cardId: first.id })}>
        ✎
      </button>,
      <button key="color" title="卡片颜色" onClick={pickColor}>
        <span className="swatch" style={{ background: colorHex(first.color) }} />
      </button>,
      <button key="del" title="删除（⌫）" onClick={del}>
        🗑
      </button>,
      <span key="sep" className="sep" />,
      <button key="more" title="更多" onClick={more}>
        ⋯
      </button>,
    ];
  } else {
    children = [
      <button key="rename" title="编辑标题" onClick={renameFirst}>
        ✎
      </button>,
      <button key="level" title="目录级别" onClick={levelMenu}>
        {`H${first.level} ${LEVEL_NAMES[first.level - 1]}级目录 ▾`}
      </button>,
      <button key="del" title="删除目录" onClick={del}>
        🗑
      </button>,
      <span key="sep" className="sep" />,
      <button key="more" title="更多" onClick={more}>
        ⋯
      </button>,
    ];
  }

  return createPortal(<div className="float-toolbar" ref={barRef}>{children}</div>, main);
}
