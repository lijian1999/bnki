// TanStack Query 钩子：查询 key 见 contracts 第 5 节。
import { useCallback } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { DeckSort, ID, Settings } from '@bnki/shared';
import { api, type Stats } from './api';
import { toast } from './ui/toast';

export function useFolders() {
  return useQuery({ queryKey: ['folders'], queryFn: () => api.folders.list() });
}

export interface DecksParams {
  view?: 'all' | 'recent' | 'trash';
  folder?: ID;
  sort?: DeckSort;
  q?: string;
}

export function useDecks(params: DecksParams) {
  return useQuery({ queryKey: ['decks', params], queryFn: () => api.decks.list(params) });
}

export function useDeck(id: ID) {
  return useQuery({ queryKey: ['deck', id], queryFn: () => api.decks.get(id), enabled: !!id });
}

export function useItems(deckId: ID) {
  return useQuery({ queryKey: ['items', deckId], queryFn: () => api.items.list(deckId), enabled: !!deckId });
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() });
}

export function useStats(range: number) {
  return useQuery({ queryKey: ['stats', range], queryFn: () => api.stats(range) });
}

export function useBackups() {
  return useQuery({ queryKey: ['backups'], queryFn: () => api.backups.list() });
}

/** 改完卡片集 / 卡片后调一次：列表、分类全刷，带 id 时再刷这一套的详情和条目。 */
export function invalidateDeck(qc: QueryClient, deckId?: ID): void {
  qc.invalidateQueries({ queryKey: ['decks'] });
  qc.invalidateQueries({ queryKey: ['folders'] });
  if (deckId) {
    qc.invalidateQueries({ queryKey: ['deck', deckId] });
    qc.invalidateQueries({ queryKey: ['items', deckId] });
  }
}

/** 保存设置：乐观更新缓存，失败回滚并提示。 */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useCallback(async (patch: Partial<Settings>): Promise<Settings> => {
    const prev = qc.getQueryData<Settings>(['settings']);
    if (prev) qc.setQueryData<Settings>(['settings'], { ...prev, ...patch });
    try {
      const next = await api.settings.put(patch);
      qc.setQueryData<Settings>(['settings'], next);
      return next;
    } catch (e) {
      if (prev) qc.setQueryData(['settings'], prev);
      toast('保存失败');
      throw e;
    }
  }, [qc]);
}

export type { Stats };
