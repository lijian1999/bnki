// 卡片集页：结构、类名、文案照原型 deckPageHTML 到卡片集页快捷键（prototype/app.js 第 401–917 行）。
// 原型拼 HTML 字符串 + 内存数据，这里是 React 组件 + 接口数据；原型的 P1/P2 项没有搬。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { CSSProperties, DragEvent as RDragEvent, JSX } from 'react';
import {
  CONTENT_NAMES,
  DEFAULT_SETTINGS,
  isDue,
  newCardState,
  resolveStudyCfg,
  schedCfgFor,
  type CardItem,
  type DeckSummary,
  type DisplayCfg,
  type ID,
  type Item,
  type SectionItem,
} from '@bnki/shared';
import { plainText, renderMarkdown } from '@bnki/shared/markdown';
import { api } from '../api';
import { invalidateDeck, useDecks, useDeck, useItems, useSaveSettings, useSettings } from '../queries';
import { openMenu } from '../ui/menu';
import { toast } from '../ui/toast';
import { confirmDialog } from '../ui/dialogs';
import { useUI } from '../store';
import { fmtDate } from '../format';
import { buildRows, computeDrop, insertAfterId, moveToSectionEnd, sectionPaths, visibleIds } from '../deck/model';
import { hitIds, rectFrom, type Rect } from '../deck/marquee';
import { deckMenu, type DeckActions } from '../deck/menus';
import FloatToolbar from '../deck/FloatToolbar';
import '../styles/deck.css';

interface Disp {
  layout: 'auto' | 1 | 2 | 3;
  showAnswer: boolean;
  showProgress: boolean;
  showMindmap: boolean;
  showToc: boolean;
}

function dispOf(d: DeckSummary | undefined): Disp {
  const c: DisplayCfg = d?.displayCfg ?? {};
  return {
    layout: c.layout ?? 'auto',
    showAnswer: c.showAnswer ?? true,
    showProgress: c.showProgress ?? true,
    showMindmap: c.showMindmap ?? true,
    showToc: c.showToc ?? true,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const MODE_NAMES: Record<string, string> = { daily: '按天模式', flexible: '灵活模式', sprint: '冲刺模式' };

/** 卡片网格里的正文 HTML（照原型 cardHTML 的 inner）。 */
function cardBodyHtml(c: CardItem, disp: Disp): string {
  if (c.cardType === 'qa') {
    return (
      `<div class="q">${renderMarkdown(c.front)}</div>` +
      (c.hint ? `<div class="hint-prev">${renderMarkdown(c.hint)}</div>` : '') +
      (disp.showAnswer && c.back ? `<div class="a">${renderMarkdown(c.back)}</div>` : '')
    );
  }
  if (c.cardType === 'topic') {
    return `<div class="topic-t">${esc(c.front)}</div><div style="color:var(--text-2);margin-top:6px">${esc(c.back)}</div>`;
  }
  return renderMarkdown(c.front);
}

// 缓存里重排：ids 顺序移到 afterId 之后（null = 最前），乐观更新用。
function applyMove(arr: Item[], ids: ID[], afterId: ID | null): Item[] {
  const gone = new Set(ids);
  const rest = arr.filter((x) => !gone.has(x.id));
  const byId = new Map(arr.map((x) => [x.id, x]));
  const moving = ids.map((id) => byId.get(id)).filter((x): x is Item => !!x);
  if (afterId == null) return [...moving, ...rest];
  const i = rest.findIndex((x) => x.id === afterId);
  if (i < 0) return [...rest, ...moving];
  return [...rest.slice(0, i + 1), ...moving, ...rest.slice(i + 1)];
}

// 缓存里在 afterId 之后插入一项；afterId 省略 = 末尾，null = 最前（与接口一致）。
function insertLocally(arr: Item[], it: Item, afterId?: ID | null): Item[] {
  if (afterId === undefined) return [...arr, it];
  if (afterId === null) return [it, ...arr];
  const i = arr.findIndex((x) => x.id === afterId);
  if (i < 0) return [...arr, it];
  const out = [...arr];
  out.splice(i + 1, 0, it);
  return out;
}

/** 接口调用：成功 invalidate；失败提示操作失败并 invalidate 回到服务器数据。resolve 值表示成败。 */
function settle<T>(promise: Promise<T>, qc: ReturnType<typeof useQueryClient>, deckId: ID): Promise<boolean> {
  return promise.then(
    () => {
      invalidateDeck(qc, deckId);
      return true;
    },
    () => {
      toast('操作失败');
      invalidateDeck(qc, deckId);
      return false;
    },
  );
}

export default function DeckPage() {
  const { deckId = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const openEditor = useUI((s) => s.openEditor);
  const openStudy = useUI((s) => s.openStudy);
  const openDialog = useUI((s) => s.openDialog);
  const saveSettings = useSaveSettings();

  const deckQ = useDeck(deckId);
  const deck = deckQ.data;
  const itemsQ = useItems(deckId);
  const items = itemsQ.data ?? [];
  const settings = useSettings().data ?? DEFAULT_SETTINGS;
  const allDecks = useDecks({}).data ?? [];

  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<ID | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: ID; alt: boolean } | null>(null);
  const [dropInfo, setDropInfo] = useState<{ id: ID; after: boolean } | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [speakOn, setSpeakOn] = useState(false);
  const [params, setParams] = useSearchParams();

  const anchorRef = useRef<ID | null>(null);
  const selRef = useRef<Set<string>>(sel);
  selRef.current = sel;
  const renamingRef = useRef<ID | null>(renaming);
  renamingRef.current = renaming;
  const titleDraftRef = useRef<string | null>(titleDraft);
  titleDraftRef.current = titleDraft;
  const secTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const titleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focusSearchRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const openedForRef = useRef('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusedTitleRef = useRef(false);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const jumpedRef = useRef('');
  const justMarqueeRef = useRef(false);
  const speakQueueRef = useRef<CardItem[]>([]);

  const disp = dispOf(deck);
  const rows = useMemo(() => buildRows(items, q), [items, q]);
  const resolved = deck ? resolveStudyCfg(deck.studyCfg, settings) : null;
  const sc = resolved ? schedCfgFor(settings, resolved) : null;
  const liveTitle = titleDraft ?? deck?.title ?? '';
  const visibleCards = rows.filter((r) => r.kind === 'cards').flatMap((r) => (r.kind === 'cards' ? r.cards.map((c) => c.id) : []));
  const anyCardShown = rows.some((r) => r.kind === 'cards');

  // 进入页面只 open 一次
  useEffect(() => {
    if (!deckId || openedForRef.current === deckId) return;
    openedForRef.current = deckId;
    api.decks
      .open(deckId)
      .then(() => invalidateDeck(qc, deckId))
      .catch(() => {});
  }, [deckId, qc]);

  // 换一个卡片集：清掉页面内的各种状态
  useEffect(() => {
    setSel(new Set());
    setRenaming(null);
    setTitleDraft(null);
    anchorRef.current = null;
    focusedTitleRef.current = false;
    return () => {
      if (secTimerRef.current) clearTimeout(secTimerRef.current);
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    };
  }, [deckId]);

  // 打开搜索框后聚焦
  useEffect(() => {
    if (!searchOpen) return;
    const on = focusSearchRef.current;
    focusSearchRef.current = false;
    if (on) searchRef.current?.focus();
  }, [searchOpen]);

  const focusTitle = (location.state as { focusTitle?: boolean } | null)?.focusTitle === true;
  useEffect(() => {
    if (!focusTitle || focusedTitleRef.current || !deck) return;
    const el = document.getElementById('deck-title') as HTMLInputElement | null;
    if (el) {
      focusedTitleRef.current = true;
      el.focus();
      el.select();
    }
  }, [deck, focusTitle]);

  // 搜索词命中时把 .md 里的文字包成 mark.hit（照原型 highlightHits）
  useLayoutEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    // 先撤掉上一轮命中，避免搜索词改变后套一层新的
    root.querySelectorAll('mark.hit').forEach((m) => {
      const p = m.parentNode;
      if (!p) return;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize();
    });
    const query = q.trim();
    if (!query) return;
    const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    root.querySelectorAll('.mini-card .md').forEach((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      nodes.forEach((n) => {
        re.lastIndex = 0;
        const data = n.data;
        if (!re.test(data)) return;
        const span = document.createElement('span');
        span.innerHTML = esc(data).replace(re, (m) => `<mark class="hit">${m}</mark>`);
        n.replaceWith(...span.childNodes);
      });
    });
  }, [q, items]);

  // ---------------------------------------------------------------- 动作

  const lastSel = (): ID | undefined => {
    const a = [...selRef.current];
    return a.length ? a[a.length - 1] : undefined;
  };

  const selectItem = (id: ID, e?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }): void => {
    const ids = visibleIds(rows);
    if (e && (e.metaKey || e.ctrlKey)) {
      const next = new Set(selRef.current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      anchorRef.current = id;
      setSel(next);
      return;
    }
    if (e?.shiftKey && anchorRef.current) {
      const a = ids.indexOf(anchorRef.current);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        setSel(new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)));
        return;
      }
    }
    anchorRef.current = id;
    setSel(new Set([id]));
  };

  const clearSel = (): void => setSel(new Set());

  const patchItem = (id: ID, patch: Parameters<typeof api.items.update>[1]): void => {
    qc.setQueryData<Item[]>(['items', deckId], (old) => old?.map((x) => (x.id === id ? ({ ...x, ...patch } as Item) : x)));
    void settle(api.items.update(id, patch), qc, deckId);
  };

  const patchDeck = (patch: Parameters<typeof api.decks.update>[1]): void => {
    qc.setQueryData<DeckSummary>(['deck', deckId], (old) => (old ? { ...old, ...patch } : old));
    void settle(api.decks.update(deckId, patch), qc, deckId);
  };

  const patchDisplay = (patch: Partial<DisplayCfg>): void => {
    patchDeck({ displayCfg: { ...(deck?.displayCfg ?? {}), ...patch } });
  };

  const moveIds = (ids: ID[], afterId: ID | null): void => {
    qc.setQueryData<Item[]>(['items', deckId], (old) => (old ? applyMove(old, ids, afterId) : old));
    void settle(api.items.move({ ids, afterId }), qc, deckId);
  };

  const deleteItems = (ids: ID[]): void => {
    if (!ids.length) return;
    const kinds = new Map(ids.map((id) => [id, items.find((x) => x.id === id)?.kind]));
    const nCards = ids.filter((id) => kinds.get(id) === 'card').length;
    const nSecs = ids.length - nCards;
    qc.setQueryData<Item[]>(['items', deckId], (old) => old?.filter((x) => !ids.includes(x.id)));
    clearSel();
    void settle(api.items.remove(ids), qc, deckId);
    toast(`已删除${nCards ? ` ${nCards} 张卡片` : ''}${nSecs ? ` ${nSecs} 个目录（目录下的卡片保留）` : ''}`, {
      label: '撤销',
      run: () => {
        void settle(api.items.restore(ids), qc, deckId);
      },
    });
  };

  const openViewer = (cardId: ID): void => {
    openStudy({ deckId, viewer: true, cardIds: visibleCards, cardId });
  };

  const renameSection = (id: ID): void => {
    renamingRef.current = id;
    setRenaming(id);
  };

  const createSectionCore = (aid: ID | null | undefined, level: 1 | 2 | 3 | 4 | 5): void => {
    void api.items
      .create({ deckId, kind: 'section', afterId: aid, level, title: '新目录' })
      .then((it) => {
        qc.setQueryData<Item[]>(['items', deckId], (old) => (old ? insertLocally(old, it, aid) : old));
        invalidateDeck(qc, deckId);
        setSel(new Set([it.id]));
        anchorRef.current = it.id;
        renameSection(it.id);
      })
      .catch(errFail());
  };

  /** 新建目录：位置用选中项解析，级别跟选中目录一致（否则 1）。 */
  const createSection = (afterId?: ID | null): void => {
    const last = lastSel();
    const target = last ? items.find((x) => x.id === last) : undefined;
    createSectionCore(afterId !== undefined ? afterId : insertAfterId(items, last), target && target.kind === 'section' ? target.level : 1);
  };

  /** 目录面板的＋：末尾新建一级目录。 */
  const createSectionAtEnd = (): void => createSectionCore(undefined, 1);

  function errFail(): (e: unknown) => void {
    return () => toast('操作失败');
  }

  const newCardHere = (): void => {
    openEditor({ deckId, afterId: insertAfterId(items, lastSel()) });
  };

  const newSectionHere = (): void => createSection();

  const toggleCollapse = (id: ID): void => {
    const it = items.find((x) => x.id === id);
    if (it && it.kind === 'section') patchItem(id, { collapsed: !it.collapsed });
  };

  const foldAll = (): void => {
    const secs = items.filter((x): x is SectionItem => x.kind === 'section');
    const collapse = secs.some((s) => !s.collapsed);
    secs.forEach((s) => {
      if (s.collapsed !== collapse) patchItem(s.id, { collapsed: collapse });
    });
  };

  const closeSearch = (): void => {
    setSearchOpen(false);
    setQ('');
  };

  // 提交标题：清空 = 无标题卡片集
  const commitTitle = (draft: string): void => {
    const v = draft.trim() || '无标题卡片集';
    setTitleDraft(null);
    if (v !== (qc.getQueryData<DeckSummary>(['deck', deckId])?.title ?? '')) patchDeck({ title: v });
  };

  const onTitleChange = (v: string): void => {
    setTitleDraft(v);
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(() => {
      const cur = qc.getQueryData<DeckSummary>(['deck', deckId])?.title ?? '';
      if (v.trim() && v !== cur) patchDeck({ title: v });
    }, 500);
  };

  const commitTitleFromInput = (): void => {
    const draft = titleDraftRef.current;
    if (draft === null) return;
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    commitTitle(draft);
  };

  const actions: DeckActions = {
    deckId,
    deckTitle: liveTitle,
    deckDescription: deck?.description ?? '',
    items,
    otherDecks: allDecks.filter((d) => d.id !== deckId),
    disp,
    openEditor: (t) => openEditor(t),
    openStudy: (t) => openStudy(t),
    openDialog: (kind, id) => openDialog(kind, id),
    patchItem,
    rememberColor: (color) => saveSettings({ lastCardColor: color }),
    openViewerFor: openViewer,
    renameSection,
    deleteItems,
    duplicateCard: (id) => {
      api.items
        .duplicate(id)
        .then((it) => {
          qc.setQueryData<Item[]>(['items', deckId], (old) => (old ? insertLocally(old, it, id) : old));
          invalidateDeck(qc, deckId);
        })
        .catch(errFail());
    },
    moveToSection: (ids, secId) => {
      const r = moveToSectionEnd(items, ids, secId);
      if (!r.ids.length) return;
      moveIds(r.ids, r.afterId);
      toast(`已移动 ${r.ids.length} 张卡片`);
    },
    moveToDeck: (ids, target) => {
      const n = ids.filter((id) => items.find((x) => x.id === id)?.kind === 'card').length;
      void api.items
        .list(target.id)
        .then((list) => api.items.move({ ids, afterId: list.length ? list[list.length - 1].id : null, deckId: target.id }))
        .then(() => {
          qc.setQueryData<Item[]>(['items', deckId], (old) => (old ? old.filter((x) => !ids.includes(x.id)) : old));
          clearSel();
          invalidateDeck(qc, deckId);
          toast(`已移动 ${n} 张卡片到「${target.title}」`);
        })
        .catch(() => {
          toast('操作失败');
          invalidateDeck(qc, deckId);
        });
    },
    moveIds,
    addSectionAfter: (id) => createSection(id === undefined ? undefined : insertAfterId(items, id)),
    manualState: (cardId, action) => {
      qc.setQueryData<Item[]>(['items', deckId], (old) =>
        old?.map((x) =>
          x.id === cardId && x.kind === 'card'
            ? { ...x, state: action === 'forget' ? null : { ...newCardState(), ...(x.state ?? {}), mastered: action === 'master' } }
            : x,
        ),
      );
      void settle(api.study.manual({ cardId, action }), qc, deckId).then((ok) => {
        if (ok) toast(action === 'master' ? '已标记为掌握，不再出现在学习中' : action === 'unmaster' ? '已恢复学习' : '已重置为新卡');
      });
    },
    patchDeck,
    patchDisplay,
    studyFromSection: (sectionId) => {
      patchDeck({ studyCfg: { ...deck?.studyCfg, sections: [sectionId] } });
      openStudy({ deckId });
    },
    resetProgress: () => {
      const n = items.filter((x) => x.kind === 'card' && x.state != null).length;
      if (!n) {
        toast('当前卡片集还没有可重置的学习进度');
        return;
      }
      void confirmDialog(
        '重新开始学习',
        `将清空「${liveTitle}」中 ${n} 张卡片的学习进度，所有卡片回到“未学习”。复习记录会保留在统计里。`,
        '确认重置',
        true,
      ).then((ok) => {
        if (!ok) return;
        qc.setQueryData<Item[]>(['items', deckId], (old) => old?.map((x) => (x.kind === 'card' ? { ...x, state: null } : x)));
        void settle(api.decks.resetProgress(deckId), qc, deckId).then((ok) => {
          if (ok) toast('已重置学习进度');
        });
      });
    },
  };

  // ---------------------------------------------------------------- 全局事件
  const handlersRef = useRef({
    onClick: (_e: MouseEvent): void => {},
    onDblClick: (_e: MouseEvent): void => {},
    onKey: (_e: KeyboardEvent): void => {},
    onMouseDown: (_e: MouseEvent): void => {},
  });

  handlersRef.current.onClick = (e: MouseEvent): void => {
    // 刚框选完的那一次 click 不算点空白，否则选区马上被清掉
    if (justMarqueeRef.current) {
      justMarqueeRef.current = false;
      return;
    }
    const t = e.target as HTMLElement | null;
    if (!t || !deck) return;
    const itemEl = t.closest('[data-item]');
    if (itemEl && !t.closest('input')) {
      if (secTimerRef.current) clearTimeout(secTimerRef.current);
      const id = itemEl.getAttribute('data-item')!;
      const it = items.find((x) => x.id === id);
      if (!it) return;
      if (t.closest('.caret')) {
        toggleCollapse(id);
        return;
      }
      // 已单独选中的目录再点一次 = 切换折叠（双击改名时取消）
      if (
        it.kind === 'section' &&
        selRef.current.size === 1 &&
        selRef.current.has(id) &&
        !(e.metaKey || e.ctrlKey) &&
        !e.shiftKey
      ) {
        if (e.detail === 1) secTimerRef.current = setTimeout(() => toggleCollapse(id), 250);
        return;
      }
      selectItem(id, e);
    } else if (
      !t.closest('.float-toolbar, .fab-group, .deck-top, .progress-panel, .toc') &&
      !t.closest('#deck-title') &&
      selRef.current.size
    ) {
      clearSel();
    }
  };

  handlersRef.current.onDblClick = (e: MouseEvent): void => {
    if (!deck) return;
    const t = e.target as HTMLElement | null;
    const itemEl = t?.closest?.('[data-item]');
    if (!itemEl) return;
    const id = itemEl.getAttribute('data-item')!;
    if (secTimerRef.current) clearTimeout(secTimerRef.current);
    window.getSelection()?.removeAllRanges();
    const it = items.find((x) => x.id === id);
    if (!it) return;
    if (it.kind === 'section') renameSection(id);
    else openViewer(id);
  };

  handlersRef.current.onKey = (e: KeyboardEvent): void => {
    if (document.querySelector('.mask, .menu')) return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) {
      if (!t) return;
      if (t.id === 'rename-input') {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          commitRename();
          t.blur();
        }
        if (e.key === 'Escape') cancelRename();
      }
      if (t.id === 'deck-title' && e.key === 'Enter') t.blur();
      if (t.id === 'deck-search' && e.key === 'Escape') closeSearch();
      return;
    }
    if (!deck) return;
    const selArr = [...selRef.current];
    const last = selArr.length ? selArr[selArr.length - 1] : undefined;
    const one = selRef.current.size === 1 ? items.find((x) => x.id === last) : undefined;
    const mod = e.metaKey || e.ctrlKey;
    if (e.altKey && e.code === 'KeyC') {
      e.preventDefault();
      openEditor({ deckId, afterId: insertAfterId(items, last) });
      return;
    }
    if (e.altKey && e.code === 'KeyD') {
      e.preventDefault();
      createSection(insertAfterId(items, last));
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      const ids = visibleIds(rows);
      anchorRef.current = ids[ids.length - 1] ?? null;
      setSel(new Set(ids));
      return;
    }
    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      focusSearchRef.current = true;
      setSearchOpen(true);
      return;
    }
    if (mod || e.altKey) return;
    switch (e.key) {
      case 'c':
      case 'C':
        e.preventDefault();
        openEditor({ deckId, afterId: insertAfterId(items, last) });
        break;
      case 'd':
      case 'D':
        e.preventDefault();
        createSection(insertAfterId(items, last));
        break;
      case 'e':
      case 'E':
        if (one) {
          e.preventDefault();
          if (one.kind === 'card') openEditor({ deckId, cardId: one.id });
          else renameSection(one.id);
        }
        break;
      case 'Enter':
        if (one && one.kind === 'card') {
          e.preventDefault();
          openViewer(one.id);
        }
        break;
      case 'Backspace':
      case 'Delete':
        if (selArr.length) {
          e.preventDefault();
          deleteItems(selArr);
        }
        break;
      case 'Escape':
        if (selArr.length) clearSel();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        const ids = visibleIds(rows);
        if (!ids.length) break;
        e.preventDefault();
        let i = anchorRef.current ? ids.indexOf(anchorRef.current) : -1;
        const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
        i = Math.max(0, Math.min(ids.length - 1, i + step));
        if (e.shiftKey) {
          const next = new Set(selRef.current);
          next.add(ids[i]);
          anchorRef.current = ids[i];
          setSel(next);
        } else {
          selectItem(ids[i]);
        }
        const target = ids[i];
        setTimeout(() => document.querySelector(`[data-item="${target}"]`)?.scrollIntoView({ block: 'nearest' }), 0);
        break;
      }
      default:
        break;
    }
  };

  const commitRename = (): void => {
    const id = renamingRef.current;
    if (!id) return;
    renamingRef.current = null;
    setRenaming(null);
    const el = document.getElementById('rename-input') as HTMLInputElement | null;
    const v = (el ? el.value : '').trim().slice(0, 200) || '新目录';
    const cur = items.find((x) => x.id === id);
    if (cur && cur.kind === 'section' && cur.title !== v) patchItem(id, { title: v });
  };

  const cancelRename = (): void => {
    renamingRef.current = null;
    setRenaming(null);
  };

  useEffect(() => {
    const onClick = (e: MouseEvent) => handlersRef.current.onClick(e);
    const onDbl = (e: MouseEvent) => handlersRef.current.onDblClick(e);
    const onKey = (e: KeyboardEvent) => handlersRef.current.onKey(e);
    const onMouseDown = (e: MouseEvent) => handlersRef.current.onMouseDown(e);
    document.addEventListener('click', onClick);
    document.addEventListener('dblclick', onDbl);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('dblclick', onDbl);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, []);

  // 卡片定位：链接跳转带 ?card=<id>，展开所在目录链、选中、滚到中间并闪一下
  useEffect(() => {
    const cardParam = params.get('card');
    if (!cardParam) {
      jumpedRef.current = '';
      return;
    }
    if (jumpedRef.current === cardParam || !deck || itemsQ.data === undefined) return;
    jumpedRef.current = cardParam;
    const target = items.find((x) => x.id === cardParam);
    if (target?.kind === 'card') {
      // 卡片可能被折叠的目录挡住，先把链上的目录都展开
      for (const sid of sectionPaths(items)[cardParam] ?? []) {
        const s = items.find((x) => x.id === sid);
        if (s && s.kind === 'section' && s.collapsed) patchItem(sid, { collapsed: false });
      }
      anchorRef.current = cardParam;
      setSel(new Set([cardParam]));
      // 展开后要等重渲染，元素才出现在 DOM 里
      let left = 25;
      const step = (): void => {
        const el = document.querySelector<HTMLElement>(`.mini-card[data-item="${cardParam}"]`);
        if (el) {
          el.scrollIntoView({ block: 'center' });
          el.classList.add('flash');
          window.setTimeout(() => el.classList.remove('flash'), 1600);
          return;
        }
        if (left-- > 0) window.setTimeout(step, 0);
      };
      step();
    }
    setParams({}, { replace: true });
  }, [params, items, deck, itemsQ.data, setParams, patchItem]);

  // 框选用的卡片矩形（只有卡片，目录标题不参与）
  const cardRects = (): { id: ID; rect: Rect }[] => {
    const out: { id: ID; rect: Rect }[] = [];
    document.querySelectorAll('.mini-card[data-item]').forEach((el) => {
      const id = el.getAttribute('data-item');
      if (!id) return;
      const r = el.getBoundingClientRect();
      out.push({ id, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
    });
    return out;
  };

  // 框选：主区空白处按下左键拖动，选中的是与框相交的卡片
  handlersRef.current.onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    const t = e.target as Element | null;
    if (!t || typeof t.closest !== 'function') return;
    if (!t.closest('#main') || t.closest('[data-item], button, input, textarea, select, a, [contenteditable], .toc, .float-toolbar, .fab-group')) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const mod = e.metaKey || e.ctrlKey || e.shiftKey;
    const base = [...selRef.current];
    let live = false;
    justMarqueeRef.current = false;
    const onMove = (ev: MouseEvent): void => {
      if (!live) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) <= 4) return;
        live = true;
        document.body.classList.add('marqueeing');
      }
      const box = rectFrom(x0, y0, ev.clientX, ev.clientY);
      const hits = hitIds(box, cardRects());
      setMarquee(box);
      setSel(new Set(mod ? [...base, ...hits] : hits));
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('marqueeing');
      if (!live) return;
      setMarquee(null);
      justMarqueeRef.current = true;
      // 紧接着的那一次 click 跳过；没发生 click 就自动失效，不会一直挡着
      window.setTimeout(() => {
        justMarqueeRef.current = false;
      }, 0);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // 朗读：整集或选中的卡片，一张一条语音
  const speakText = (c: CardItem): string => (c.cardType === 'qa' ? `${plainText(c.front)}。${plainText(c.back)}` : plainText(c.front));

  const stopSpeak = (): void => {
    speakQueueRef.current = [];
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    document.querySelectorAll('.mini-card.speaking').forEach((el) => el.classList.remove('speaking'));
    setSpeakOn(false);
  };

  const speakFrom = (i: number): void => {
    const list = speakQueueRef.current;
    if (i >= list.length) {
      stopSpeak();
      return;
    }
    const c = list[i];
    document.querySelectorAll('.mini-card.speaking').forEach((el) => el.classList.remove('speaking'));
    const el = document.querySelector<HTMLElement>(`.mini-card[data-item="${c.id}"]`);
    if (el) {
      el.classList.add('speaking');
      el.scrollIntoView({ block: 'nearest' });
    }
    const u = new SpeechSynthesisUtterance(speakText(c));
    u.rate = settings.ttsRate;
    if (settings.ttsLang) u.lang = settings.ttsLang;
    u.onend = () => {
      if (speakQueueRef.current === list) speakFrom(i + 1);
    };
    window.speechSynthesis.speak(u);
  };

  const toggleSpeak = (): void => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      toast('浏览器不支持朗读');
      return;
    }
    if (speakOn) {
      stopSpeak();
      return;
    }
    const cards = items.filter((x): x is CardItem => x.kind === 'card');
    const chosen = cards.filter((c) => selRef.current.has(c.id));
    const list = (chosen.length ? chosen : cards).filter((c) => speakText(c).trim());
    if (!list.length) return;
    speakQueueRef.current = list;
    setSpeakOn(true);
    speakFrom(0);
  };

  // 离开页面（或换一个卡片集）：停掉朗读
  useEffect(() => stopSpeak, [deckId]);

  // ---------------------------------------------------------------- 渲染

  if (deckQ.isError) {
    return (
      <div className="empty" style={{ textAlign: 'center' }}>
        卡片集不存在
        <div style={{ marginTop: 12 }}>
          <Link className="btn" to="/">
            返回首页
          </Link>
        </div>
      </div>
    );
  }
  if (!deck) return null;

  const goBack = (): void => {
    if (location.key === 'default') navigate('/');
    else navigate(-1);
  };

  const coverUrl = deck.cover ? (deck.cover.startsWith('media/') ? '/' + deck.cover : deck.cover) : null;
  const secs = items.filter((x): x is SectionItem => x.kind === 'section');
  const plan = resolved?.plan;
  const planText = plan
    ? `${MODE_NAMES[plan.mode] ?? ''} · 每日新学 ${plan.newPerDay} / 复习 ${plan.reviewPerDay}${plan.mode === 'sprint' && plan.examDate ? ' · 考试 ' + plan.examDate : ''}`
    : '';
  const colsClass = disp.layout === 'auto' ? '' : ` cols-${disp.layout}`;

  const onItemDragStart = (id: ID) => (e: RDragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    setDrag({ id, alt: e.altKey });
  };
  const onItemDragOver = (id: ID, isCard: boolean) => (e: RDragEvent) => {
    if (!dragRef.current) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = isCard ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    e.preventDefault();
    setDropInfo((d) => (d && d.id === id && d.after === after ? d : { id, after }));
  };
  const onItemDrop = (id: ID, isCard: boolean) => (e: RDragEvent) => {
    const d = dragRef.current;
    setDrag(null);
    setDropInfo(null);
    if (!d || d.id === id) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = isCard ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    const res = computeDrop(items, d.id, id, after, d.alt || e.altKey);
    if (res) moveIds(res.ids, res.afterId);
  };
  const dragEnd = (): void => {
    setDrag(null);
    setDropInfo(null);
  };

  const dropStyle = (id: ID, isCard: boolean): CSSProperties | undefined => {
    if (!dropInfo || dropInfo.id !== id) return undefined;
    const c = 'var(--accent)';
    const shadow = isCard
      ? dropInfo.after
        ? `4px 0 0 ${c}`
        : `-4px 0 0 ${c}`
      : dropInfo.after
        ? `0 3px 0 ${c}`
        : `0 -3px 0 ${c}`;
    return { boxShadow: shadow };
  };

  const sectionRow = (s: SectionItem, count: number): JSX.Element => (
    <div
      key={s.id}
      className={`section-h l${s.level}${s.collapsed ? ' collapsed' : ''}${sel.has(s.id) ? ' sel' : ''}${drag?.id === s.id ? ' dragging' : ''}`}
      data-item={s.id}
      draggable
      style={dropStyle(s.id, false)}
      onDragStart={onItemDragStart(s.id)}
      onDragOver={onItemDragOver(s.id, false)}
      onDragEnd={dragEnd}
      onDrop={onItemDrop(s.id, false)}
    >
      <span className="caret">▼</span>
      {renaming === s.id ? (
        <RenameInput title={s.title} onCommit={commitRename} />
      ) : (
        <span className="t">{s.title}</span>
      )}
      <span className="count">{count}</span>
    </div>
  );

  const cardCell = (c: CardItem): JSX.Element => (
    <div
      key={c.id}
      className={`mini-card col-${c.color || 'default'}${sel.has(c.id) ? ' sel' : ''}${drag?.id === c.id ? ' dragging' : ''}`}
      data-item={c.id}
      draggable
      style={dropStyle(c.id, true)}
      onDragStart={onItemDragStart(c.id)}
      onDragOver={onItemDragOver(c.id, true)}
      onDragEnd={dragEnd}
      onDrop={onItemDrop(c.id, true)}
    >
      <div className="md" dangerouslySetInnerHTML={{ __html: cardBodyHtml(c, disp) }} />
      {c.state?.mastered ? (
        <span className="state-dot">已掌握</span>
      ) : sc && c.state && isDue(c.state, sc, Date.now()) ? (
        <span className="state-dot due">需复习</span>
      ) : null}
    </div>
  );

  return (
    <>
      <div className="deck-top">
        <button className="icon-btn" onClick={goBack} title="返回">
          ‹
        </button>
        <div style={{ flex: 1 }} />
        <button
          className={`icon-btn${speakOn ? ' on' : ''}`}
          title={speakOn ? '停止朗读' : '朗读'}
          onClick={toggleSpeak}
        >
          🔈
        </button>
        {searchOpen || q ? (
          <div className="search" style={{ width: 240, margin: 0 }}>
            <span style={{ color: 'var(--text-3)' }}>⌕</span>
            <input
              id="deck-search"
              ref={searchRef}
              placeholder="搜索卡片内容"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                focusSearchRef.current = false;
                if (!searchOpen) setSearchOpen(true);
              }}
            />
            <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={closeSearch} title="关闭搜索">
              ×
            </button>
          </div>
        ) : (
          <button
            className="icon-btn"
            title="搜索"
            onClick={() => {
              focusSearchRef.current = true;
              setSearchOpen(true);
            }}
          >
            ⌕
          </button>
        )}
        <button
          className="icon-btn"
          title="更多"
          onClick={(e) => openMenu(e.currentTarget, deckMenu(actions), { alignRight: true })}
        >
          ⋯
        </button>
      </div>
      <div className="deck-layout">
        {disp.showToc && (
          <nav className="toc">
            <div className="toc-head">
              <span>☰</span>
              <b>目录</b>
              <button
                className="icon-btn"
                style={{ width: 24, height: 24, fontSize: 13 }}
                title="新建一级目录"
                onClick={createSectionAtEnd}
              >
                ＋
              </button>
              <button className="icon-btn" style={{ width: 24, height: 24, fontSize: 13 }} title="全部折叠 / 展开" onClick={foldAll}>
                ⇕
              </button>
            </div>
            {secs.length ? (
              secs.map((s) => (
                <div
                  key={s.id}
                  className={`toc-item${s.level === 1 ? ' l1' : ''}`}
                  style={{ paddingLeft: 6 + (s.level - 1) * 14 }}
                  onClick={() => {
                    if (s.collapsed) patchItem(s.id, { collapsed: false });
                    setTimeout(() => document.querySelector(`[data-item="${s.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
                  }}
                >
                  {s.title}
                </div>
              ))
            ) : (
              <div className="hint-text" style={{ padding: '4px 6px' }}>还没有目录</div>
            )}
          </nav>
        )}
        <div className="deck-body" ref={bodyRef}>
          {coverUrl && (
            <div style={{ height: 150, borderRadius: 14, marginBottom: 14, background: `url("${coverUrl}") center/cover` }} />
          )}
          <input
            className="deck-title"
            id="deck-title"
            value={liveTitle}
            maxLength={200}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={commitTitleFromInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
          <div className="deck-dates">
            创建 {fmtDate(deck.createdAt)} · 更新 {fmtDate(deck.updatedAt)}
          </div>
          {deck.description && <div className="deck-desc">{deck.description}</div>}
          {disp.showProgress && deck.counts.total > 0 && (
            <div className="progress-panel">
              <div className="pp-row">
                <span className="pp-pct">{deck.counts.pct}%</span>
                <span className="pp-learned">
                  已学 {deck.counts.learned}/{deck.counts.total}
                </span>
                <div className="pp-stats">
                  <span onClick={() => openStudy({ deckId, content: 'new' })}>
                    <i className="dot" style={{ background: 'var(--accent)' }} />未学 {deck.counts.fresh} 学习 ›
                  </span>
                  <span onClick={() => openStudy({ deckId, content: 'review' })}>
                    <i className="dot" style={{ background: 'var(--orange)' }} />待复习{' '}
                    <b style={{ color: 'var(--orange)' }}>{deck.counts.due}</b> 复习 ›
                  </span>
                </div>
              </div>
              <div className="pp-bar">
                <i style={{ width: `${deck.counts.pct}%` }} />
              </div>
              <div className="pp-btns">
                <span className="btn-split">
                  <button className="btn primary" onClick={() => openStudy({ deckId })}>
                    {`继续学习 · ${resolved ? CONTENT_NAMES[resolved.content] : ''}`}
                  </button>
                  <button className="btn primary" title="学习设置" onClick={() => openDialog('studySettings', deckId)}>
                    ⚙
                  </button>
                </span>
                {disp.showMindmap && (
                  <button className="btn" onClick={() => openDialog('mindmap', deckId)}>
                    ⌘ 导图
                  </button>
                )}
                <span style={{ marginLeft: 'auto' }} className="hint-text">
                  {planText}
                </span>
              </div>
            </div>
          )}
          {items.length === 0 ? (
            <div className="empty-deck">
              <h3>开始搭建你的卡片集</h3>
              <p>可以先用目录把内容分好章节，也可以直接写卡片</p>
              <button className="btn" onClick={newSectionHere}>
                先新建目录
              </button>{' '}
              <button className="btn primary" onClick={() => openEditor({ deckId })}>
                新建第一张卡片
              </button>
              <p className="hint-text" style={{ marginTop: 14 }}>
                也可以{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    openDialog('import', deckId);
                  }}
                >
                  导入文本
                </a>
              </p>
            </div>
          ) : (
            <>
              {rows.map((r, i) =>
                r.kind === 'section' ? (
                  sectionRow(r.item, r.count)
                ) : (
                  <div className={`card-grid${colsClass}`} key={`g${i}`}>
                    {r.cards.map(cardCell)}
                  </div>
                ),
              )}
              {q.trim() && !anyCardShown && <div className="empty">没有匹配的卡片</div>}
            </>
          )}
        </div>
      </div>
      <div className="fab-group">
        <button className="btn" onClick={newSectionHere}>
          ☰ 新建目录
        </button>
        <button className="btn primary" onClick={newCardHere}>
          ＋ 新建卡片
        </button>
      </div>
      <FloatToolbar items={items} selIds={[...sel]} actions={actions} />
      {marquee && (
        <div
          className="marquee"
          style={{ left: marquee.left, top: marquee.top, width: marquee.right - marquee.left, height: marquee.bottom - marquee.top }}
        />
      )}
    </>
  );
}

/** 目录改名输入框：自动聚焦全选，Enter / 失焦提交，Esc 取消（取消由全局键盘处理）。 */
function RenameInput(props: { title: string; onCommit: () => void }): JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      id="rename-input"
      ref={ref}
      defaultValue={props.title}
      maxLength={200}
      onBlur={props.onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
