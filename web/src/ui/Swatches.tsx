// 颜色色块：照原型 swatchesEl 输出 10 个色块，点选后关菜单。
import { CARD_COLORS, type CardColor } from '@bnki/shared';
import { closeMenu } from './menu';
import type { JSX } from 'react';

export function Swatches(props: { current: CardColor; onPick: (c: CardColor) => void }): JSX.Element {
  return (
    <div className="swatches">
      {CARD_COLORS.map((c) => (
        <span
          key={c.key}
          className={'swatch' + (c.key === props.current ? ' on' : '')}
          title={c.name}
          style={{ background: c.hex }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { closeMenu(); props.onPick(c.key); }}
        />
      ))}
    </div>
  );
}
