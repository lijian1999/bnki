// 按设置里的外观（浅色 / 深色 / 跟随系统）给 <html> 设置 data-theme；设置未加载时按 system 处理。
import { useEffect } from 'react';
import { useSettings } from '../queries';

export function useTheme(): void {
  const { data: settings } = useSettings();
  const theme = settings?.theme ?? 'system';
  useEffect(() => {
    const set = (dark: boolean): void => {
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    if (theme !== 'system') {
      set(theme === 'dark');
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => set(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}
