// 学习弹窗：队列由服务端生成、评分走接口；界面结构照原型 renderStudy / studyDoneHTML / studyKeys。
// 卡片内容优先取 ['items', deckId] 缓存（在学习中编辑过也能看到新内容），取不到才用 session 返回的卡片。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CARD_TYPE_NAMES, CONTENT_NAMES, HOUR,
  dueCutoff, previews, relTime, resolveStudyCfg, schedCfgFor,
  type CardItem, type CardState, type ID, type Item, type QueueEntry, type Rating, type StudyContent,
} from '@bnki/shared';
import { plainText, renderMarkdown } from '@bnki/shared/markdown';
import { api } from '../api';
import { invalidateDeck, useDeck, useDecks, useItems, useSettings } from '../queries';
import { useUI, type StudyTarget } from '../store';
import { Modal } from '../ui/Modal';
import { openMenu } from '../ui/menu';
import { toast } from '../ui/toast';
import { fmtMDHM } from '../format';
import { customTimeMenu, studyMenu, type StudyOps } from './studyMenus';
import { errText } from './util';
import StudyIntro from './StudyIntro';
import type { SchedCfg } from '@bnki/shared';
import type { JSX } from 'react';

interface View {
  revealed: Set<number>; // 已揭示的挖空编号（按内容里出现的顺序，0 起）
  ans: boolean; // 问答卡显示答案
  hint: boolean; // 问答卡显示提示
  hideHint: boolean;
  topic: boolean; // 主题卡显示内容
}

interface Pos {
  queue: QueueEntry[];
  idx: number;
  done: boolean;
}

const freshView = (): View => ({ revealed: new Set(), ans: false, hint: false, hideHint: false, topic: false });
const GRADE_NAMES: Record<number, string> = { 1: '忘记了', 2: '模糊', 3: '记住了', 4: '很简单' };

/** 队列空时按学习内容提示（文案照原型 startStudy）；拿不到 content 时用返回的 label 反推。 */
function emptyText(content: StudyContent | undefined, label: string): string {
  const c = content ?? (Object.keys(CONTENT_NAMES) as StudyContent[]).find((k) => CONTENT_NAMES[k] === label);
  if (c === 'review') return '当前没有需要复习的卡片';
  if (c === 'new') return '今天的新卡已学完（或没有未学卡片）';
  return '当前待学卡片已清空 🎉';
}

export default function StudyModal(): JSX.Element | null {
  const target = useUI((s) => s.study);
  if (!target) return null;
  // key 变化让状态整套重建（同一卡片集换一组重开也一样）
  const key = target.viewer
    ? `v:${target.deckId}:${target.cardIds.join(',')}:${target.cardId}`
    : `s:${target.deckId}:${target.content ?? ''}`;
  // 说明框排在学习弹窗后面挂载，才在浮层栈的最上层
  return (
    <>
      <StudyView key={key} target={target} />
      {!target.viewer && <StudyIntro />}
    </>
  );
}

function StudyView(props: { target: StudyTarget }): JSX.Element | null {
  const target = props.target;
  const deckId = target.deckId;
  const viewer = target.viewer === true;
  const content: StudyContent | undefined = target.viewer ? undefined : target.content;
  const qc = useQueryClient();
  const { data: deck } = useDeck(deckId);
  const { data: items } = useItems(deckId);
  const { data: settings } = useSettings();
  const { data: allDecks } = useDecks({ view: 'all' });
  const openEditor = useUI((s) => s.openEditor);
  const closeStudy = useUI((s) => s.closeStudy);

  const [pos, setPos] = useState<Pos>({ queue: [], idx: 0, done: false });
  const [ready, setReady] = useState(false); // 队列就绪，可以出卡
  const [label, setLabel] = useState('');
  const [sessCards, setSessCards] = useState<CardItem[]>([]);
  const [more, setMore] = useState(0); // 结束页“再学一组”的数量
  const [view, setView] = useState<View>(freshView);

  const contentRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const clozeTotal = useRef(0);
  const startAt = useRef(Date.now()); // 本次学习开始
  const cardStart = useRef(Date.now()); // 这张卡开始显示的时间（评分时长用）
  const results = useRef<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0 });

  const entry = pos.queue[pos.idx];
  const cardId = entry?.cardId;
  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i] as const)), [items]);
  const raw = cardId ? byId.get(cardId) ?? sessCards.find((c) => c.id === cardId) : undefined;
  const card: CardItem | null = raw && raw.kind === 'card' ? raw : null;

  const resolved = deck && settings ? resolveStudyCfg(deck.studyCfg, settings) : null;
  const cfg: SchedCfg | null = resolved && settings ? schedCfgFor(settings, resolved) : null;

  const close = (): void => {
    invalidateDeck(qc, deckId);
    closeStudy();
  };

  // 打开时取队列：学习模式问服务器，查看器直接用 cardIds（不请求 session）
  useEffect(() => {
    if (viewer) {
      const ids = (target as { cardIds: ID[] }).cardIds;
      const from = (target as { cardId: ID }).cardId;
      const queue: QueueEntry[] = ids.map((id) => ({ cardId: id, rep: false, flipped: false }));
      setPos({ queue, idx: Math.max(0, queue.findIndex((q) => q.cardId === from)), done: !queue.length });
      setLabel('全部卡片');
      setSessCards([]);
      setReady(true);
      return;
    }
    let dead = false;
    void api.study
      .session(deckId, content)
      .then((r) => {
        if (dead) return;
        if (!r.queue.length) {
          toast(emptyText(content, r.label));
          closeStudy();
          return;
        }
        startAt.current = Date.now();
        results.current = { 1: 0, 2: 0, 3: 0, 4: 0 };
        setPos({ queue: r.queue, idx: 0, done: false });
        setLabel(r.label);
        setSessCards(r.cards);
        setReady(true);
      })
      .catch((e: unknown) => {
        if (dead) return;
        toast(errText(e));
        closeStudy();
      });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, viewer, content]);

  // 换卡（含队列插入导致当前位置换了卡）就重置显示状态和计时
  useEffect(() => {
    setView(freshView());
    cardStart.current = Date.now();
  }, [cardId, pos.idx]);

  // 结束页：非查看器再问一次队列，决定要不要显示“再学一组”
  useEffect(() => {
    if (!pos.done || viewer) return;
    let dead = false;
    void api.study
      .session(deckId, content)
      .then((r) => {
        if (!dead) setMore(r.queue.length);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos.done, viewer, deckId]);

  // 挖空按出现顺序编号，按已揭示集合换类名；计数器同步文字
  useEffect(() => {
    const root = contentRef.current;
    const counter = counterRef.current;
    if (!root || !counter) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('.cloze'));
    clozeTotal.current = els.length;
    els.forEach((el, i) => {
      const shown = view.revealed.has(i);
      el.dataset.ci = String(i);
      el.classList.toggle('shown', shown);
      el.classList.toggle('hidden-c', !shown);
    });
    counter.classList.toggle('hidden', els.length === 0);
    counter.textContent = `挖空 ${els.filter((_, i) => view.revealed.has(i)).length}/${els.length}　V`;
  });

  if (!ready || !resolved || !settings || !cfg) return <Modal raw onClose={close}>{null}</Modal>;
  // 条目还没加载出来时先不出卡（查看器只有 items 这一个内容来源）
  if (!card && items === undefined && sessCards.length === 0) return <Modal raw onClose={close}>{null}</Modal>;
  const done = pos.done || !card;

  const flip = card !== null && entry?.flipped === true && card.cardType === 'qa';
  const qSrc = card ? (flip ? card.back : card.front) : '';
  const aSrc = card ? (flip ? card.front : card.back) : '';
  const canGrade =
    card !== null && (card.cardType === 'note' || (card.cardType === 'qa' && view.ans) || (card.cardType === 'topic' && view.topic));
  const preview: Record<number, string> | null =
    entry?.rep && settings.requeueNoReschedule ? null : previews(card?.state ?? null, Date.now(), cfg, settings.easyButton ? 4 : 3);

  const writeState = (c: CardItem, st: CardState | null): void => {
    const id = c.id;
    qc.setQueryData(['items', deckId], (old: Item[] | undefined) => old?.map((i) => (i.id === id ? { ...i, state: st } : i)));
  };

  const advance = (): void => {
    setMore(0);
    setPos((p) => (p.idx + 1 >= p.queue.length ? { ...p, done: true } : { ...p, idx: p.idx + 1 }));
  };

  const go = (step: number): void => {
    setPos((p) => {
      const n = p.idx + step;
      return n < 0 || n >= p.queue.length ? p : { ...p, idx: n, done: false };
    });
  };

  /** 从队列里拿掉当前项：后面还有就显示后面那张，否则进结束页。 */
  const dropCurrent = (): void => {
    setMore(0);
    setPos((p) => {
      const queue = p.queue.filter((_, i) => i !== p.idx);
      return p.idx >= queue.length ? { ...p, queue, done: true } : { ...p, queue };
    });
  };

  const grade = (c: CardItem, rating: Rating): void => {
    const rep = entry && entry.cardId === c.id ? entry : undefined;
    const practice = !!rep?.rep && settings.requeueNoReschedule;
    void api.study
      .review({ cardId: c.id, rating, durationMs: Date.now() - cardStart.current, practice })
      .then((r) => writeState(c, r.state))
      .catch((e: unknown) => toast(errText(e)));
    results.current[rating] += 1;
    if (rating === 1 && !viewer) {
      // 本轮稍后再练一次：插在当前位置后面几张之后
      setPos((p) => {
        const cur = p.queue[p.idx];
        if (!cur) return p;
        const queue = [...p.queue];
        queue.splice(Math.min(queue.length, p.idx + 4), 0, { cardId: cur.cardId, rep: true, flipped: cur.flipped });
        return { ...p, queue };
      });
      toast('已加入本轮稍后再练一次');
    }
    advance();
  };

  const manualDue = (c: CardItem, due: number, text: string): void => {
    void api.study
      .manual({ cardId: c.id, action: 'due', due })
      .then((r) => {
        writeState(c, r.state);
        toast('下次复习：' + text);
        advance();
      })
      .catch((e: unknown) => toast(errText(e)));
  };

  const manual = (c: CardItem, action: 'master' | 'forget', msg: string): void => {
    void api.study
      .manual({ cardId: c.id, action })
      .then((r) => {
        writeState(c, r.state);
        toast(msg);
        advance();
      })
      .catch((e: unknown) => toast(errText(e)));
  };

  const revealNext = (): void => {
    setView((v) => {
      for (let i = 0; i < clozeTotal.current; i++) {
        if (!v.revealed.has(i)) {
          const revealed = new Set(v.revealed);
          revealed.add(i);
          return { ...v, revealed };
        }
      }
      return v;
    });
  };

  const toggleAllCloze = (): void => {
    setView((v) => {
      const all = Array.from({ length: clozeTotal.current }, (_, i) => i);
      const anyHidden = all.some((i) => !v.revealed.has(i));
      return { ...v, revealed: new Set(anyHidden ? all : []) };
    });
  };

  const toggleCloze = (i: number): void => {
    setView((v) => {
      const revealed = new Set(v.revealed);
      if (revealed.has(i)) revealed.delete(i);
      else revealed.add(i);
      return { ...v, revealed };
    });
  };

  const speak = (c: CardItem, answered: boolean, qSide: string): void => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      toast('浏览器不支持朗读');
      return;
    }
    const src = c.cardType === 'qa' && !answered ? qSide : [c.front, c.back].join('。');
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(plainText(src));
    u.rate = settings.ttsRate;
    if (settings.ttsLang) u.lang = settings.ttsLang;
    window.speechSynthesis.speak(u);
  };

  const ops = (c: CardItem): StudyOps => ({
    deckId,
    card: c,
    deck: deck ?? null,
    settings,
    writeState: (st) => writeState(c, st),
    advance,
    dropCurrent,
    setColor: (color) => {
      void api.items
        .update(c.id, { color })
        .then((item) => {
          qc.setQueryData(['items', deckId], (old: Item[] | undefined) => old?.map((i) => (i.id === item.id ? item : i)));
        })
        .catch((e: unknown) => toast(errText(e)));
    },
    setCfg: (patch) => {
      void api.decks
        .update(deckId, { studyCfg: { ...(deck?.studyCfg ?? {}), ...patch } })
        .then((d) => qc.setQueryData(['deck', deckId], d))
        .catch((e: unknown) => toast(errText(e)));
    },
    due: (due, text) => manualDue(c, due, text),
    mark: (action, msg) => manual(c, action, msg),
  });

  const onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (done) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        close();
      }
      return;
    }
    if (!card) return;
    const k = e.key;
    if (k === '1' || k === '2' || k === '3' || (k === '4' && settings.easyButton)) {
      if (canGrade) grade(card, Number(k) as Rating);
      else toast(card.cardType === 'qa' ? '先按空格显示答案' : '先显示内容');
    } else if (k === ' ') {
      e.preventDefault();
      if (card.cardType === 'qa') setView((v) => ({ ...v, ans: !v.ans }));
      else if (card.cardType === 'topic') setView((v) => ({ ...v, topic: !v.topic }));
      else revealNext();
    } else if (k === 'v' || k === 'V') {
      if (e.shiftKey) toggleAllCloze();
      else revealNext();
    } else if (k === 'h' || k === 'H') {
      if (card.hint) setView((v) => ({ ...v, hint: true, hideHint: false }));
    } else if (k === 'ArrowLeft') go(-1);
    else if (k === 'ArrowRight') go(1);
    else if (k === 'e' || k === 'E') openEditor({ deckId, cardId: card.id });
    else if (k === 'r' || k === 'R') speak(card, view.ans, qSrc);
  };

  const mins = Math.max(1, Math.round((Date.now() - startAt.current) / 60000));
  const r = results.current;
  const graded = r[1] + r[2] + r[3] + r[4];

  return (
    <Modal raw onClose={close} onKeyDown={onKey}>
      <button className="study-close" onClick={close} title="关闭（Esc）">×</button>
      <div className="study-wrap">
        <button className="study-arrow" onClick={() => go(-1)} title="上一张（←）">‹</button>
        <div className={done || !card ? 'study' : `study col-${card.color || 'default'} size-${resolved.size} fs-${resolved.fontSize}`}
          style={done ? { background: 'var(--panel)' } : { backgroundColor: 'var(--panel)' }}
        >
          {done || !card ? (
            <div className="study-done">
              <div className="big">🎉</div>
              <h2>学习完成</h2>
              <div className="sum">{viewer ? '已浏览到最后一张' : '本次学习已完成，当前待学卡片已清空'}</div>
              <div className="bars">
                <span>共 <b>{graded}</b> 次评分</span>
                <span>用时 <b>{mins}</b> 分钟</span>
              </div>
              <div className="bars">
                <span style={{ color: 'var(--red)' }}>忘记了 {r[1]}</span>
                <span style={{ color: 'var(--orange)' }}>模糊 {r[2]}</span>
                <span style={{ color: 'var(--green)' }}>记住了 {r[3]}</span>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {more > 0 && !viewer ? (
                  <button
                    className="btn"
                    onClick={() => {
                      void api.study
                        .session(deckId, content)
                        .then((res) => {
                          if (!res.queue.length) {
                            toast(emptyText(content, res.label));
                            return;
                          }
                          startAt.current = Date.now();
                          results.current = { 1: 0, 2: 0, 3: 0, 4: 0 };
                          setMore(0);
                          setPos({ queue: res.queue, idx: 0, done: false });
                          setLabel(res.label);
                          setSessCards(res.cards);
                        })
                        .catch((e: unknown) => toast(errText(e)));
                    }}
                  >
                    {`再学一组（${more}）`}
                  </button>
                ) : null}
                <button className="btn primary" onClick={close}>完成</button>
              </div>
            </div>
          ) : (
            <>
              <div className="study-head">
                <span style={{ width: 100 }} />
                <span className="title">
                  {label}（{pos.idx + 1}/{pos.queue.length}）· {CARD_TYPE_NAMES[card.cardType]}
                </span>
                <span style={{ width: 100, display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="icon-btn" onClick={() => speak(card, view.ans, qSrc)} title="朗读（R）">🔈</button>
                  <button className="icon-btn" onClick={() => openEditor({ deckId, cardId: card.id })} title="编辑（E）">✎</button>
                  <button
                    className="icon-btn"
                    onClick={(e) => openMenu(e.currentTarget, studyMenu(ops(card), allDecks ?? []), { alignRight: true })}
                    title="更多"
                  >
                    ⋮
                  </button>
                </span>
              </div>
              <StateLine card={card} cfg={cfg} now={Date.now()} />
              <div
                className="study-content"
                ref={contentRef}
                onClick={(e) => {
                  const el = e.target as HTMLElement;
                  const cz = el.closest<HTMLElement>('.cloze');
                  if (cz) toggleCloze(Number(cz.dataset.ci ?? 0));
                  else if (resolved.clickBlankRevealNext && !el.closest('a, button, pre')) revealNext();
                }}
              >
                {card.cardType === 'topic' ? (
                  <>
                    <div className="topic-title">{plainText(card.front)}</div>
                    {view.topic ? (
                      <div style={{ marginTop: 24, whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(card.back) }} />
                    ) : (
                      <div className="show-ans">
                        <button className="btn" onClick={() => setView((v) => ({ ...v, topic: true }))}>显示内容（空格）</button>
                      </div>
                    )}
                  </>
                ) : card.cardType === 'qa' ? (
                  <>
                    <div className="q-part md" dangerouslySetInnerHTML={{ __html: renderMarkdown(qSrc) }} />
                    {card.hint && !flip ? (
                      <div className="hint-box">
                        {view.hint && !view.hideHint ? (
                          <div className="hint-shown md" dangerouslySetInnerHTML={{ __html: renderMarkdown(card.hint) }} />
                        ) : (
                          <button className="hint-btn" onClick={() => setView((v) => ({ ...v, hint: true, hideHint: false }))}>
                            💡 点击显示提示（H）
                          </button>
                        )}
                      </div>
                    ) : null}
                    {view.ans ? (
                      <>
                        <hr className="ans-sep" />
                        <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(aSrc) }} />
                      </>
                    ) : (
                      <div className="show-ans">
                        <button className="btn primary" onClick={() => setView((v) => ({ ...v, ans: true }))}>显示答案（空格）</button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(card.front) }} />
                )}
              </div>
              <div className="study-foot">
                <div className="study-sub">
                  <span className="toggles">
                    {card.cardType === 'qa' && view.ans ? (
                      <>
                        {card.hint && !flip ? (
                          <button
                            onClick={() => setView((v) => (v.hint && !v.hideHint ? { ...v, hideHint: true } : { ...v, hint: true, hideHint: false }))}
                          >
                            {view.hint && !view.hideHint ? '隐藏提示' : '显示提示'}
                          </button>
                        ) : null}
                        <button onClick={() => setView((v) => ({ ...v, ans: false }))}>隐藏内容</button>
                      </>
                    ) : null}
                  </span>
                  <span
                    className="cloze-counter"
                    ref={counterRef}
                    onClick={revealNext}
                    title="点挖空可直接显示；这里或按 V 显示下一个，⇧V 全部显示 / 隐藏"
                  />
                </div>
                <div className="grade-row">
                  {[1, 2, 3, 4]
                    .filter((n) => n < 4 || settings.easyButton)
                    .map((n) => (
                      <button
                        key={n}
                        className={`grade g${n}`}
                        disabled={!canGrade}
                        title={`快捷键 ${n}`}
                        onClick={() => grade(card, n as Rating)}
                      >
                        <b>{GRADE_NAMES[n]}</b>
                        <small>{preview ? preview[n] : '本轮练习'}</small>
                      </button>
                    ))}
                  <button
                    className="grade more"
                    title="自定义复习时间 / 完成学习 / 彻底忘记"
                    onClick={(e) => openMenu(e.currentTarget, customTimeMenu(ops(card)), { alignRight: true })}
                  >
                    ⋯
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        <button className="study-arrow" onClick={() => go(1)} title="下一张（→）">›</button>
      </div>
    </Modal>
  );
}

/** 状态行：新卡片，或 到期情况 / 已复习次数 / 上次复习时间。 */
function StateLine(props: { card: CardItem; cfg: SchedCfg; now: number }): JSX.Element {
  const st = props.card.state;
  if (!st || st.state === 0) {
    return (
      <div className="study-state">
        <span>
          <b style={{ color: 'var(--accent)' }}>新卡片</b>第一次学习
        </span>
      </div>
    );
  }
  const cutoff = dueCutoff(props.cfg, props.now);
  const overdue = !st.mastered && st.due != null && st.due <= cutoff;
  return (
    <div className="study-state">
      <span className={overdue ? 'due' : ''}>
        {st.mastered ? <b>已掌握</b> : overdue ? (
          <>
            <b>{st.due != null && st.due < props.now - HOUR ? relTime(props.now - st.due) + '前' : '现在'}</b>
            需复习
          </>
        ) : (
          <>
            <b>{st.due != null ? relTime(st.due - props.now) + '后' : '—'}</b>
            下次复习
          </>
        )}
      </span>
      <span>
        <b>{st.reps} 次</b>已复习
      </span>
      <span>
        <b>{fmtMDHM(st.lastReview)}</b>上次复习
      </span>
    </div>
  );
}
