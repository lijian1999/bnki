// 统计页：照原型 statsHTML / bindStats，数据来自 GET /api/stats。
import { useState } from 'react';
import type { JSX } from 'react';
import { useStats, type Stats } from '../queries';
import { BarChart, LineChart } from '../charts';
import { fmtDate } from '../format';
import '../styles/pages.css';

/** 'YYYY-MM-DD' → 本地日期分量（不按时区解析，避免跨天偏移）。 */
function dayParts(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const key = (y: number, m: number, d: number): string => `${y}-${pad(m + 1)}-${pad(d)}`;
const md = (p: { y: number; m: number; d: number }, sep: string): string => `${p.m + 1}${sep}${p.d}`;

function Calendar({ calendar }: { calendar: Record<string, number> }): JSX.Element {
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  const last = new Date(y, mo + 1, 0).getDate();
  const lead = (new Date(y, mo, 1).getDay() + 6) % 7; // 周一开头
  const cells: JSX.Element[] = [];
  for (let i = 1; i <= last; i++) {
    const n = calendar[key(y, mo, i)] || 0;
    const lv = n ? (n > 30 ? ' l3' : n > 12 ? ' l2' : ' l1') : '';
    const today = i === now.getDate() ? ' today' : '';
    cells.push(
      <div key={i} className={`d${lv}${today}`} title={`${n} 次`}>
        {i}
      </div>,
    );
  }
  return (
    <>
      <div style={{ marginTop: 12, fontWeight: 500 }}>
        {y}年{mo + 1}月
      </div>
      <div className="cal">
        {'一二三四五六日'.split('').map((w) => (
          <div key={w} className="wd">
            {w}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`b${i}`} />
        ))}
        {cells}
      </div>
    </>
  );
}

function StreakPanel({ s }: { s: Stats }): JSX.Element {
  const pct = Math.min(1, s.streak / 30);
  const start = s.best.start ? dayParts(s.best.start) : null;
  const end = s.best.end ? dayParts(s.best.end) : null;
  return (
    <div className="panel">
      <h3>学习日历</h3>
      <div className="streak">
        <svg className="ring" viewBox="0 0 100 100">
          <circle cx={50} cy={50} r={42} fill="none" stroke="var(--line)" strokeWidth={9} />
          <circle
            cx={50}
            cy={50}
            r={42}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={9}
            strokeLinecap="round"
            strokeDasharray={`${(264 * pct).toFixed(1)} 264`}
            transform="rotate(-90 50 50)"
          />
          <text x={50} y={49} textAnchor="middle" fontSize={22} fontWeight={700} fill="var(--text)">
            {s.streak}
          </text>
          <text x={50} y={67} textAnchor="middle" fontSize={11} fill="var(--text-2)">
            天连续
          </text>
        </svg>
        <div style={{ fontSize: 13, lineHeight: 2 }}>
          <div>
            最长连续学习 <b>{s.best.days}</b> 天{start && end ? <span className="hint-text"> {fmtDate(new Date(start.y, start.m, start.d).getTime())} – {fmtDate(new Date(end.y, end.m, end.d).getTime())}</span> : ''}
          </div>
          <div>
            本月已学习 <b>{s.monthDays}</b> 天
          </div>
        </div>
      </div>
      <Calendar calendar={s.calendar} />
    </div>
  );
}

export default function StatsPage() {
  const [range, setRange] = useState(7);
  const { data: s } = useStats(range);

  if (!s) return <div className="page" />;
  const labels = s.series.map((p) => {
    const p1 = dayParts(p.date);
    return p1 ? md(p1, '/') : '';
  });
  const fc = s.forecast.map((f) => f.count);
  const fcLabels = s.forecast.map((_, i) => (i % 5 === 0 ? (i === 0 ? '今天' : `+${i}`) : ''));

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">我的统计</h1>
      </div>
      <div className="stat-grid">
        <StreakPanel s={s} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <h3>数据</h3>
            <div className="kpis">
              <div className="kpi">
                <b>{s.today}</b>
                <span>今日学习卡片</span>
              </div>
              <div className="kpi">
                <b>{s.total}</b>
                <span>累计学习卡片</span>
              </div>
              <div className="kpi">
                <b>{s.deckCount}</b>
                <span>我的卡片集</span>
              </div>
              <div className="kpi">
                <b>{s.cardCount}</b>
                <span>我的卡片总数</span>
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="row-between" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>学习与编辑曲线</h3>
              <div className="seg">
                {[7, 30, 90].map((n) => (
                  <button key={n} className={range === n ? 'on' : ''} onClick={() => setRange(n)}>
                    {n}天
                  </button>
                ))}
              </div>
            </div>
            <div className="legend">
              <span>
                <i style={{ background: 'var(--accent)' }} />
                学习（评分次数）
              </span>
              <span>
                <i style={{ background: 'var(--orange)' }} />
                编辑（新建 / 修改卡片）
              </span>
            </div>
            <LineChart labels={labels} series={[s.series.map((p) => p.reviews), s.series.map((p) => p.edits)]} colors={['var(--accent)', 'var(--orange)']} />
          </div>
          <div className="panel">
            <h3>未来 30 天到期</h3>
            <BarChart values={fc} labels={fcLabels} />
          </div>
          <div className="panel">
            <h3>真实记忆保持率</h3>
            {s.retention.actual !== null ? (
              <>
                <div className="big-num">{Math.round(s.retention.actual * 100)}%</div>
                <div className="hint-text">
                  近 30 天 {s.retention.samples} 次复习，目标 {Math.round(s.retention.target * 100)}%
                </div>
              </>
            ) : (
              <div className="hint-text">近 30 天还没有复习记录</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
