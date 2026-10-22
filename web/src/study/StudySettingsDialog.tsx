// 学习设置对话框：一个卡片集的学习偏好（存 decks.study_cfg），结构照原型 studySettingsDialog / planEditorHTML。
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CARD_COLORS, resolveStudyCfg,
  type CardColor, type ID, type PlanMode, type ResolvedStudyCfg, type SectionItem,
  type StudyCfg, type StudyContent, type StudyDirection, type StudyOrder,
} from '@bnki/shared';
import { api } from '../api';
import { invalidateDeck, useDeck, useItems, useSettings } from '../queries';
import { useUI } from '../store';
import { DialogHead, Modal } from '../ui/Modal';
import { toast } from '../ui/toast';
import { errText } from './util';
import '../styles/study.css';
import type { JSX } from 'react';

export interface DeckDialogProps {
  deckId: string;
  onClose: () => void;
}

interface Plan {
  mode: PlanMode;
  examDate: string | null;
  newPerDay: number;
  reviewPerDay: number;
}

interface Draft {
  content: StudyContent;
  colors: CardColor[];
  sections: ID[];
  order: StudyOrder;
  direction: StudyDirection;
  clickBlankRevealNext: boolean;
  plan: Plan;
}

const CONTENTS: [StudyContent, string][] = [
  ['recommend', '系统推荐'],
  ['new', '仅未学习'],
  ['review', '仅复习'],
  ['all', '全部卡片'],
];
const CONTENT_HINT: Record<StudyContent, string> = {
  recommend: '先复习到期卡片，再学新卡，受每日上限约束',
  new: '只学没学过的卡片',
  review: '只复习到期的卡片',
  all: '按顺序浏览全部卡片，也可以评分',
};
const ORDERS: [StudyOrder, string][] = [
  ['sequential', '按顺序'],
  ['due_first', '到期优先'],
  ['random', '随机'],
];
const DIRECTIONS: [StudyDirection, string][] = [
  ['front', '问题优先'],
  ['back', '答案优先'],
  ['random', '随机'],
];
const MODE_NAMES: Record<PlanMode, string> = { daily: '按天模式', flexible: '灵活模式', sprint: '冲刺模式' };

/** 草稿从 resolveStudyCfg 的结果起步，界面上看到的就是当前实际生效的值。 */
function draftFrom(c: ResolvedStudyCfg): Draft {
  return {
    content: c.content,
    colors: [...c.colors],
    sections: [...c.sections],
    order: c.order,
    direction: c.direction,
    clickBlankRevealNext: c.clickBlankRevealNext,
    plan: { ...c.plan },
  };
}

export default function StudySettingsDialog(props: DeckDialogProps): JSX.Element | null {
  const qc = useQueryClient();
  const { data: deck } = useDeck(props.deckId);
  const { data: settings } = useSettings();
  const { data: items } = useItems(props.deckId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [planOpen, setPlanOpen] = useState(false);

  useEffect(() => {
    if (!draft && deck && settings) setDraft(draftFrom(resolveStudyCfg(deck.studyCfg, settings)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, deck, settings]);

  if (!draft || !deck || !settings) return null;
  const sections = (items ?? []).filter((i): i is SectionItem => i.kind === 'section');
  const plan = draft.plan;
  const steps = settings.steps;
  const retention = settings.retention;

  const toggleColor = (k: CardColor): void => {
    setDraft((d) => (d ? { ...d, colors: d.colors.includes(k) ? d.colors.filter((x) => x !== k) : [...d.colors, k] } : d));
  };
  const toggleSection = (k: ID): void => {
    setDraft((d) => (d ? { ...d, sections: d.sections.includes(k) ? d.sections.filter((x) => x !== k) : [...d.sections, k] } : d));
  };
  const seg = <K extends string>(key: 'content' | 'order' | 'direction', opts: [K, string][]): JSX.Element => (
    <div className="seg">
      {opts.map(([k, l]) => (
        <button key={k} className={draft[key] === k ? 'on' : ''} onClick={() => setDraft((d) => (d ? { ...d, [key]: k } : d))}>
          {l}
        </button>
      ))}
    </div>
  );

  const save = (start: boolean): void => {
    const studyCfg: StudyCfg = {
      ...deck.studyCfg,
      content: draft.content,
      colors: draft.colors,
      sections: draft.sections,
      order: draft.order,
      direction: draft.direction,
      clickBlankRevealNext: draft.clickBlankRevealNext,
      plan: { ...plan },
    };
    void api.decks
      .update(props.deckId, { studyCfg })
      .then(() => {
        invalidateDeck(qc, props.deckId);
        props.onClose();
        if (start) {
          if (useUI.getState().study) useUI.getState().closeStudy();
          useUI.getState().openStudy({ deckId: props.deckId });
        }
      })
      .catch((e: unknown) => toast(errText(e)));
  };

  const numInput = (value: number, onChange: (n: number) => void): JSX.Element => (
    <input
      type="number"
      className="num-input"
      min={0}
      value={String(value)}
      onChange={(e) => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
    />
  );

  return (
    <Modal light className="study-settings" onClose={props.onClose}>
      <DialogHead title="开始学习 · 学习设置" onClose={props.onClose} />
      <div className="dialog-body">
        <div className="form-row">
          <label>学习内容</label>
          {seg('content', CONTENTS)}
          <div className="hint-text">{CONTENT_HINT[draft.content]}</div>
        </div>
        <div className="form-row">
          <label>卡片颜色（不选 = 全部颜色）</label>
          <div className="opt-list">
            {CARD_COLORS.map((c) => (
              <span key={c.key} className={'opt' + (draft.colors.includes(c.key) ? ' on' : '')} onClick={() => toggleColor(c.key)}>
                <span className="swatch" style={{ background: c.hex }} /> {c.name}
              </span>
            ))}
          </div>
        </div>
        <div className="form-row">
          <label>学习目录（不选 = 全部目录）</label>
          <div className="opt-list">
            {sections.length ? (
              sections.map((s) => (
                <span key={s.id} className={'opt' + (draft.sections.includes(s.id) ? ' on' : '')} onClick={() => toggleSection(s.id)}>
                  {'　'.repeat(s.level - 1)}
                  {s.title}
                </span>
              ))
            ) : (
              <span className="hint-text">这个卡片集还没有目录</span>
            )}
          </div>
        </div>
        <div className="form-row">
          <label>卡片顺序</label>
          {seg('order', ORDERS)}
        </div>
        <div className="form-row">
          <label>出题方向（问答卡）</label>
          {seg('direction', DIRECTIONS)}
        </div>
        <div className="form-row row-between">
          <span>点击卡片空白处，显示下一个挖空</span>
          <button
            className={'switch' + (draft.clickBlankRevealNext ? ' on' : '')}
            onClick={() => setDraft((d) => (d ? { ...d, clickBlankRevealNext: !d.clickBlankRevealNext } : d))}
          />
        </div>
        <div className="form-row" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div className="row-between" style={{ cursor: 'pointer' }} onClick={() => setPlanOpen((v) => !v)}>
            <span>
              <b style={{ fontWeight: 500 }}>复习计划与每日上限</b>
              <br />
              <span className="hint-text">
                {MODE_NAMES[plan.mode]} · 每日新学 {plan.newPerDay} · 每日复习 {plan.reviewPerDay}
              </span>
            </span>
            <span>{planOpen ? '▾' : '›'}</span>
          </div>
          {planOpen ? (
            <div style={{ marginTop: 10 }}>
              {([
                ['daily', '按天模式（默认）', '不安排当天的短间隔。新卡评分后最早明天再见，到期卡片按“学习日”（04:00 换日）一次出完'],
                ['flexible', '灵活模式', `开启当天短间隔：新卡评“忘记了 / 模糊”、复习卡评“忘记了”时，${steps} 分钟后再出现；评“记住了”直接按天安排`],
                ['sprint', '冲刺模式', '设置考试日期，每次间隔不超过“距考试天数 / 3”，保证考前多看几遍；考后自动回到按天模式'],
              ] as [PlanMode, string, string][]).map(([k, t, desc]) => (
                <div
                  key={k}
                  className={'mode-card' + (plan.mode === k ? ' on' : '')}
                  onClick={() => setDraft((d) => (d ? { ...d, plan: { ...d.plan, mode: k } } : d))}
                >
                  <b>{t}</b>
                  <span>{desc}</span>
                </div>
              ))}
              {plan.mode === 'sprint' ? (
                <div className="form-row">
                  <label>考试日期</label>
                  <input
                    type="date"
                    className="text-input"
                    style={{ width: 180 }}
                    value={plan.examDate ?? ''}
                    onChange={(e) => setDraft((d) => (d ? { ...d, plan: { ...d.plan, examDate: e.target.value || null } } : d))}
                  />
                </div>
              ) : null}
              <div className="form-row" style={{ display: 'flex', gap: 24 }}>
                <span>
                  每日新学 {numInput(plan.newPerDay, (n) => setDraft((d) => (d ? { ...d, plan: { ...d.plan, newPerDay: n } } : d)))} 张
                </span>
                <span>
                  每日复习 {numInput(plan.reviewPerDay, (n) => setDraft((d) => (d ? { ...d, plan: { ...d.plan, reviewPerDay: n } } : d)))} 张
                </span>
              </div>
              <div className="hint-text">间隔由 FSRS 计算（目标记忆保持率 {retention}，可在系统设置里改）</div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={() => save(false)}>仅保存</button>
        <button className="btn primary" onClick={() => save(true)}>开始学习</button>
      </div>
    </Modal>
  );
}
