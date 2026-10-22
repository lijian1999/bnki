// 框选的几何计算：纯函数，不碰 DOM。坐标都是视口坐标（getBoundingClientRect / clientX 同一坐标系）。
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 两点围成的矩形（起点终点任意方向）。 */
export function rectFrom(x1: number, y1: number, x2: number, y2: number): Rect {
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
}

/** 和 box 相交（边接触不算）的条目 id，按 rects 的顺序。 */
export function hitIds(box: Rect, rects: { id: string; rect: Rect }[]): string[] {
  return rects
    .filter((r) => box.left < r.rect.right && box.right > r.rect.left && box.top < r.rect.bottom && box.bottom > r.rect.top)
    .map((r) => r.id);
}
