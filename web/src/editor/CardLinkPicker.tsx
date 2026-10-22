/** 卡片链接选择框：编辑器里输入 [[ 时弹出，搜全部卡片（contracts 3.10）。 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { plainText } from '@bnki/shared/markdown';
import { api, type SearchHit } from '../api';
import { Modal, DialogHead } from '../ui/Modal';
import type { JSX } from 'react';

export interface CardLinkPickerProps {
  onPick(hit: { id: string; label: string }): void;
  onClose(): void;
}

/** 第一行：先取源文件里的第一行，再去掉标记，最多 40 字（plainText 会把换行压成空格）。 */
function labelOf(front: string): string {
  const line = plainText((front.split('\n')[0] ?? '').trim()).trim();
  return line.length > 40 ? line.slice(0, 40) : line;
}

export default function CardLinkPicker(props: CardLinkPickerProps): JSX.Element {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const [done, setDone] = useState(false);
  // 防抖之外再挡一层迟到的回应，免得旧结果盖掉新结果
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    if (!q) {
      setHits([]);
      setDone(false);
      return;
    }
    const t = setTimeout(() => {
      api
        .search(q, 20)
        .then((r) => {
          if (seq.current !== mine) return;
          setHits(r);
          setSel(0);
          setDone(true);
        })
        .catch(() => {
          if (seq.current !== mine) return;
          setHits([]);
          setDone(true);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (hit: SearchHit): void => {
    const label = labelOf(hit.front);
    props.onPick({ id: hit.id, label: label || '卡片' });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hits.length) return;
      const step = e.key === 'ArrowDown' ? 1 : hits.length - 1;
      setSel((i) => (i + step) % hits.length);
    } else if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing || !hits.length) return;
      e.preventDefault();
      pick(hits[sel]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };

  return (
    <Modal light className="card-link-dialog" onClose={props.onClose}>
      <DialogHead title="插入卡片链接" onClose={props.onClose} />
      <div className="dialog-body">
        <input
          className="text-input"
          placeholder="搜索卡片内容"
          value={q}
          autoFocus
          onChange={(e) => {
            setQ(e.currentTarget.value);
            setDone(false);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="cl-list">
          {hits.map((h, i) => (
            <div
              key={h.id}
              className={'cl-hit' + (i === sel ? ' on' : '')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(h)}
            >
              <div className="cl-front">{labelOf(h.front) || '卡片'}</div>
              <div className="cl-deck">{h.deckTitle}</div>
            </div>
          ))}
          {done && !hits.length && <div className="hint-text">没有找到</div>}
        </div>
      </div>
    </Modal>
  );
}
