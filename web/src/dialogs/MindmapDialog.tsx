// 导图（非 AI）：按目录层级生成树，卡片取正面第一行纯文本；照原型 mindmapDialog。
import type { JSX } from 'react';
import type { Item } from '@bnki/shared';
import { plainText } from '@bnki/shared/markdown';
import { useDeck, useItems } from '../queries';
import { Modal, DialogHead } from '../ui/Modal';

export interface DeckDialogProps {
  deckId: string;
  onClose: () => void;
}

export interface MindNode {
  label: string;
  leaf?: boolean;
  children: MindNode[];
}

export function buildMindmap(title: string, items: Item[]): MindNode {
  const root: MindNode = { label: title, children: [] };
  const stack: { level: number; node: MindNode }[] = [{ level: 0, node: root }];
  for (const it of items) {
    if (it.kind === 'section') {
      while (stack[stack.length - 1].level >= it.level) stack.pop();
      const n: MindNode = { label: it.title, children: [] };
      stack[stack.length - 1].node.children.push(n);
      stack.push({ level: it.level, node: n });
    } else {
      const first = plainText(it.front.split('\n')[0] ?? '').trim().slice(0, 26);
      stack[stack.length - 1].node.children.push({ label: first || '（图片）', leaf: true, children: [] });
    }
  }
  return root;
}

function Node(props: { n: MindNode; root?: boolean }): JSX.Element {
  const { n } = props;
  return (
    <div className={'mm-node' + (props.root ? ' mm-root' : '')}>
      <div className="mm-label" style={n.leaf ? { background: 'var(--panel)' } : undefined} title={n.label}>
        {n.label}
      </div>
      {n.children.length > 0 && (
        <div className="mm-children">
          {n.children.map((c, i) => <Node n={c} key={i} />)}
        </div>
      )}
    </div>
  );
}

export default function MindmapDialog(props: DeckDialogProps): JSX.Element {
  const { deckId, onClose } = props;
  const deck = useDeck(deckId).data;
  const items = useItems(deckId).data;
  const root = deck && items ? buildMindmap(deck.title, items) : null;
  return (
    <Modal light onClose={onClose} className="mindmap-dialog">
      <DialogHead title="导图" onClose={onClose} />
      <div className="dialog-body">
        <div className="mindmap" style={{ overflow: 'auto' }}>{root && <Node n={root} root />}</div>
      </div>
    </Modal>
  );
}
