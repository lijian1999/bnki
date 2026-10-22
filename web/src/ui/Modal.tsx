// 通用浮层容器：portal 到 body，键盘事件按“只有最上层响应”的规则分发（照原型 U.modals 栈）。
import { useEffect, useRef, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { closeMenu, getMenuState } from './menu';
import type { JSX } from 'react';

interface Handle {
  id: number;
  esc: () => void;
  key: (e: KeyboardEvent) => void;
}

let nextId = 1;
const stack: Handle[] = [];
let docBound = false;

function onDocKey(e: KeyboardEvent): void {
  // 菜单打开时 Esc 优先关菜单（照原型顺序），菜单自己监听关闭
  if (e.key === 'Escape' && getMenuState()) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    top.esc();
    return;
  }
  top.key(e);
}

function ensureDoc(): void {
  if (docBound) return;
  docBound = true;
  document.addEventListener('keydown', onDocKey);
}

export interface ModalProps {
  onClose: () => void;
  className?: string;
  light?: boolean;
  /** true 时 children 直接放遮罩里，不包 .dialog。 */
  raw?: boolean;
  /** 默认 true：在遮罩本身上按下鼠标时关闭。 */
  closeOnMask?: boolean;
  onKeyDown?: (e: KeyboardEvent) => void;
  children: ReactNode;
}

export function Modal(props: ModalProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  useEffect(() => {
    const handle: Handle = {
      id: nextId++,
      esc: () => propsRef.current.onClose(),
      key: (e) => propsRef.current.onKeyDown?.(e),
    };
    stack.push(handle);
    ensureDoc();
    closeMenu(); // 原型开弹窗时顺手关菜单
    return () => {
      const i = stack.indexOf(handle);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);
  const onMaskDown = (e: ReactMouseEvent): void => {
    if ((props.closeOnMask ?? true) && ref.current && e.target === ref.current) props.onClose();
  };
  const cls = 'mask' + (props.light ? ' light' : '');
  return createPortal(
    <div className={cls} ref={ref} onMouseDown={onMaskDown}>
      {props.raw ? (
        props.children
      ) : (
        <div className={'dialog' + (props.className ? ' ' + props.className : '')}>{props.children}</div>
      )}
    </div>,
    document.body,
  );
}

export function DialogHead(props: { title: ReactNode; onClose: () => void }): JSX.Element {
  return (
    <div className="dialog-head">
      <h3>{props.title}</h3>
      <button className="icon-btn" onClick={props.onClose}>×</button>
    </div>
  );
}
