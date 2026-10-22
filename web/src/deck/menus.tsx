// 卡片集页的三个菜单：卡片 ⋯、目录 ⋯、卡片集 ⋯。条目照原型 cardMenuItems / sectionMenuItems / deckMenu，
// 去掉了 P1 / P2 / 砍 的项。所有动作走 actions，由 DeckPage 实现。
import type { CardColor, CardItem, DeckSummary, DisplayCfg, ID, Item, StudyContent } from '@bnki/shared';
import type { DeckPatch, ItemPatch } from '../api';
import type { MenuItem } from '../ui/menu';
import { promptDialog } from '../ui/dialogs';
import { sectionBlock } from './model';

export type DeckDialogKind = 'studySettings' | 'import' | 'export' | 'mindmap' | 'shortcuts' | 'cover';

export interface DeckActions {
  deckId: ID;
  /** 页面当前显示的标题 / 介绍（标题可能是还没提交的本地草稿）。 */
  deckTitle: string;
  deckDescription: string;
  items: Item[];
  otherDecks: DeckSummary[];
  disp: Required<Pick<DisplayCfg, 'layout' | 'showAnswer' | 'showProgress' | 'showMindmap' | 'showToc'>>;
  openEditor(t: { deckId: ID; cardId?: ID; afterId?: ID | null }): void;
  /** 局部改一项（乐观更新 + PATCH）。 */
  patchItem(id: ID, patch: ItemPatch): void;
  /** 记住最近一次卡片颜色（设置 lastCardColor）。 */
  rememberColor(color: CardColor): Promise<unknown>;
  openViewerFor(cardId: ID): void;
  renameSection(id: ID): void;
  openStudy(t: { deckId: ID; content?: StudyContent }): void;
  openDialog(kind: DeckDialogKind, deckId: ID): void;
  deleteItems(ids: ID[]): void;
  duplicateCard(id: ID): void;
  moveToSection(ids: ID[], sectionId: ID): void;
  moveToDeck(ids: ID[], target: DeckSummary): void;
  /** 页面内重排：ids 移到 afterId 之后（null = 最前）。 */
  moveIds(ids: ID[], afterId: ID | null): void;
  /** 在某项之后新建目录（折叠目录解析到块尾，undefined = 末尾）。 */
  addSectionAfter(id?: ID): void;
  manualState(cardId: ID, action: 'master' | 'unmaster' | 'forget'): void;
  patchDeck(patch: DeckPatch): void;
  patchDisplay(patch: Partial<DisplayCfg>): void;
  studyFromSection(sectionId: ID): void;
  resetProgress(): void;
}

const secLabel = (it: Item): string => (it.kind === 'section' ? '　'.repeat(it.level - 1) + it.title : it.id);

const sectionsOf = (a: DeckActions): Item[] => a.items.filter((x) => x.kind === 'section');

function blockIds(a: DeckActions, id: ID): ID[] {
  const [i, j] = sectionBlock(a.items, id);
  return a.items.slice(i, j).map((x) => x.id);
}

export function cardMenu(a: DeckActions, it: CardItem): MenuItem[] {
  const secs = sectionsOf(a);
  const mastered = !!it.state?.mastered;
  return [
    { label: '创建副本', icon: '⧉', onClick: () => a.duplicateCard(it.id) },
    {
      label: '移动到指定目录',
      icon: '⇥',
      disabled: !secs.length,
      sub: () => secs.map((x) => ({ label: secLabel(x), onClick: () => a.moveToSection([it.id], x.id) })),
    },
    {
      label: '移动到卡片集',
      icon: '⇄',
      sub: () =>
        a.otherDecks.filter((d) => d.id !== a.deckId).map((d) => ({ label: d.title, onClick: () => a.moveToDeck([it.id], d) })),
    },
    '-',
    { label: '在后面添加卡片', icon: '＋', kbd: '⌥C', onClick: () => a.openEditor({ deckId: a.deckId, afterId: it.id }) },
    { label: '在后面添加目录', icon: '☰', kbd: '⌥D', onClick: () => a.addSectionAfter(it.id) },
    '-',
    mastered
      ? { label: '恢复学习', icon: '↺', onClick: () => a.manualState(it.id, 'unmaster') }
      : { label: '完成学习（标记已掌握）', icon: '✓', onClick: () => a.manualState(it.id, 'master') },
    { label: '彻底忘记（重置为新卡）', icon: '⟲', disabled: !it.state, onClick: () => a.manualState(it.id, 'forget') },
  ];
}

export function sectionMenu(a: DeckActions, it: Item): MenuItem[] {
  const secs = sectionsOf(a).filter((x) => x.id !== it.id);
  return [
    { label: '在后面添加卡片', icon: '＋', kbd: '⌥C', onClick: () => a.openEditor({ deckId: a.deckId, afterId: it.id }) },
    { label: '在后面添加目录', icon: '☰', kbd: '⌥D', onClick: () => a.addSectionAfter(it.id) },
    '-',
    {
      label: '移动到指定目录之后',
      icon: '⇥',
      disabled: !secs.length,
      sub: () =>
        secs.map((x) => {
          const [, end] = sectionBlock(a.items, x.id);
          const last = a.items[end - 1];
          return { label: secLabel(x), disabled: !last, onClick: () => last && a.moveIds(blockIds(a, it.id), last.id) };
        }),
    },
    {
      label: '移动到卡片集（含目录内容）',
      icon: '⇄',
      sub: () =>
        a.otherDecks.filter((d) => d.id !== a.deckId).map((d) => ({ label: d.title, onClick: () => a.moveToDeck(blockIds(a, it.id), d) })),
    },
    { label: '从这里开始学习', icon: '▶', onClick: () => a.studyFromSection(it.id) },
  ];
}

export function deckMenu(a: DeckActions): MenuItem[] {
  const disp = a.disp;
  return [
    { label: '设置封面', icon: '▣', onClick: () => a.openDialog('cover', a.deckId) },
    {
      label: '编辑介绍',
      icon: '✎',
      onClick: async () => {
        const v = await promptDialog('编辑介绍', a.deckDescription, '一句话介绍这个卡片集');
        if (v !== null) a.patchDeck({ description: v });
      },
    },
    '-',
    { label: '导入卡片', icon: '⇪', onClick: () => a.openDialog('import', a.deckId) },
    { label: '导出', icon: '⇩', onClick: () => a.openDialog('export', a.deckId) },
    '-',
    { label: '学习设置', icon: '⚙', onClick: () => a.openDialog('studySettings', a.deckId) },
    { label: '重新开始学习', icon: '⟲', onClick: () => a.resetProgress() },
    '-',
    {
      label: '卡片布局',
      icon: '▦',
      sub: () => [
        { header: '卡片布局' },
        ...([['auto', '自动适应屏幕'], ['1', '每行 1 张'], ['2', '每行 2 张'], ['3', '每行 3 张']] as const).map(([k, l]) => ({
          label: l,
          checked: String(disp.layout) === k,
          onClick: () => a.patchDisplay({ layout: k === 'auto' ? 'auto' : (Number(k) as 1 | 2 | 3) }),
        })),
      ],
    },
    {
      label: '显示选项',
      icon: '◐',
      sub: () => [
        { header: '显示选项' },
        { label: '答案内容', checked: disp.showAnswer, onClick: () => a.patchDisplay({ showAnswer: !disp.showAnswer }) },
        { label: '学习进度', checked: disp.showProgress, onClick: () => a.patchDisplay({ showProgress: !disp.showProgress }) },
        { label: '思维导图', checked: disp.showMindmap, onClick: () => a.patchDisplay({ showMindmap: !disp.showMindmap }) },
        { label: '卡片目录', checked: disp.showToc, onClick: () => a.patchDisplay({ showToc: !disp.showToc }) },
      ],
    },
    '-',
    { label: '快捷键与操作', icon: '⌨', onClick: () => a.openDialog('shortcuts', a.deckId) },
  ];
}
