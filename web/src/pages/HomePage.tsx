// 首页：卡片集列表（全部 / 最近使用 / 回收站 / 分类），结构照原型 homeHTML、deckCardHTML。
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type DeckSort, type DeckSummary, type ID } from '@bnki/shared';
import { api } from '../api';
import { invalidateDeck, useDecks, useFolders, useSaveSettings, useSettings } from '../queries';
import { openMenu, type MenuItem } from '../ui/menu';
import { toast } from '../ui/toast';
import { confirmDialog } from '../ui/dialogs';

export type HomeView = 'all' | 'recent' | 'trash' | 'folder';

const SORTS: [DeckSort, string][] = [
  ['name', '按名称'],
  ['updated', '按编辑时间'],
  ['created', '按创建时间'],
  ['studied', '按学习时间'],
  ['next_due', '按下次复习时间'],
  ['card_count', '按卡片数量'],
  ['fresh_count', '按待学习卡片数量'],
];

function errText(e: unknown): string {
  return typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' && e.message ? e.message : '操作失败';
}

export default function HomePage(props: { view: HomeView }) {
  const view = props.view;
  const navigate = useNavigate();
  const { folderId } = useParams();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: folders = [] } = useFolders();
  const [q, setQ] = useState('');
  const saveSettings = useSaveSettings();

  const homeSort = settings?.homeSort ?? DEFAULT_SETTINGS.homeSort;
  const { data: decks = [] } = useDecks({
    view: view === 'folder' ? 'all' : view,
    folder: view === 'folder' ? folderId : undefined,
    sort: homeSort,
    q: q.trim() || undefined,
  });

  const folderById = (id: ID | null): string | undefined =>
    id ? folders.find((f) => f.id === id)?.name : undefined;

  const run = (id: ID, fn: () => Promise<unknown>): void => {
    void fn()
      .then(() => invalidateDeck(qc, id))
      .catch((e) => toast(errText(e)));
  };

  const title =
    view === 'trash' ? '回收站' : view === 'recent' ? '最近使用' : view === 'folder' ? folderById(folderId ?? null) ?? '分类' : '全部卡片集';
  const sortName = (SORTS.find((s) => s[0] === homeSort) ?? SORTS[1])[1];

  const clearTrash = async (): Promise<void> => {
    if (!(await confirmDialog('清空回收站', '回收站里的卡片集会全部被永久删除，无法恢复。确定清空吗？', '清空回收站', true))) return;
    void api.decks
      .emptyTrash()
      .then(() => invalidateDeck(qc))
      .catch((e) => toast(errText(e)));
  };

  const trashMenu = (d: DeckSummary): MenuItem[] => [
    { label: '恢复', icon: '↺', onClick: () => run(d.id, async () => { await api.decks.restore(d.id); toast('已恢复'); }) },
    {
      label: '彻底删除',
      icon: '✕',
      danger: true,
      onClick: async () => {
        if (await confirmDialog('彻底删除', `「${d.title}」及其所有卡片将被永久删除，无法恢复。`, '彻底删除', true)) {
          run(d.id, () => api.decks.purge(d.id));
        }
      },
    },
  ];

  const deckMenu = (d: DeckSummary): MenuItem[] => [
    { label: '打开', onClick: () => navigate(`/deck/${d.id}`) },
    { label: '在新标签页打开', onClick: () => window.open(`/deck/${d.id}`, '_blank') },
    { label: d.pinnedAt ? '取消置顶' : '置顶', onClick: () => run(d.id, () => api.decks.update(d.id, { pinned: !d.pinnedAt })) },
    view === 'recent' ? { label: '从最近列表中删除', onClick: () => run(d.id, () => api.decks.forgetRecent(d.id)) } : null,
    '-',
    {
      label: '移动到分类',
      sub: () => [
        { label: '不分类', checked: !d.folderId, onClick: () => run(d.id, () => api.decks.update(d.id, { folderId: null })) },
        ...folders.map((f) => ({
          label: f.name,
          checked: d.folderId === f.id,
          onClick: () => run(d.id, () => api.decks.update(d.id, { folderId: f.id })),
        })),
      ],
    },
    { label: '创建副本', onClick: () => run(d.id, async () => { await api.decks.duplicate(d.id); toast('已创建副本（学习进度不复制）'); }) },
    '-',
    {
      label: '删除',
      danger: true,
      onClick: () =>
        run(d.id, async () => {
          await api.decks.remove(d.id);
          toast('已移到回收站', {
            label: '撤销',
            run: () => void api.decks.restore(d.id).then(() => invalidateDeck(qc, d.id), (e) => toast(errText(e))),
          });
        }),
    },
  ];

  const card = (d: DeckSummary) => (
    <div
      className="deck-card"
      key={d.id}
      onClick={(e) => {
        if (view === 'trash') {
          const more = (e.currentTarget as HTMLElement).querySelector('.more') as HTMLElement | null;
          openMenu(more ?? e.currentTarget, trashMenu(d));
        } else {
          navigate(`/deck/${d.id}`);
        }
      }}
    >
      {d.cover && (
        <div
          className="cover"
          style={{ backgroundImage: `url('${d.cover.startsWith('media/') ? '/' + d.cover : d.cover}')` }}
        />
      )}
      {d.pinnedAt && <span className="pin" title="已置顶">📌</span>}
      <button
        className="more"
        onClick={(e) => {
          e.stopPropagation();
          if (view === 'trash') openMenu(e.currentTarget, trashMenu(d));
          else openMenu(e.currentTarget, deckMenu(d), { alignRight: true });
        }}
      >
        ···
      </button>
      <div className="title">{d.title}</div>
      <div className="meta">卡片 {d.counts.total}</div>
      <div className="foot">
        <span>◷ 未学习 {d.counts.fresh}</span>
        {d.counts.due > 0 && <span className="due">需复习 {d.counts.due}</span>}
        {folderById(d.folderId) && <span className="folder-tag">{folderById(d.folderId)}</span>}
      </div>
    </div>
  );

  const grid = decks.length ? (
    <div className="deck-grid">{decks.map(card)}</div>
  ) : (
    <div className="empty">{view === 'trash' ? '回收站是空的' : q.trim() ? '没有匹配的卡片集' : '还没有卡片集，点左上角“新建卡片集”'}</div>
  );

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{title}</h1>
        {view === 'trash' && decks.length > 0 && (
          <button className="btn sm" onClick={() => void clearTrash()}>清空回收站</button>
        )}
        {view !== 'recent' && (
          <span
            className="chip"
            onClick={(e) =>
              openMenu(
                e.currentTarget as HTMLElement,
                SORTS.map(([k, label]) => ({
                  label,
                  checked: k === homeSort,
                  onClick: () => void saveSettings({ homeSort: k }).then(() => invalidateDeck(qc)).catch(() => {}),
                })),
              )
            }
          >
            ⇅ {sortName}
          </span>
        )}
        <div className="search">
          <span style={{ color: 'var(--text-3)' }}>⌕</span>
          <input placeholder="搜索卡片集" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {grid}
    </div>
  );
}
