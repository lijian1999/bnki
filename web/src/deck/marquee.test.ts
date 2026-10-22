import { describe, expect, it } from 'vitest';
import { hitIds, rectFrom, type Rect } from './marquee';

const box: Rect = { left: 0, top: 0, right: 10, bottom: 10 };
const r = (id: string, rect: Rect): { id: string; rect: Rect } => ({ id, rect });

describe('rectFrom', () => {
  it('方向无关', () => {
    expect(rectFrom(10, 8, 3, 2)).toEqual({ left: 3, top: 2, right: 10, bottom: 8 });
    expect(rectFrom(3, 2, 10, 8)).toEqual(rectFrom(10, 8, 3, 2));
  });

  it('两点相同得到零面积矩形', () => {
    expect(rectFrom(5, 5, 5, 5)).toEqual({ left: 5, top: 5, right: 5, bottom: 5 });
  });
});

describe('hitIds', () => {
  it('部分相交', () => {
    expect(hitIds(box, [r('a', { left: 5, top: 5, right: 20, bottom: 20 })])).toEqual(['a']);
  });

  it('完全包含', () => {
    expect(hitIds(box, [r('a', { left: 2, top: 3, right: 4, bottom: 4 })])).toEqual(['a']);
  });

  it('只碰边不算', () => {
    expect(hitIds(box, [r('a', { left: 10, top: 0, right: 20, bottom: 10 })])).toEqual([]);
    expect(hitIds(box, [r('a', { left: -5, top: -5, right: 0, bottom: 0 })])).toEqual([]);
  });

  it('完全不相交', () => {
    expect(hitIds(box, [r('a', { left: 30, top: 30, right: 40, bottom: 40 })])).toEqual([]);
  });

  it('按传入顺序返回', () => {
    const rects = [
      r('c1', { left: 20, top: 20, right: 30, bottom: 30 }),
      r('c2', { left: 9, top: 9, right: 30, bottom: 30 }),
      r('c3', { left: 1, top: 1, right: 2, bottom: 2 }),
    ];
    expect(hitIds(box, rects)).toEqual(['c2', 'c3']);
  });
});
