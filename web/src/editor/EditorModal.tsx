/** 卡片编辑器弹窗：useUI().editor 不为 null 时显示。 */
import { Fragment, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CARD_COLORS, CARD_TYPE_NAMES, DEFAULT_SETTINGS,
  type CardColor, type CardItem, type CardType, type ID, type Settings,
} from '@bnki/shared';
import { plainText } from '@bnki/shared/markdown';
import type { Editor } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';
import { api } from '../api';
import { invalidateDeck, useItems, useSaveSettings, useSettings } from '../queries';
import { useUI, type EditorTarget } from '../store';
import { Modal } from '../ui/Modal';
import { confirmDialog, promptDialog } from '../ui/dialogs';
import { openMenu } from '../ui/menu';
import { Swatches } from '../ui/Swatches';
import { toast } from '../ui/toast';
import { RichField, TopicFields } from './fields';
import Toolbar from './Toolbar';
import FormulaDialog from './FormulaDialog';
import CardLinkPicker from './CardLinkPicker';
import { applyFormat, captureFormat } from './painter';
import { docToMarkdown } from './schema';
import {
  activeState, applyBlock, applyCmd, applyFontSize, applyMarker, applyTextColor, clearMarker,
  SOURCE_WRAP, toggleCloze, wrapText,
  type ActiveMap, type Cmd, type EditorApi, type FieldKey,
} from './commands';
import '../styles/editor.css';
import type { JSX } from 'react';

/** 格式刷的状态：连续用还是用一次，以及刷的格式。 */
type Painter = { sticky: boolean; marks: Mark[] };

const colorHex = (c: CardColor): string => CARD_COLORS.find((x) => x.key === c)?.hex ?? '#ffffff';

interface EdState {
  type: CardType;
  color: CardColor;
  /** 源码模式下的文本：编辑器实例里的内容不经过这里。 */
  md: Record<FieldKey, string>;
  showHint: boolean;
  src: Partial<Record<FieldKey, boolean>>;
  help: boolean;
  /** 新建时插在哪一项后面（undefined = 末尾，null = 最前面）。 */
  afterId?: ID | null;
  /** 每次清空字段加一，用来重挂字段。 */
  resetSeq: number;
}

const ALL_FIELDS: FieldKey[] = ['front', 'hint', 'back'];

/** 停止输入多久后自动保存；保存失败后多久重试。 */
const AUTOSAVE_MS = 800;
const RETRY_MS = 3000;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const SAVE_TEXT: Record<SaveState, string> = { idle: '', saving: '保存中…', saved: '已保存', error: '保存失败，正在重试' };

interface CardBody {
  cardType: CardType;
  color: CardColor;
  front: string;
  hint: string;
  back: string;
}

function init(target: EditorTarget, card: CardItem | null, s: Settings): EdState {
  return {
    type: card ? card.cardType : s.lastCardType,
    color: card ? card.color : s.lastCardColor,
    md: { front: card ? card.front : '', hint: card?.hint ?? '', back: card?.back ?? '' },
    showHint: !!(card && card.hint),
    src: {},
    help: false,
    afterId: target.afterId,
    resetSeq: 0,
  };
}

export default function EditorModal(): JSX.Element | null {
  const target = useUI((s) => s.editor);
  if (!target) return null;
  return <EditorMount key={target.deckId + (target.cardId ?? '')} target={target} />;
}

/** 卡片数据和设置都到位了才开始，初值（类型、颜色、内容）才不会是空的。 */
function EditorMount(props: { target: EditorTarget }): JSX.Element | null {
  const items = useItems(props.target.deckId);
  const settings = useSettings();
  const [st, setSt] = useState<EdState | null>(null);
  const card = props.target.cardId
    ? items.data?.find((i): i is CardItem => i.id === props.target.cardId && i.kind === 'card') ?? null
    : null;
  if (!st && !items.isPending && !settings.isPending) setSt(init(props.target, card, settings.data ?? DEFAULT_SETTINGS));
  if (!st) return null;
  return <EditorBody target={props.target} card={card} settings={settings.data ?? DEFAULT_SETTINGS} st={st} setEd={setEd} />;

  function setEd(fn: (s: EdState) => EdState): void {
    setSt((prev) => (prev ? fn(prev) : prev));
  }
}

function EditorBody(props: {
  target: EditorTarget;
  card: CardItem | null;
  settings: Settings;
  st: EdState;
  setEd(fn: (s: EdState) => EdState): void;
}): JSX.Element {
  const { target, card, settings, st } = props;
  const qc = useQueryClient();
  const saveSettings = useSaveSettings();
  const closeEditor = useUI((s) => s.closeEditor);

  const [active, setActive] = useState<FieldKey | null>(null);
  const [, setTick] = useState(0);
  const [formula, setFormula] = useState(false);
  const [paint, setPaint] = useState<Painter | null>(null);
  const [cardLink, setCardLink] = useState<{ field: FieldKey; from: number } | null>(null);
  const paintRef = useRef<Painter | null>(null);
  const editors = useRef<Partial<Record<FieldKey, Editor | null>>>({});
  const inputs = useRef<Partial<Record<FieldKey, HTMLTextAreaElement | HTMLInputElement | null>>>({});
  const activeRef = useRef<FieldKey | null>(null);
  const closing = useRef(false);
  const [saveState, setSaveStateRaw] = useState<SaveState>('idle');
  const saveStateRef = useRef<SaveState>('idle');
  // 这张卡在服务器上的 id：编辑已有卡片一开始就有；新建的第一次自动保存后才有
  const savedId = useRef<ID | null>(target.cardId ?? null);
  // 新建的卡已经自动建出来了：关闭时内容又删空了，就把它删掉
  const autoCreated = useRef(false);
  // 最近一次存下的内容，没变就不发请求（编辑已有卡片时从卡片原样算起）
  const lastSaved = useRef(
    card
      ? JSON.stringify({ cardType: card.cardType, color: card.color, front: card.front, hint: card.hint ?? '', back: card.back ?? '' })
      : '',
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 保存一个接一个排队，新建的请求没回来之前不会再建一张
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  // 计时器到点时要读最新一次渲染的状态（类型、颜色、源码模式的文本）
  const snapshotRef = useRef<() => { body: CardBody; empty: boolean; afterId?: ID | null }>(() => snapshot());
  snapshotRef.current = snapshot;
  const formulaFrom = useRef<{ ed: Editor; from: number; to: number } | null>(null);
  // Esc 由 Modal 转成 onClose，但它分不清输入法组字中的 Esc；先在捕获阶段记一下
  const escComposing = useRef(false);
  useEffect(() => {
    const onDoc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') escComposing.current = e.isComposing;
    };
    document.addEventListener('keydown', onDoc, true);
    return () => document.removeEventListener('keydown', onDoc, true);
  }, []);

  const bump = (): void => setTick((n) => n + 1);

  // 格式刷：只在字段里松手时动手；选区要等 mouseup 之后才落到编辑器状态里，下一拍再取
  useEffect(() => {
    if (!paint) return;
    const onUp = (e: MouseEvent): void => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el || !el.closest('.wysiwyg')) return;
      setTimeout(() => {
        const p = paintRef.current;
        if (!p) return;
        const ed = quietEditor();
        if (!ed || !applyFormat(ed, p.marks)) return;
        if (!p.sticky) setPainter(null);
      }, 0);
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, [paint]);

  /** 这个字段是不是纯文本形态（主题卡、源码模式，和没显示出来的字段）。 */
  const isSource = (f: FieldKey): boolean => !shown(f) || st.type === 'topic' || !!st.src[f];
  const fields = ALL_FIELDS.filter(shown);
  const first = fields[0] ?? 'front';

  function shown(f: FieldKey): boolean {
    // 提示只在问答卡上出现；笔记卡只有一个内容字段，主题卡是标题加纯文本
    if (f === 'hint') return st.type === 'qa' && st.showHint;
    return !(st.type === 'note' && f === 'back');
  }

  function readField(f: FieldKey): string {
    if (isSource(f)) return st.md[f];
    const ed = editors.current[f];
    return ed ? docToMarkdown(ed.state.doc) : st.md[f];
  }

  function collect(): Record<FieldKey, string> {
    return { front: readField('front'), hint: readField('hint'), back: readField('back') };
  }

  /** 最后一个获得焦点的字段；null = 还没点过。 */
  type Target = { kind: 'wysiwyg'; field: FieldKey; ed: Editor } | { kind: 'source'; field: FieldKey };
  function activeTarget(): Target | null {
    const f = activeRef.current;
    if (!f) return null;
    if (isSource(f)) return inputs.current[f] ? { kind: 'source', field: f } : null;
    const ed = editors.current[f];
    return ed ? { kind: 'wysiwyg', field: f, ed } : null;
  }

  /** 结果对应的提示语，命令都在这儿收口。 */
  function report(r: 'ok' | 'cross' | 'empty'): void {
    if (r === 'cross') toast('挖空不能跨行，请分别选中每一行');
    else if (r === 'empty') toast('请先选中文字');
  }

  /** 命令：源码模式只加 Markdown 标记，别的不做。 */
  function run(cmd: Cmd): void {
    const t = activeTarget();
    if (!t) {
      toast('先点一下要编辑的输入框');
      return;
    }
    if (t.kind === 'source') {
      const w = SOURCE_WRAP[cmd];
      if (!w) {
        toast('源码模式下请直接写 Markdown');
        return;
      }
      wrapInto(t.field, w[0], w[1]);
      return;
    }
    report(applyCmd(t.ed, cmd));
  }

  /** 菜单项的入口：命令都作用在当前聚焦的字段上。 */
  function edit(fn: (ed: Editor) => void | 'ok' | 'cross' | 'empty'): void {
    const ed = editorOfActive();
    if (!ed) return;
    const r = fn(ed);
    if (r !== undefined) report(r);
  }

  /** 需要落到编辑器上的操作；没有可操作的字段时给提示。 */
  function editorOfActive(): Editor | null {
    const t = activeTarget();
    if (!t) {
      toast('先点一下要编辑的输入框');
      return null;
    }
    if (t.kind !== 'wysiwyg') {
      toast('源码模式下请直接写 Markdown');
      return null;
    }
    return t.ed;
  }

  function focusField(f: FieldKey): void {
    activeRef.current = f;
    setActive(f);
    // 返回 true 表示焦点已经在这个字段里了。
    // 不用 isSource 判断形态：调用方（如加提示）可能还在旧的渲染里，字段要下一次渲染才挂上；按实际挂着的元素来
    const run2 = (): boolean => {
      const el = inputs.current[f];
      if (el?.isConnected) {
        if (document.activeElement === el) return true;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
        return document.activeElement === el;
      }
      const ed = editors.current[f];
      if (!ed || ed.isDestroyed) return false;
      // 实例建好了但视图还没挂到页面上时拿不到 dom，要等它挂上
      let dom: HTMLElement | null = null;
      try {
        dom = ed.view.dom;
      } catch {
        dom = null;
      }
      if (!dom?.isConnected) return false;
      if (ed.view.hasFocus()) return true;
      // Tiptap 的 focus 命令要到下一帧才真正聚焦，后台标签页里帧会被挂起；这里先设好光标再同步聚焦
      ed.view.dispatch(ed.state.tr.setSelection(Selection.atEnd(ed.state.doc)));
      ed.view.focus();
      return ed.view.hasFocus();
    };
    // 字段刚挂上时编辑器可能还没建好（开发模式下还会先建一个再换新的），等到焦点真的落进去为止
    let tries = 0;
    const retry = (): void => {
      if (run2() || ++tries > 30 || activeRef.current !== f) return;
      setTimeout(retry, 16);
    };
    retry();
  }

  function focusFirst(): void {
    focusField(first);
  }

  // 打开和换类型后聚焦第一个字段
  useEffect(() => {
    if (activeRef.current) return;
    const t = setTimeout(focusFirst, 0);
    return () => clearTimeout(t);
  }, [st.type, st.resetSeq]);

  /** 文本域里给选区两侧加标记。 */
  function wrapInto(f: FieldKey, open: string, close: string): void {
    const el = inputs.current[f];
    if (!el) {
      toast('先点一下要编辑的输入框');
      return;
    }
    const r = wrapText(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0, open, close);
    props.setEd((s) => ({ ...s, md: { ...s.md, [f]: r.text } }));
    setTimeout(() => el.setSelectionRange(r.from, r.to), 0);
  }

  function setSaveState(v: SaveState): void {
    saveStateRef.current = v;
    setSaveStateRaw(v);
  }

  /** 当前要存的内容。没显示的字段不存（笔记卡没有答案，只有问答卡有提示）。 */
  function snapshot(): { body: CardBody; empty: boolean; afterId?: ID | null } {
    const cur = collect();
    const body: CardBody = {
      cardType: st.type,
      color: st.color,
      front: cur.front,
      hint: st.type === 'qa' ? cur.hint : '',
      back: st.type === 'note' ? '' : cur.back,
    };
    return { body, empty: !body.front.trim() && !body.back.trim(), afterId: st.afterId };
  }

  function afterSave(body: CardBody): void {
    invalidateDeck(qc, target.deckId);
    if (settings.lastCardType !== body.cardType || settings.lastCardColor !== body.color) {
      void saveSettings({ lastCardType: body.cardType, lastCardColor: body.color }).catch(() => undefined);
    }
  }

  /** 内容有改动：停一会儿再存。 */
  function scheduleSave(ms = AUTOSAVE_MS): void {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush();
    }, ms);
  }

  /** 立刻存（排在前一次保存之后），返回是否存成功。空内容不存，算成功。 */
  function flush(): Promise<boolean> {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    queue.current = queue.current.then(persist);
    return queue.current;
  }

  async function persist(): Promise<boolean> {
    const snap = snapshotRef.current();
    const key = JSON.stringify(snap.body);
    if (snap.empty || key === lastSaved.current) return true;
    setSaveState('saving');
    try {
      if (savedId.current) {
        await api.items.update(savedId.current, snap.body);
      } else {
        const item = await api.items.create({
          deckId: target.deckId,
          kind: 'card',
          ...(snap.afterId !== undefined ? { afterId: snap.afterId } : {}),
          ...snap.body,
        });
        savedId.current = item.id;
        autoCreated.current = true;
      }
      lastSaved.current = key;
      setSaveState('saved');
      afterSave(snap.body);
      return true;
    } catch {
      setSaveState('error');
      scheduleSave(RETRY_MS);
      return false;
    }
  }

  /** 这次自动建出来的卡关闭时内容是空的：删掉，不留空卡。 */
  async function dropIfEmpty(): Promise<void> {
    const id = savedId.current;
    if (!id || !autoCreated.current || !snapshotRef.current().empty) return;
    await api.items.remove([id]).catch(() => undefined);
    invalidateDeck(qc, target.deckId);
  }

  // 关闭或刷新页面时还有没存上的：先发出去，再让浏览器问一句
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent): void => {
      if (!timer.current && saveStateRef.current !== 'saving' && saveStateRef.current !== 'error') return;
      void flush();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('beforeunload', onLeave);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  /** Esc、点遮罩、×：存完再关；存不上就提示并留在编辑器里。 */
  async function saveAndClose(): Promise<void> {
    const comp = escComposing.current;
    escComposing.current = false;
    if (comp || closing.current) return;
    closing.current = true;
    if (!(await flush())) {
      toast('保存失败');
      closing.current = false;
      return;
    }
    await dropIfEmpty();
    closeEditor();
  }

  async function done(): Promise<void> {
    if (target.cardId || !settings.continuousNew) {
      await saveAndClose();
      return;
    }
    if (snapshotRef.current().empty) {
      toast('卡片是空的');
      return;
    }
    if (!(await flush())) {
      toast('保存失败');
      return;
    }
    const id = savedId.current;
    savedId.current = null;
    autoCreated.current = false;
    lastSaved.current = '';
    setSaveState('idle');
    props.setEd((s) => ({ ...s, afterId: id, md: { front: '', hint: '', back: '' }, resetSeq: s.resetSeq + 1 }));
    toast('已保存，继续新建下一张');
    focusFirst();
  }

  function toggleSrc(f: FieldKey): void {
    const ed = editors.current[f];
    if (ed && !st.src[f]) {
      const md = docToMarkdown(ed.state.doc);
      props.setEd((s) => ({ ...s, md: { ...s.md, [f]: md }, src: { ...s.src, [f]: true } }));
    } else {
      props.setEd((s) => ({ ...s, src: { ...s.src, [f]: !s.src[f] } }));
    }
    setTimeout(() => focusField(f), 0);
  }

  function switchType(k: CardType): void {
    if (k === st.type) return;
    const cur = collect();
    props.setEd((s) => ({ ...s, type: k, md: { ...s.md, ...cur }, showHint: s.showHint || !!cur.hint }));
    activeRef.current = null;
    setActive(null);
    scheduleSave();
  }

  async function switchToTopic(): Promise<void> {
    const ok = await confirmDialog('切换为主题卡片', '主题卡片只有标题和纯文本内容，样式和图片会被清除。', '切换');
    if (!ok) return;
    const cur = collect();
    props.setEd((s) => ({
      ...s,
      type: 'topic',
      md: { ...s.md, front: plainText(cur.front).slice(0, 60), hint: cur.hint, back: plainText(cur.back) },
    }));
    activeRef.current = null;
    setActive(null);
    scheduleSave();
  }

  function addHint(): void {
    props.setEd((s) => ({ ...s, showHint: true }));
    focusField('hint');
  }

  async function addLink(): Promise<void> {
    const ed = editorOfActive();
    if (!ed) return;
    const url = await promptDialog('添加链接', 'https://', '输入网址');
    if (!url) return;
    const { empty, from, to } = ed.state.selection;
    const chain = ed.chain().focus().setTextSelection({ from, to });
    if (empty) chain.insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run();
    else chain.setLink({ href: url }).run();
  }

  function pickFile(onFile: (file: File) => void): void {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (f) onFile(f);
    };
    inp.click();
  }

  /** 图片插到指定字段；这个字段是纯文本形态就提示一下。 */
  function insertImage(f: FieldKey | null): void {
    if (!f) {
      toast('先点一下要编辑的输入框');
      return;
    }
    const ed = isSource(f) ? null : editors.current[f];
    if (!ed) {
      toast(isSource(f) ? '源码模式下请直接写 Markdown' : '先点一下要编辑的输入框');
      return;
    }
    pickFile((file) => {
      void api.media
        .upload(file)
        .then(({ path }) => ed.chain().focus().setImage({ src: '/' + path }).run())
        .catch(() => toast('图片上传失败'));
    });
  }

  function openFormula(): void {
    const ed = editorOfActive();
    if (!ed) return;
    const { from, to } = ed.state.selection;
    formulaFrom.current = { ed, from, to };
    setFormula(true);
  }

  function closeFormula(tex: string | null): void {
    setFormula(false);
    const rec = formulaFrom.current;
    formulaFrom.current = null;
    if (!tex || !rec) return;
    rec.ed.chain().focus().setTextSelection({ from: rec.from, to: rec.to }).insertContent({ type: 'mathInline', attrs: { tex } }).run();
  }

  function nextField(): void {
    if (!fields.length) return;
    const i = activeRef.current ? fields.indexOf(activeRef.current) : -1;
    focusField(fields[(i + 1) % fields.length]);
  }

  /** 当前字段的所见即所得编辑器；拿不到就算了，调用方自己提示。 */
  function quietEditor(): Editor | null {
    const t = activeTarget();
    return t && t.kind === 'wysiwyg' ? t.ed : null;
  }

  function setPainter(next: Painter | null): void {
    paintRef.current = next;
    setPaint(next);
  }

  /** 进刷子时先从当前选区 capture 格式；已经在刷子里再点就是退出，但双击的第二下是转连续。 */
  function painter(sticky: boolean): void {
    const cur = paintRef.current;
    if (cur) {
      setPainter(sticky && !cur.sticky ? { sticky: true, marks: cur.marks } : null);
      return;
    }
    const ed = quietEditor();
    if (!ed) {
      toast(activeTarget() ? '源码模式下请直接写 Markdown' : '先点一下要编辑的输入框');
      return;
    }
    setPainter({ sticky, marks: captureFormat(ed) });
  }

  /** 选中一条结果：[[ 换成带卡片链接的文字，光标落在后面。 */
  function pickCardLink(hit: { id: string; label: string }): void {
    const rec = cardLink;
    setCardLink(null);
    if (!rec) return;
    const ed = editors.current[rec.field];
    if (!ed) return;
    const from = Math.max(rec.from - 2, 0);
    const href = 'bnki://card/' + hit.id;
    ed
      .chain()
      .focus()
      .setTextSelection({ from, to: rec.from })
      .insertContent({ type: 'text', text: hit.label, marks: [{ type: 'link', attrs: { href } }] })
      .setTextSelection(from + hit.label.length)
      // 链接 mark 会向后延伸，接着打的字不该进链接
      .unsetMark('link')
      .run();
  }

  /** 没选就走：[[ 留着，编辑器重新拿回焦点。 */
  function closeCardLink(): void {
    const rec = cardLink;
    setCardLink(null);
    if (rec) editors.current[rec.field]?.chain().focus().run();
  }

  /** 刷子在身上的时候 Esc、点遮罩只退出刷子，不关编辑器。 */
  function closeOrExitPainter(): void {
    if (paintRef.current) {
      setPainter(null);
      return;
    }
    void saveAndClose();
  }

  function onKey(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && (e.key === 'e' || e.key === 'k')) {
      e.preventDefault();
      const t = activeTarget();
      if (!t) toast('先点一下要编辑的输入框');
      else if (t.kind === 'source') wrapInto(t.field, '{{', '}}');
      else report(toggleCloze(t.ed));
      return;
    }
    if (mod && e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      void done();
      return;
    }
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      nextField();
    }
  }

  const apiObj: EditorApi = {
    cmd: run,
    block: (b) => edit((ed) => applyBlock(ed, b)),
    fontSize: (fs) => edit((ed) => applyFontSize(ed, fs)),
    marker: (attrs) => edit((ed) => applyMarker(ed, attrs)),
    textColor: (tc) => edit((ed) => applyTextColor(ed, tc)),
    clearMarker: () => edit((ed) => clearMarker(ed)),
    link: () => void addLink(),
    formula: openFormula,
    image: () => insertImage(activeRef.current),
    painter,
  };

  const t = activeTarget();
  const on: ActiveMap = t && t.kind === 'wysiwyg' ? activeState(t.ed) : {};

  return (
    <Modal className={'editor-dialog' + (paint ? ' painting' : '')} onClose={closeOrExitPainter} onKeyDown={onKey}>
      <div className="editor-head">
        <button
          className="btn sm"
          onClick={(e) =>
            openMenu(
              e.currentTarget,
              (['note', 'qa', 'topic'] as CardType[]).map((k) => ({ label: CARD_TYPE_NAMES[k], checked: k === st.type, onClick: () => (k === 'topic' ? void switchToTopic() : switchType(k)) })),
            )
          }
        >
          {CARD_TYPE_NAMES[st.type]} ▾
        </button>
        <button
          className="btn sm"
          title="卡片颜色"
          onClick={(e) => openMenu(e.currentTarget, [{ render: () => <Swatches current={st.color} onPick={(c) => { props.setEd((s) => ({ ...s, color: c })); scheduleSave(); }} /> }])}
        >
          <span className="swatch" style={{ background: colorHex(st.color) }} /> 颜色
        </button>
        <span className="hint-text" style={{ marginLeft: 6 }}>
          {target.cardId ? '编辑卡片' : '新建卡片'}
          {!target.cardId && settings.continuousNew ? ' · 连续新建' : ''}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn sm ghost" onClick={() => props.setEd((s) => ({ ...s, help: !s.help }))}>
          Markdown 语法
        </button>
        <button className="icon-btn" title="关闭" onClick={() => void saveAndClose()}>
          ×
        </button>
      </div>
      {st.type !== 'topic' && (
        <Toolbar api={apiObj} on={on} painting={!!paint} paintDisabled={t ? t.kind === 'source' : false} />
      )}
      <div className="editor-scroll">
        {st.help && <MdHelp />}
        {st.type === 'topic' ? (
          <TopicFields
            front={st.md.front}
            back={st.md.back}
            active={active}
            onInput={(f, v) => {
              props.setEd((s) => ({ ...s, md: { ...s.md, [f]: v } }));
              scheduleSave();
            }}
            onFocusField={focusField}
            register={(f, el) => {
              inputs.current[f] = el;
            }}
          />
        ) : (
          fields.map((f) => (
            <Fragment key={`${st.type}-${f}-${st.resetSeq}-${isSource(f) ? 'src' : 'wysi'}`}>
              <RichField
                field={f}
                label={f === 'front' ? (st.type === 'qa' ? '问题' : '内容') : f === 'hint' ? '提示' : '答案'}
                placeholder={
                  f === 'front'
                    ? st.type === 'qa'
                      ? '输入问题，⌘E 挖空，支持 Markdown'
                      : '输入内容。选中文字按 ⌘E 挖空，或直接输入 {{答案}}'
                    : f === 'hint'
                      ? '可填写口诀、速记、关键词或易错提醒，学习时先于答案显示'
                      : '输入答案'
                }
                value={st.md[f]}
                src={!!st.src[f]}
                focused={active === f}
                small={f === 'hint'}
                onInput={fieldInput(f)}
                onDirty={() => {
                  scheduleSave();
                  bump();
                }}
                onFocusField={() => {
                  if (activeRef.current !== f) {
                    activeRef.current = f;
                    setActive(f);
                  }
                }}
                onSelection={bump}
                onToggleSrc={() => toggleSrc(f)}
                onImage={() => insertImage(f)}
                onCardLink={(from) => setCardLink({ field: f, from })}
                register={(ed) => {
                  editors.current[f] = ed;
                }}
                registerText={(el) => {
                  inputs.current[f] = el;
                }}
              />
              {f === 'front' && st.type === 'qa' && !st.showHint && (
                <button className="add-hint" onClick={addHint}>
                  ＋ 提示
                </button>
              )}
            </Fragment>
          ))
        )}
      </div>
      <div className="editor-foot">
        <span className="tip">⌘E 挖空 · ⌥↩ 切换正反面 · ⌘↩ 完成 · Esc 保存并关闭</span>
        <div style={{ flex: 1 }} />
        <span className={'save-state' + (saveState === 'error' ? ' err' : '')}>{SAVE_TEXT[saveState]}</span>
        <button className="btn primary" onClick={() => void done()}>
          完成 ⌘↩
        </button>
      </div>
      {formula && <FormulaDialog onDone={closeFormula} />}
      {cardLink && <CardLinkPicker onPick={pickCardLink} onClose={closeCardLink} />}
    </Modal>
  );

  function fieldInput(f: FieldKey): (v: string) => void {
    return (v) => {
      props.setEd((s) => ({ ...s, md: { ...s.md, [f]: v } }));
      scheduleSave();
    };
  }
}

function MdHelp(): JSX.Element {
  return (
    <div className="md-help">
      <b>挖空</b>：选中文字按 <code>⌘E</code>，或直接输入 <code>{'{{答案}}'}</code>（一行内，可以套加粗等格式）<br />
      <b>标题</b> <code># </code> <code>## </code> <code>### </code> · <b>列表</b> <code>- </code> <code>1. </code>（Tab 缩进） ·{' '}
      <b>引用</b> <code>&gt; </code> · <b>代码块</b> <code>{'```'}</code>
      <br />
      <b>加粗</b> <code>**x**</code> · <b>马克笔</b> <code>==x==</code> · <b>行内代码</b> <code>`x`</code> · <b>公式</b> <code>$x^2$</code>
      <br />
      粘贴 Markdown 文本会自动转成格式；右上角“M↓ 源码”可以直接改 Markdown。
    </div>
  );
}
