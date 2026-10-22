// 全局确认框 / 输入框的 Promise 接口与状态；渲染在 ui/Overlays.tsx 里
// （走 Modal，因此也参与“只有最上层键盘响应”的叠加顺序）。

export interface DialogState {
  kind: 'confirm' | 'prompt';
  title: string;
  text?: string;
  okLabel: string;
  danger: boolean;
  value: string;
  placeholder: string;
  finish: (r: string | boolean | null) => void;
}

let state: DialogState | null = null;
const listeners = new Set<() => void>();

export function subscribeDialogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getDialogState(): DialogState | null {
  return state;
}

function set(next: DialogState | null): void {
  state = next;
  listeners.forEach((f) => f());
}

function open(init: Omit<DialogState, 'finish'>): Promise<string | boolean | null> {
  return new Promise((resolve) => {
    set({
      ...init,
      finish: (r) => {
        if (state) set(null);
        resolve(r);
      },
    });
  });
}

/** 确认框：确定 true，取消 / Esc / 点遮罩 false。 */
export function confirmDialog(title: string, text: string, ok = '确定', danger = false): Promise<boolean> {
  return open({ kind: 'confirm', title, text, okLabel: ok, danger, value: '', placeholder: '' }) as Promise<boolean>;
}

/** 输入框：确定 / Enter 返回文字，取消 / Esc / 点遮罩返回 null。 */
export function promptDialog(title: string, value = '', placeholder = ''): Promise<string | null> {
  return open({ kind: 'prompt', title, okLabel: '确定', danger: false, value, placeholder }) as Promise<string | null>;
}
