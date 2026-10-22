// 全局提示条：同一时间只显示一条，新提示替换旧提示（行为照原型）。
type ToastAction = { label: string; run: () => void };
type ToastState = { msg: string; action?: ToastAction } | null;

let state: ToastState = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

export function subscribeToast(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getToastState(): ToastState {
  return state;
}

function set(next: ToastState): void {
  state = next;
  listeners.forEach((f) => f());
}

export function toast(msg: string, action?: ToastAction): void {
  if (timer) clearTimeout(timer);
  const cur: ToastState = { msg, action };
  set(cur);
  timer = setTimeout(() => { if (state === cur) set(null); }, action ? 5000 : 2200);
}

/** 立即关闭当前提示（点“撤销”之类的动作后调用）。 */
export function dismissToast(): void {
  if (timer) clearTimeout(timer);
  if (state) set(null);
}
