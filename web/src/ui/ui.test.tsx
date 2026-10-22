// 通用浮层的交互测试：先渲染 <Overlays />，再按函数式 API 调用。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import Overlays from './Overlays';
import { toast } from './toast';
import { openMenu, closeMenu } from './menu';
import { confirmDialog, promptDialog } from './dialogs';
import { Modal, DialogHead } from './Modal';

afterEach(() => {
  // 先 Esc 关掉残留的确认框 / 输入框（此时 Overlays 还在），再卸载并关菜单
  act(() => {
    fireEvent.keyDown(document.body, { key: 'Escape' });
    closeMenu();
  });
  cleanup();
});

function makeAnchor(): HTMLElement {
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.left = '100px';
  el.style.top = '100px';
  document.body.appendChild(el);
  return el;
}

describe('toast', () => {
  it('显示消息，点动作按钮执行回调并关闭', () => {
    render(<Overlays />);
    const run = vi.fn();
    act(() => toast('已删除', { label: '撤销', run }));
    expect(screen.getByText('已删除')).toBeTruthy();
    const btn = screen.getByText('撤销');
    fireEvent.click(btn);
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('已删除')).toBeNull();
  });
});

describe('openMenu', () => {
  it('渲染分隔线和危险项，点击第一项调用回调并关闭', () => {
    render(<Overlays />);
    const onClick = vi.fn();
    const anchor = makeAnchor();
    act(() => openMenu(anchor, [
      '-',
      { label: '复制', onClick },
      { label: '删除', danger: true },
    ]));
    expect(document.querySelectorAll('.mi')).toHaveLength(2);
    expect(document.querySelectorAll('.ms')).toHaveLength(1);
    const items = document.querySelectorAll('.mi');
    expect(items[1].className).toContain('danger');
    fireEvent.click(items[0]);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.menu')).toBeNull();
  });

  it('有 sub 的项点击后就地展开子菜单', () => {
    render(<Overlays />);
    const onMove = vi.fn();
    const anchor = makeAnchor();
    act(() => openMenu(anchor, [
      { label: '移动到分类', sub: () => [{ label: '不分类', onClick: onMove }] },
    ]));
    fireEvent.click(document.querySelectorAll('.mi')[0]);
    expect(screen.getByText('不分类')).toBeTruthy();
    fireEvent.click(screen.getByText('不分类'));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.menu')).toBeNull();
  });
});

describe('confirmDialog', () => {
  it('点确定 resolve true', async () => {
    render(<Overlays />);
    let p: Promise<boolean> | undefined;
    act(() => { p = confirmDialog('标题', '内容'); });
    fireEvent.click(screen.getByText('确定'));
    await expect(p!).resolves.toBe(true);
  });

  it('按 Esc resolve false', async () => {
    render(<Overlays />);
    let p: Promise<boolean> | undefined;
    act(() => { p = confirmDialog('标题', '内容'); });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await expect(p!).resolves.toBe(false);
    expect(screen.queryByText('标题')).toBeNull();
  });
});

describe('promptDialog', () => {
  it('输入后按 Enter resolve 输入的文字', async () => {
    render(<Overlays />);
    let p: Promise<string | null> | undefined;
    act(() => { p = promptDialog('标题', '', '名称'); });
    const input = document.querySelector('input.text-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: '我的分类' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await expect(p!).resolves.toBe('我的分类');
  });

  it('点取消 resolve null', async () => {
    render(<Overlays />);
    let p: Promise<string | null> | undefined;
    act(() => { p = promptDialog('标题', '默认'); });
    fireEvent.click(screen.getByText('取消'));
    await expect(p!).resolves.toBe(null);
  });
});

describe('Modal 键盘叠加', () => {
  it('多个弹窗叠加时只有最上层响应键盘', async () => {
    const close1 = vi.fn();
    const close2 = vi.fn();
    const Esc = (): void => { fireEvent.keyDown(document.body, { key: 'Escape' }); };
    const { unmount } = render(
      <>
        <Modal onClose={close1}>第一个</Modal>
        <Modal onClose={close2}>第二个</Modal>
      </>,
    );
    Esc();
    expect(close1).not.toHaveBeenCalled();
    expect(close2).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('DialogHead 输出标题和关闭按钮', () => {
    render(
      <Modal onClose={() => {}}>
        <DialogHead title="标题" onClose={() => {}} />
      </Modal>,
    );
    expect(document.querySelector('.dialog-head h3')).toBeTruthy();
    expect(screen.getByText('标题')).toBeTruthy();
    expect(document.querySelector('.dialog-head .icon-btn')).toBeTruthy();
  });
});
