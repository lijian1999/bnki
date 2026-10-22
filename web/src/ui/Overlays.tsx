// 全局浮层：toast、弹出菜单、确认框、输入框。挂在 App 里一次，
// 各界面模块通过 ui/toast、ui/menu、ui/dialogs 的函数调用它。
import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeToast, getToastState, dismissToast } from './toast';
import { subscribeMenu, getMenuState, closeMenu, openSubmenu, type MenuActionItem } from './menu';
import { subscribeDialogs, getDialogState, type DialogState } from './dialogs';
import { Modal, DialogHead } from './Modal';
import type { JSX } from 'react';

function ToastLayer(): JSX.Element | null {
  const t = useSyncExternalStore(subscribeToast, getToastState);
  if (!t) return null;
  return (
    <div className="toast">
      <span>{t.msg}</span>
      {t.action && (
        <button onClick={() => { const run = t.action!.run; dismissToast(); run(); }}>{t.action.label}</button>
      )}
    </div>
  );
}

function MenuRow({ it }: { it: MenuActionItem }): JSX.Element {
  const cls = 'mi' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : '') + (it.disabled ? ' disabled' : '');
  return (
    <div
      className={cls}
      onClick={() => {
        if (it.disabled) return;
        if (it.sub) { openSubmenu(it.sub()); return; }
        closeMenu();
        it.onClick?.();
      }}
    >
      {it.icon && <span style={{ width: 16, textAlign: 'center' }}>{it.icon}</span>}
      <span>{it.label}</span>
      {it.kbd && <span className="kbd">{it.kbd}</span>}
      {it.sub && <span className="kbd">›</span>}
    </div>
  );
}

function MenuLayer(): JSX.Element | null {
  const menu = useSyncExternalStore(subscribeMenu, getMenuState);
  const ref = useRef<HTMLDivElement>(null);
  // 尺寸要渲染后才能量，规则照原型：锚点下方 6px，放不下改到上方，左右不出窗口
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !menu) return;
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    const r = menu.anchor;
    let x = menu.alignRight ? r.right - mw : r.left;
    let y = r.bottom + 6;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 6);
    x = Math.max(8, Math.min(x, window.innerWidth - mw - 8));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  });
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);
  if (!menu) return null;
  return (
    <div
      className="menu"
      ref={ref}
      style={{ left: -1000, top: -1000 }}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('input')) e.preventDefault();
      }}
    >
      {menu.items.map((it, i) => {
        if (!it) return null;
        if (it === '-') return <div className="ms" key={i} />;
        if ('header' in it) return <div className="mh" key={i}>{it.header}</div>;
        if ('render' in it) return <Fragment key={i}>{it.render()}</Fragment>;
        return <MenuRow it={it} key={i} />;
      })}
    </div>
  );
}

function ConfirmView({ d }: { d: DialogState }): JSX.Element {
  return (
    <Modal light onClose={() => d.finish(false)}>
      <DialogHead title={d.title} onClose={() => d.finish(false)} />
      <div className="dialog-body">
        <p style={{ margin: '4px 0', color: 'var(--text-2)' }}>{d.text}</p>
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={() => d.finish(false)}>取消</button>
        <button className={d.danger ? 'btn primary danger' : 'btn primary'} onClick={() => d.finish(true)}>
          {d.okLabel}
        </button>
      </div>
    </Modal>
  );
}

function PromptView({ d }: { d: DialogState }): JSX.Element {
  const [val, setVal] = useState(d.value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const done = (ok: boolean): void => {
    d.finish(ok ? val : null);
  };
  return (
    <Modal light onClose={() => d.finish(null)} onKeyDown={(e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        done(true);
      }
    }}>
      <DialogHead title={d.title} onClose={() => d.finish(null)} />
      <div className="dialog-body">
        <input
          ref={ref}
          className="text-input"
          value={val}
          placeholder={d.placeholder}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              done(true);
            }
          }}
        />
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={() => done(false)}>取消</button>
        <button className="btn primary" onClick={() => done(true)}>确定</button>
      </div>
    </Modal>
  );
}

function DialogLayer(): JSX.Element | null {
  const d = useSyncExternalStore(subscribeDialogs, getDialogState);
  if (!d) return null;
  return d.kind === 'confirm' ? <ConfirmView d={d} /> : <PromptView d={d} />;
}

export default function Overlays(): JSX.Element {
  return (
    <>
      <ToastLayer />
      <MenuLayer />
      <DialogLayer />
    </>
  );
}
