// 全局界面状态：跨页面打开的弹窗（编辑器、学习、卡片集相关对话框）。页面只调用这些动作，弹窗组件挂在 App 里。
import { create } from 'zustand';
import type { ID, StudyContent } from '@bnki/shared';

export interface EditorTarget {
  deckId: ID;
  cardId?: ID; // 有 = 编辑这张卡；没有 = 新建
  afterId?: ID | null; // 新建时插在哪一项后面；undefined = 末尾，null = 最前面
}

export type StudyTarget =
  | { deckId: ID; viewer?: false; content?: StudyContent } // 学习一组：按学习设置生成队列；content 覆盖学习内容
  | { deckId: ID; viewer: true; cardIds: ID[]; cardId: ID }; // “全部卡片”查看器：按 cardIds 顺序浏览，从 cardId 开始

export type DeckDialogKind = 'studySettings' | 'import' | 'export' | 'mindmap' | 'shortcuts' | 'cover';

interface UIState {
  editor: EditorTarget | null;
  openEditor(t: EditorTarget): void;
  closeEditor(): void;

  study: StudyTarget | null;
  openStudy(t: StudyTarget): void;
  closeStudy(): void;

  dialog: { kind: DeckDialogKind; deckId: ID } | null;
  openDialog(kind: DeckDialogKind, deckId: ID): void;
  closeDialog(): void;
}

export const useUI = create<UIState>((set) => ({
  editor: null,
  openEditor: (t) => set({ editor: t }),
  closeEditor: () => set({ editor: null }),

  study: null,
  openStudy: (t) => set({ study: t }),
  closeStudy: () => set({ study: null }),

  dialog: null,
  openDialog: (kind, deckId) => set({ dialog: { kind, deckId } }),
  closeDialog: () => set({ dialog: null }),
}));
