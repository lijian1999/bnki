// 弹出菜单：行为、类名照原型 openMenu（分隔线 .ms、标题 .mh、菜单项 .mi、kbd 在右 .kbd）。
import type { ReactNode } from 'react';

export type MenuActionItem = {
  label: string;
  icon?: string;
  kbd?: string;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  sub?: () => MenuItem[];
};

export type MenuItem =
  | '-'
  | null
  | undefined
  | false
  | { header: string }
  | { render: () => ReactNode }
  | MenuActionItem;

export interface MenuPlacement {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface MenuState {
  items: MenuItem[];
  /** 锚点矩形；自定义坐标入口（{x,y}）时 left=right=x、top=bottom=y。 */
  anchor: MenuPlacement;
  alignRight?: boolean;
}

let state: MenuState | null = null;
const listeners = new Set<() => void>();

export function subscribeMenu(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getMenuState(): MenuState | null {
  return state;
}

function set(next: MenuState | null): void {
  state = next;
  listeners.forEach((f) => f());
}

function rectOf(anchor: HTMLElement | { x: number; y: number }): MenuPlacement {
  if (anchor instanceof HTMLElement) {
    const r = anchor.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }
  return { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
}

export function openMenu(anchor: HTMLElement | { x: number; y: number }, items: MenuItem[], opts?: { alignRight?: boolean }): void {
  set({ anchor: rectOf(anchor), items, alignRight: opts?.alignRight });
}

/** 子菜单：在锚点不变的前提下换掉当前项。 */
export function openSubmenu(items: MenuItem[]): void {
  if (state) set({ ...state, items });
}

export function closeMenu(): void {
  if (state) set(null);
}
