// 卡片集页的纯逻辑：目录块、行布局、插入/拖拽/移动的落点计算。不依赖 React 和网络。
import type { CardItem, ID, Item, SectionItem } from '@bnki/shared';
import { plainText } from '@bnki/shared/markdown';

/** 目录块：[目录本身的下标, 下一个同级或更高级目录的下标（没有就是 items.length）) */
export function sectionBlock(items: Item[], sectionId: string): [number, number] {
  const i = items.findIndex((x) => x.id === sectionId);
  if (i < 0) return [items.length, items.length];
  const level = (items[i] as SectionItem).level;
  for (let j = i + 1; j < items.length; j++) {
    const x = items[j];
    if (x.kind === 'section' && x.level <= level) return [i, j];
  }
  return [i, items.length];
}

/** 页面上要显示的行。q 是搜索词（去掉首尾空白、不区分大小写）。 */
export type Row =
  | { kind: 'section'; item: SectionItem; count: number } // count = 这个目录块里的卡片数（含子目录里的）
  | { kind: 'cards'; cards: CardItem[] }; // 连续的一组卡片，渲染成一个网格

function isMatch(c: CardItem, q: string): boolean {
  return plainText(`${c.front} ${c.hint} ${c.back}`).toLowerCase().includes(q);
}

export function buildRows(items: Item[], q: string): Row[] {
  const query = q.trim().toLowerCase();
  const rows: Row[] = [];
  let grid: CardItem[] | null = null;
  // 折叠目录之后要隐藏到的层级（搜索时不用）
  let hiddenUntil: number | null = null;
  const flush = (): void => {
    if (grid) {
      rows.push({ kind: 'cards', cards: grid });
      grid = null;
    }
  };
  items.forEach((it, idx) => {
    if (it.kind === 'section') {
      if (!query && hiddenUntil !== null && it.level > hiddenUntil) return;
      hiddenUntil = null;
      flush();
      const [, end] = sectionBlock(items, it.id);
      let n = 0;
      for (let j = idx + 1; j < end; j++) if (items[j].kind === 'card') n++;
      rows.push({ kind: 'section', item: it, count: n });
      if (it.collapsed && !query) hiddenUntil = it.level;
    } else {
      if (hiddenUntil !== null) return;
      if (query && !isMatch(it, query)) return;
      if (!grid) grid = [];
      grid.push(it);
    }
  });
  flush();
  return rows;
}

/** 可见项 id（目录和卡片，按页面顺序），用于方向键、⇧ 点击、⌘A。 */
export function visibleIds(rows: Row[]): string[] {
  const out: string[] = [];
  for (const r of rows) if (r.kind === 'section') out.push(r.item.id);
  else for (const c of r.cards) out.push(c.id);
  return out;
}

/** 新建时的 afterId：选中项是折叠的目录时，返回它的目录块里最后一项的 id；否则返回选中项 id；没有选中返回 undefined（= 末尾）。 */
export function insertAfterId(items: Item[], selectedId: string | undefined): string | undefined {
  if (selectedId === undefined) return undefined;
  const it = items.find((x) => x.id === selectedId);
  if (!it) return undefined;
  if (it.kind === 'section' && it.collapsed) {
    const [, end] = sectionBlock(items, it.id);
    return items[end - 1].id;
  }
  return it.id;
}

/** 拖拽：把 dragId 放到 targetId 的前面（after=false）或后面（after=true）。
 *  拖的是目录且 onlyHeading=false 时带上整个目录块。目标在被拖的块里时返回 null。 */
export function computeDrop(
  items: Item[],
  dragId: ID,
  targetId: ID,
  after: boolean,
  onlyHeading: boolean,
): { ids: ID[]; afterId: ID | null } | null {
  const it = items.find((x) => x.id === dragId);
  if (!it) return null;
  const ids: ID[] =
    it.kind === 'section' && !onlyHeading ? items.slice(...sectionBlock(items, dragId)).map((x) => x.id) : [dragId];
  if (ids.includes(targetId)) return null;
  const gone = new Set(ids);
  const rest = items.filter((x) => !gone.has(x.id));
  const t = rest.findIndex((x) => x.id === targetId);
  if (t < 0) return null;
  if (!after) return { ids, afterId: t > 0 ? rest[t - 1].id : null };
  const tgt = rest[t];
  if (tgt.kind === 'section' && tgt.collapsed) {
    const [, end] = sectionBlock(rest, targetId);
    return { ids, afterId: rest[end - 1].id };
  }
  return { ids, afterId: targetId };
}

/** 把卡片移到某个目录块的末尾（只移动卡片，目录忽略）。 */
export function moveToSectionEnd(items: Item[], ids: ID[], sectionId: ID): { ids: ID[]; afterId: ID | null } {
  const wanted = new Set(ids);
  const moving = items.filter((x) => wanted.has(x.id) && x.kind === 'card') as CardItem[];
  const moved = new Set(moving.map((c) => c.id));
  const rest = items.filter((x) => !moved.has(x.id));
  const [, end] = sectionBlock(rest, sectionId);
  return { ids: moving.map((c) => c.id), afterId: rest.length ? rest[end - 1].id : null };
}

/** 卡片 → 它所在的各级目录 id（从外到内）。 */
export function sectionPaths(items: Item[]): Record<string, ID[]> {
  const out: Record<string, ID[]> = {};
  const stack: SectionItem[] = [];
  for (const it of items) {
    if (it.kind === 'section') {
      while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
      stack.push(it);
    } else {
      out[it.id] = stack.map((s) => s.id);
    }
  }
  return out;
}
