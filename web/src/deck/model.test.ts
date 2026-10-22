// 纯逻辑单元测试：目录块、行布局、落点计算。数据自己造。
import { describe, expect, it } from 'vitest';
import type { CardItem, Item, SectionItem } from '@bnki/shared';
import { buildRows, computeDrop, insertAfterId, moveToSectionEnd, sectionBlock, visibleIds } from './model';

function sec(id: string, level: 1 | 2 | 3, collapsed = false): SectionItem {
  return {
    id, deckId: 'd1', kind: 'section', position: 0, level,
    title: `目录${id}`, collapsed, createdAt: 1, updatedAt: 1,
  };
}

function card(id: string, front = `内容${id}`, hint = '', back = ''): CardItem {
  return {
    id, deckId: 'd1', kind: 'card', position: 0, cardType: 'note',
    front, hint, back, color: 'default', createdAt: 1, updatedAt: 1, state: null,
  };
}

describe('sectionBlock', () => {
  it('返回目录块的起止下标', () => {
    // 说明：按 sectionBlock 的定义（下一个同级或更高级目录截断），示例里的 C 得是 A 的嵌套子目录（level 2）才满足 A=[0,5)、B=[2,4)
    const items: Item[] = [sec('A', 1), card('a1'), sec('B', 2), card('b1'), sec('C', 2)];
    expect(sectionBlock(items, 'A')).toEqual([0, 5]);
    expect(sectionBlock(items, 'B')).toEqual([2, 4]);
  });
});

describe('buildRows', () => {
  const items: Item[] = [sec('A', 1), card('c1'), sec('B', 2), card('c2'), card('c3'), sec('C', 1)];

  it('折叠时隐藏块内全部内容，count 含子目录卡片', () => {
    const a = sec('A', 1, true);
    const rows = buildRows([a, ...items.slice(1)], '');
    expect(rows.map((r) => (r.kind === 'section' ? r.item.id : 'cards'))).toEqual(['A', 'C']);
    const rowA = rows[0];
    expect(rowA.kind === 'section' && rowA.count).toBe(3);
  });

  it('展开时目录和卡片按顺序出现，连续卡片合成一行', () => {
    const rows = buildRows(items, '');
    expect(rows.map((r) => (r.kind === 'section' ? `s:${r.item.id}` : `g:${r.cards.map((c) => c.id).join(',')}`))).toEqual([
      's:A', 'g:c1', 's:B', 'g:c2,c3', 's:C',
    ]);
    expect(visibleIds(rows)).toEqual(['A', 'c1', 'B', 'c2', 'c3', 'C']);
  });

  it('搜索时忽略折叠，只显示命中的卡片', () => {
    const a = sec('A', 1, true);
    const items2: Item[] = [a, card('c1', '苹果'), sec('B', 2), card('c2', '橘子')];
    const rows = buildRows(items2, '橘子');
    expect(rows.map((r) => (r.kind === 'section' ? `s:${r.item.id}` : `g:${r.cards.map((c) => c.id).join(',')}`))).toEqual([
      's:A', 's:B', 'g:c2',
    ]);
    expect(buildRows(items2, '不存在').some((r) => r.kind === 'cards')).toBe(false);
  });

  it('命中搜索词时折叠目录仍显示其块内卡片', () => {
    const a = sec('A', 1, true);
    const rows = buildRows([a, card('c1', '挖空'), sec('B', 2), card('c2', '别的')], '挖空');
    expect(visibleIds(rows)).toContain('c1');
    expect(visibleIds(rows)).not.toContain('c2');
  });
});

describe('insertAfterId', () => {
  const items: Item[] = [sec('A', 1, true), sec('s', 2), card('b1'), sec('C', 1)];

  it('选中折叠目录 → 块里最后一项', () => {
    expect(insertAfterId(items, 'A')).toBe('b1');
  });
  it('选中展开项 → 它自己', () => {
    expect(insertAfterId(items, 'C')).toBe('C');
  });
  it('没有选中 → undefined', () => {
    expect(insertAfterId(items, undefined)).toBeUndefined();
  });
});

describe('computeDrop', () => {
  it('卡片拖到另一张卡片前面', () => {
    const items: Item[] = [sec('A', 1), card('1'), card('2'), card('3')];
    expect(computeDrop(items, '3', '1', false, false)).toEqual({ ids: ['3'], afterId: 'A' });
  });

  it('带块拖拽时目标在块里返回 null', () => {
    const items: Item[] = [sec('A', 1), card('1'), card('2'), card('3')];
    expect(computeDrop(items, 'A', '3', true, false)).toBeNull();
  });

  it('只拖目录标题（onlyHeading）到块内后面', () => {
    const items: Item[] = [sec('A', 1), card('1'), card('2'), card('3')];
    expect(computeDrop(items, 'A', '3', true, true)).toEqual({ ids: ['A'], afterId: '3' });
  });

  it('拖到第一项前面 afterId 为 null', () => {
    const items: Item[] = [sec('A', 1), card('1'), card('2')];
    expect(computeDrop(items, '2', 'A', false, false)).toEqual({ ids: ['2'], afterId: null });
  });

  it('目标折叠目录时 afterId 是它块里最后一项', () => {
    const items: Item[] = [sec('A', 1), card('1'), sec('B', 1, true), card('2')];
    expect(computeDrop(items, '1', 'B', true, false)).toEqual({ ids: ['1'], afterId: '2' });
  });
});

describe('moveToSectionEnd', () => {
  it('卡片移到目录块末尾，忽略目录 id', () => {
    const items: Item[] = [sec('A', 1), card('c1'), sec('B', 1), card('c2'), card('c3')];
    expect(moveToSectionEnd(items, ['c1', 'A'], 'B')).toEqual({ ids: ['c1'], afterId: 'c3' });
    // 卡片本来就在 A 块最前时，块末尾仍是 A 后面紧接的位置
    expect(moveToSectionEnd(items, ['c1'], 'A')).toEqual({ ids: ['c1'], afterId: 'A' });
  });
});
