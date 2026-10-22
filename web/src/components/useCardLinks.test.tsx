// 卡片链接点击：查所在卡片集后跳 /deck/<deckId>?card=<id>；查不到只提示，不跳转。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { CardItem } from '@bnki/shared';
import { useCardLinks } from './useCardLinks';

vi.mock('../ui/toast', () => ({ toast: vi.fn() }));
import { toast } from '../ui/toast';

function Locator() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function renderPage() {
  function Hook() {
    useCardLinks();
    return <a href="#" data-card-link="c1">
      x
    </a>;
  }
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Hook />
      <Locator />
    </MemoryRouter>,
  );
}

const card = (id: string, deckId: string): CardItem => ({
  id,
  deckId,
  kind: 'card',
  position: 1,
  cardType: 'note',
  front: '正面',
  hint: '',
  back: '',
  color: 'default',
  createdAt: 1,
  updatedAt: 1,
  state: null,
});

beforeEach(() => {
  vi.mocked(toast).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useCardLinks', () => {
  it('点击跳到所在卡片集并带上 card 参数', async () => {
    const get = vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 200, json: async () => card('c1', 'd9') }));
    vi.stubGlobal('fetch', get);
    renderPage();
    fireEvent.click(screen.getByText('x'));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/deck/d9?card=c1'));
    expect(String(get.mock.calls[0]?.[0])).toBe('/api/items/c1');
  });

  it('卡片不存在时提示且不动', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'not_found', message: '条目不存在' }) }) as Response),
    );
    renderPage();
    fireEvent.click(screen.getByText('x'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('卡片不存在或已删除'));
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });
});
