import { describe, expect, it } from 'vitest';
import { DAY, MIN } from './constants';
import { chainPreview, dayStart, dueCutoff, isDue, isNew, manualDue, previews, schedule, type SchedCfg } from './scheduler';

const base: SchedCfg = { mode: 'daily', examDate: null, retention: 0.9, maxIvl: 365, dayHour: 4, steps: 10, fuzz: false };
const now = new Date(2026, 9, 22, 15, 30).getTime(); // 本地时间 2026-10-22 15:30
const today = new Date(2026, 9, 22, 4, 0).getTime();

describe('dayStart', () => {
  it('凌晨换日之前算前一天', () => {
    expect(dayStart(new Date(2026, 9, 22, 3, 59).getTime(), 4)).toBe(new Date(2026, 9, 21, 4).getTime());
    expect(dayStart(now, 4)).toBe(today);
    expect(dayStart(now, 0)).toBe(new Date(2026, 9, 22).getTime());
  });
});

describe('按天模式', () => {
  it('新卡：评分后最早明天，due 对齐学习日', () => {
    for (const g of [1, 2, 3, 4] as const) {
      const r = schedule(null, g, now, base);
      expect(r.state.state).toBe(2);
      expect(r.state.due! - today).toBeGreaterThanOrEqual(DAY);
      expect((r.state.due! - today) % DAY).toBe(0);
    }
    expect(schedule(null, 1, now, base).label).toBe('本轮再练·明天');
    expect(schedule(null, 1, now, base).requeue).toBe(true);
    expect(schedule(null, 3, now, base).requeue).toBe(false);
    expect(schedule(null, 3, now, base).label).toBe('3天');
  });
  it('记住了给的间隔随稳定性增长', () => {
    const first = schedule(null, 3, now, base).state;
    const second = schedule(first, 3, first.due!, base).state;
    expect(second.scheduledDays).toBeGreaterThan(first.scheduledDays);
    expect(second.reps).toBe(2);
  });
  it('逾期很久的卡记住了，间隔更长', () => {
    const first = schedule(null, 3, now, base).state;
    const onTime = schedule(first, 3, first.due!, base).state.scheduledDays;
    const late = schedule(first, 3, first.due! + 60 * DAY, base).state.scheduledDays;
    expect(late).toBeGreaterThan(onTime);
  });
  it('最大间隔封顶', () => {
    let st = schedule(null, 4, now, { ...base, maxIvl: 10 }).state;
    st = schedule(st, 4, st.due!, { ...base, maxIvl: 10 }).state;
    expect(st.scheduledDays).toBeLessThanOrEqual(10);
  });
});

describe('灵活模式', () => {
  const flex = { ...base, mode: 'flexible' as const };
  it('新卡忘记了：步长分钟后再出现', () => {
    const r = schedule(null, 1, now, flex);
    expect(r.state.state).toBe(1);
    expect(r.state.due).toBe(now + 10 * MIN);
    expect(r.label).toBe('10分钟');
    expect(r.requeue).toBe(true);
  });
  it('新卡记住了：直接毕业', () => {
    const r = schedule(null, 3, now, flex);
    expect(r.state.state).toBe(2);
    expect(r.state.scheduledDays).toBeGreaterThanOrEqual(1);
  });
  it('到期截止是现在', () => {
    expect(dueCutoff(flex, now)).toBe(now);
    expect(dueCutoff(base, now)).toBe(today + DAY);
  });
});

describe('冲刺模式', () => {
  it('间隔不超过距考试天数 / 3', () => {
    const sprint = { ...base, mode: 'sprint' as const, examDate: '2026-10-31' }; // 距考试 9 天
    let st = schedule(null, 4, now, sprint).state;
    expect(st.scheduledDays).toBeLessThanOrEqual(3);
    st = schedule(st, 4, st.due!, sprint).state;
    expect(st.scheduledDays).toBeLessThanOrEqual(3);
  });
  it('过了考试日按“按天”处理', () => {
    const past = { ...base, mode: 'sprint' as const, examDate: '2026-10-01' };
    expect(schedule(null, 4, now, past).state.scheduledDays).toBe(schedule(null, 4, now, base).state.scheduledDays);
  });
});

describe('其他', () => {
  it('isNew / isDue', () => {
    expect(isNew(null)).toBe(true);
    const st = schedule(null, 3, now, base).state;
    expect(isNew(st)).toBe(false);
    expect(isDue(st, base, now)).toBe(false);
    expect(isDue(st, base, st.due! - 1000)).toBe(true); // 当天学习日内到期就算
    expect(isDue({ ...st, mastered: true }, base, st.due!)).toBe(false);
  });
  it('previews 与 schedule 一致', () => {
    const p = previews(null, now, base);
    expect(p[3]).toBe(schedule(null, 3, now, base).label);
    expect(Object.keys(previews(null, now, base, 4))).toHaveLength(4);
  });
  it('manualDue 新卡变成复习卡', () => {
    const st = manualDue(null, now + 7 * DAY, now, base);
    expect(st.state).toBe(2);
    expect(st.due).toBe(now + 7 * DAY);
    expect(st.stability).toBeGreaterThan(0);
  });
  it('chainPreview 递增', () => {
    const c = chainPreview(base, now);
    expect(c).toHaveLength(6);
    expect(c[0]).toBe('3天');
  });
});
