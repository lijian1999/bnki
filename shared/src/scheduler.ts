// 复习调度：ts-fsrs + 三种复习模式（design.md §6）。前端用它显示间隔预测，后端用它写入新状态，两边结果一致。
import { createEmptyCard, fsrs, generatorParameters, type Card as FCard, type Grade } from 'ts-fsrs';
import { DAY, HOUR, MIN } from './constants';
import type { CardState, PlanMode, Rating, ResolvedStudyCfg, Settings } from './types';

export interface SchedCfg {
  mode: PlanMode;
  examDate: string | null; // 'YYYY-MM-DD'
  retention: number;
  maxIvl: number;
  dayHour: number;
  steps: number; // 灵活模式的学习、重学步长（分钟）
  fuzz: boolean;
}

export interface ScheduleResult {
  state: CardState;
  requeue: boolean; // 本轮稍后再出现一次
  label: string; // 评分键下方显示的间隔
}

export function schedCfgFor(settings: Settings, study: ResolvedStudyCfg): SchedCfg {
  return {
    mode: study.plan.mode,
    examDate: study.plan.examDate,
    retention: settings.retention,
    maxIvl: settings.maxIvl,
    dayHour: settings.dayHour,
    steps: settings.steps,
    fuzz: settings.fuzz,
  };
}

/** 学习日的开始时刻：dayHour 点换日，凌晨 dayHour 点之前算前一天。 */
export function dayStart(ts: number, dayHour: number): number {
  const d = new Date(ts);
  if (d.getHours() < dayHour) d.setDate(d.getDate() - 1);
  d.setHours(dayHour, 0, 0, 0);
  return d.getTime();
}

/** 考试日那个学习日的开始时刻。 */
function examStart(examDate: string, dayHour: number): number {
  const [y, m, d] = examDate.split('-').map(Number);
  return new Date(y, m - 1, d, dayHour, 0, 0, 0).getTime();
}

/** 冲刺模式过了考试日（或没填日期）就按“按天”处理。 */
export function effectiveMode(cfg: SchedCfg, now: number): PlanMode {
  if (cfg.mode !== 'sprint') return cfg.mode;
  if (!cfg.examDate) return 'daily';
  return examStart(cfg.examDate, cfg.dayHour) > dayStart(now, cfg.dayHour) ? 'sprint' : 'daily';
}

export function newCardState(): CardState {
  return {
    state: 0, due: null, stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0,
    learningSteps: 0, reps: 0, lapses: 0, lastReview: null, mastered: false,
  };
}

export const isNew = (st: CardState | null | undefined): boolean => !st || (st.state === 0 && !st.mastered);

/** 到期判定的截止时刻：灵活模式是现在；按天、冲刺是今天学习日结束（次日 dayHour 点）。 */
export function dueCutoff(cfg: SchedCfg, now: number): number {
  return effectiveMode(cfg, now) === 'flexible' ? now : dayStart(now, cfg.dayHour) + DAY;
}

/** 截止时刻本身属于下一个学习日：按天排到“明天”的卡，due 正好等于今天的截止时刻，不算今天到期。 */
export function isDue(st: CardState | null | undefined, cfg: SchedCfg, now: number): boolean {
  return !!st && !st.mastered && st.state > 0 && st.due != null && st.due < dueCutoff(cfg, now);
}

function toFsrs(st: CardState | null | undefined, now: number): FCard {
  if (!st || st.state === 0) return createEmptyCard(new Date(now));
  return {
    due: new Date(st.due ?? now),
    stability: st.stability,
    difficulty: st.difficulty,
    elapsed_days: st.elapsedDays,
    scheduled_days: st.scheduledDays,
    learning_steps: st.learningSteps,
    reps: st.reps,
    lapses: st.lapses,
    state: st.state,
    last_review: st.lastReview != null ? new Date(st.lastReview) : undefined,
  } as FCard;
}

function fromFsrs(c: FCard): CardState {
  return {
    state: c.state as CardState['state'],
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    lastReview: c.last_review ? c.last_review.getTime() : null,
    mastered: false,
  };
}

function engine(cfg: SchedCfg, mode: PlanMode) {
  const flexible = mode === 'flexible';
  return fsrs(generatorParameters({
    request_retention: cfg.retention,
    maximum_interval: cfg.maxIvl,
    enable_fuzz: cfg.fuzz,
    enable_short_term: flexible,
    learning_steps: flexible ? [`${cfg.steps}m`] : [],
    relearning_steps: flexible ? [`${cfg.steps}m`] : [],
  }));
}

/** 计算一次评分后的新状态。st 为 null 表示从没评过分。 */
export function schedule(st: CardState | null | undefined, rating: Rating, now: number, cfg: SchedCfg): ScheduleResult {
  const mode = effectiveMode(cfg, now);
  const next = engine(cfg, mode).next(toFsrs(st, now), new Date(now), rating as Grade).card;
  const out = fromFsrs(next);
  const today = dayStart(now, cfg.dayHour);
  let byDay = false;
  if (out.state === 2 && out.scheduledDays >= 1) {
    // 以天为单位的间隔：按学习日对齐，冲刺模式再封顶
    let days = Math.round(out.scheduledDays);
    if (mode === 'sprint' && cfg.examDate) {
      const left = (examStart(cfg.examDate, cfg.dayHour) - today) / DAY;
      days = Math.min(days, Math.max(1, Math.floor(left / 3)));
    }
    days = Math.max(1, Math.min(days, cfg.maxIvl));
    out.scheduledDays = days;
    out.due = today + days * DAY;
    byDay = true;
  }
  const requeue = rating === 1;
  let label: string;
  if (byDay) {
    const dd = Math.round((out.due! - today) / DAY);
    label = dd === 1 ? '明天' : intervalLabel(dd * DAY);
  } else {
    label = intervalLabel(out.due! - now);
  }
  if (requeue && mode !== 'flexible') label = '本轮再练·' + label;
  return { state: out, requeue, label };
}

/** 各评分的间隔预测：{1: '本轮再练·明天', 2: '2天', 3: '3天'}。n = 3 或 4（打开“很简单”键时）。 */
export function previews(st: CardState | null | undefined, now: number, cfg: SchedCfg, n: 3 | 4 = 3): Record<number, string> {
  const out: Record<number, string> = {};
  for (let g = 1; g <= n; g++) out[g] = schedule(st, g as Rating, now, cfg).label;
  return out;
}

/** 自定义下次复习时间。新卡先按“记住了”初始化记忆参数，再把 due 改成指定时刻。 */
export function manualDue(st: CardState | null | undefined, due: number, now: number, cfg: SchedCfg): CardState {
  const base = isNew(st) || !st ? schedule(null, 3, now, cfg).state : { ...st };
  base.state = 2;
  base.due = due;
  base.scheduledDays = Math.max(0, Math.round((due - now) / DAY));
  base.mastered = false;
  return base;
}

/** 新卡一直点“记住了”的间隔链（设置页展示用）。 */
export function chainPreview(cfg: SchedCfg, now: number, n = 6): string[] {
  const out: string[] = [];
  let st: CardState | null = null;
  let t = now;
  for (let i = 0; i < n; i++) {
    const r = schedule(st, 3, t, { ...cfg, fuzz: false });
    out.push(r.label);
    st = r.state;
    t = r.state.due!;
  }
  return out;
}

/** 间隔文字：12分钟、3小时、5天、1.2个月、2年。 */
export function intervalLabel(ms: number): string {
  if (ms < HOUR) return Math.max(1, Math.round(ms / MIN)) + '分钟';
  if (ms < DAY * 0.9) return Math.round(ms / HOUR) + '小时';
  const d = Math.round(ms / DAY);
  if (d < 30) return d + '天';
  if (d < 365) return (d / 30).toFixed(d < 60 ? 1 : 0).replace('.0', '') + '个月';
  return (d / 365).toFixed(1).replace('.0', '') + '年';
}

/** 相对时间的长度（不带“前”“后”）：逾期 3天、5分钟。 */
export function relTime(ms: number): string {
  const a = Math.abs(ms);
  if (a < HOUR) return Math.max(1, Math.round(a / MIN)) + '分钟';
  if (a < DAY) return Math.round(a / HOUR) + '小时';
  if (a < 30 * DAY) return Math.round(a / DAY) + '天';
  if (a < 365 * DAY) return (a / 30 / DAY).toFixed(1).replace('.0', '') + '个月';
  return (a / 365 / DAY).toFixed(1).replace('.0', '') + '年';
}
