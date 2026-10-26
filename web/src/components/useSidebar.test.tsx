import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';
import { useSidebar } from './useSidebar';

afterEach(() => localStorage.removeItem('bnki.sidebarHidden'));

describe('侧边栏收起', () => {
  it('默认展开；切换后记进 localStorage，重新挂载还是收起', () => {
    const { result, unmount } = renderHook(() => useSidebar());
    expect(result.current.hidden).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.hidden).toBe(true);
    expect(localStorage.getItem('bnki.sidebarHidden')).toBe('1');
    unmount();
    expect(renderHook(() => useSidebar()).result.current.hidden).toBe(true);
  });

  it('⌘\\ 和 Ctrl+\\ 切换，带 Shift 不算', () => {
    const { result } = renderHook(() => useSidebar());
    act(() => {
      fireEvent.keyDown(window, { key: '\\', metaKey: true });
    });
    expect(result.current.hidden).toBe(true);
    act(() => {
      fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
    });
    expect(result.current.hidden).toBe(false);
    act(() => {
      fireEvent.keyDown(window, { key: '\\', metaKey: true, shiftKey: true });
    });
    expect(result.current.hidden).toBe(false);
  });
});
