/* bnki 原型：FSRS-5 调度（简化实现，只为在原型里显示真实的间隔）。
 * 正式实现用 ts-fsrs。评分：1 忘记了 / 2 模糊 / 3 记住了 / 4 很简单（可选）。
 */
(function () {
  const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
    1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
  const DECAY = -0.5, FACTOR = 19 / 81;
  const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  const retrievability = (t, S) => Math.pow(1 + FACTOR * t / S, DECAY);
  const intervalDays = (S, r) => (S / FACTOR) * (Math.pow(r, 1 / DECAY) - 1);
  const initD = (g) => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);
  const initS = (g) => W[g - 1];
  function nextD(D, g) {
    const d1 = D + (-W[6] * (g - 3)) * (10 - D) / 9;
    return clamp(W[7] * initD(4) + (1 - W[7]) * d1, 1, 10);
  }
  function recallS(D, S, R, g) {
    const hard = g === 2 ? W[15] : 1, easy = g === 4 ? W[16] : 1;
    return S * (Math.exp(W[8]) * (11 - D) * Math.pow(S, -W[9]) * (Math.exp(W[10] * (1 - R)) - 1) * hard * easy + 1);
  }
  function forgetS(D, S, R) {
    return Math.min(S, W[11] * Math.pow(D, -W[12]) * (Math.pow(S + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R)));
  }
  const shortS = (S, g) => S * Math.exp(W[17] * (g - 3 + W[18]));

  // 学习日：默认 04:00 换日
  function dayStart(ts, hour) {
    const d = new Date(ts);
    if (d.getHours() < hour) d.setDate(d.getDate() - 1);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  }

  /**
   * 计算一次评分后的新状态。
   * cfg: { mode: 'daily'|'flexible'|'sprint', retention, maxIvl, examDate, dayHour, steps(min) }
   * 返回 { state, due, ivlLabel, requeue }
   */
  function schedule(st, g, now, cfg) {
    const s = Object.assign({ state: 0, reps: 0, lapses: 0 }, st);
    const r = cfg.retention || 0.9;
    const dayHour = cfg.dayHour ?? 4;
    const stepMin = cfg.steps || 10;
    let requeue = false, dueMs;

    const daysToDue = (S) => {
      let d = Math.max(1, Math.round(intervalDays(S, r)));
      d = Math.min(d, cfg.maxIvl || 365);
      if (cfg.mode === 'sprint' && cfg.examDate) {
        const left = (new Date(cfg.examDate).getTime() - now) / DAY;
        if (left > 0) d = Math.min(d, Math.max(1, Math.floor(left / 3)));
      }
      return d;
    };
    const atDay = (d) => dayStart(now, dayHour) + d * DAY;

    if (s.state === 0) {
      s.D = initD(g); s.S = initS(g);
      if (cfg.mode === 'flexible' && g <= 2) {
        s.state = 1; dueMs = now + stepMin * MIN; requeue = g === 1;
      } else {
        s.state = 2; dueMs = atDay(daysToDue(s.S)); requeue = g === 1;
      }
    } else if (s.state === 1 || s.state === 3) {
      s.S = shortS(s.S, g); s.D = nextD(s.D, g);
      if (g === 1) { dueMs = now + (cfg.mode === 'flexible' ? stepMin * MIN : DAY); requeue = true; }
      else { s.state = 2; dueMs = atDay(daysToDue(s.S)); }
    } else {
      const t = Math.max(0, (now - (s.last || now)) / DAY);
      const R = retrievability(t, s.S);
      s.D = nextD(s.D, g);
      if (g === 1) {
        s.S = forgetS(s.D, s.S, R); s.lapses++;
        requeue = true;
        if (cfg.mode === 'flexible') { s.state = 3; dueMs = now + stepMin * MIN; }
        else dueMs = atDay(daysToDue(s.S));
      } else {
        s.S = recallS(s.D, s.S, R, g); dueMs = atDay(daysToDue(s.S));
      }
    }
    s.reps++; s.last = now; s.due = dueMs;
    // 按天安排的，显示“第几个学习日”，避免下午评分时 3 天显示成 2 天
    const byDay = dayStart(dueMs, dayHour) === dueMs;
    const dayDiff = Math.round((dueMs - dayStart(now, dayHour)) / DAY);
    let text = byDay ? (dayDiff === 1 ? '明天' : label(dayDiff * DAY)) : label(dueMs - now);
    if (requeue && cfg.mode !== 'flexible') text = '本轮再练·' + text;
    return { state: s, due: dueMs, requeue, label: text };
  }

  function label(ms) {
    let t;
    if (ms < HOUR) t = Math.max(1, Math.round(ms / MIN)) + '分钟';
    else if (ms < DAY * 0.9) t = Math.round(ms / HOUR) + '小时';
    else {
      const d = Math.round(ms / DAY);
      if (d < 30) t = d + '天';
      else if (d < 365) t = (d / 30).toFixed(d < 60 ? 1 : 0).replace('.0', '') + '个月';
      else t = (d / 365).toFixed(1).replace('.0', '') + '年';
    }
    return t;
  }

  function previews(st, now, cfg, n) {
    const out = {};
    for (let g = 1; g <= (n || 3); g++) out[g] = schedule(st, g, now, cfg).label;
    return out;
  }

  function relTime(ms) {
    const a = Math.abs(ms);
    if (a < HOUR) return Math.max(1, Math.round(a / MIN)) + '分钟';
    if (a < DAY) return Math.round(a / HOUR) + '小时';
    if (a < 30 * DAY) return Math.round(a / DAY) + '天';
    if (a < 365 * DAY) return (a / 30 / DAY).toFixed(1).replace('.0', '') + '个月';
    return (a / 365 / DAY).toFixed(1).replace('.0', '') + '年';
  }

  window.FSRS = { schedule, previews, relTime, dayStart, retrievability, DAY, HOUR, MIN };
})();
