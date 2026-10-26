// 侧边栏收起 / 展开：状态记在本机 localStorage，⌘\（非 Mac 为 Ctrl+\）切换。
import { useCallback, useEffect, useState } from 'react';

const KEY = 'bnki.sidebarHidden';

function readHidden(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function useSidebar(): { hidden: boolean; toggle: () => void } {
  const [hidden, setHidden] = useState(readHidden);

  const toggle = useCallback(() => {
    setHidden((h) => {
      try {
        localStorage.setItem(KEY, h ? '0' : '1');
      } catch {
        // 存不了只是刷新后不保留
      }
      return !h;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === '\\') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { hidden, toggle };
}
