// SVG 图表：照原型 lineChart / barChart 的画法，viewBox 固定，宽度随容器缩放。
import type { JSX } from 'react';

const W = 520;

/** 折线图：横轴文字由 labels 给出，series 与 colors 一一对应。 */
export function LineChart(props: { labels: string[]; series: number[][]; colors: string[] }): JSX.Element {
  const { labels, series, colors } = props;
  const H = 170, L = 30, B = 22, T = 8;
  const n = labels.length;
  const max = Math.max(5, ...series.flat());
  const x = (i: number): number => L + (i * (W - L - 8)) / Math.max(1, n - 1);
  const y = (v: number): number => T + (H - T - B) * (1 - v / max);

  const grid: JSX.Element[] = [];
  for (let k = 0; k <= 4; k++) {
    const v = Math.round((max * k) / 4);
    grid.push(<line key={`g${k}`} x1={L} x2={W - 4} y1={y(v)} y2={y(v)} stroke="var(--line)" />);
    grid.push(
      <text key={`t${k}`} x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="var(--text-3)">
        {v}
      </text>,
    );
  }

  const every = Math.ceil(n / 7);
  const xs = labels.map((lb, i) =>
    lb && (i % every === 0 || i === n - 1) ? (
      <text key={`x${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--text-3)">
        {lb}
      </text>
    ) : null,
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%">
      {grid}
      {xs}
      {series.map((s, si) => (
        <g key={si}>
          <polyline
            fill="none"
            stroke={colors[si]}
            strokeWidth={2}
            strokeLinejoin="round"
            points={s.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
          />
          {n <= 31 &&
            s.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={colors[si]}>
                <title>{v}</title>
              </circle>
            ))}
        </g>
      ))}
    </svg>
  );
}

/** 柱状图：第 0 根橙色（今天），其余蓝色；labels 非空的那几根下面标字。 */
export function BarChart(props: { values: number[]; labels: string[] }): JSX.Element {
  const { values, labels } = props;
  const H = 120, B = 18;
  const max = Math.max(3, ...values);
  const bw = (W - 10) / Math.max(1, values.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%">
      {values.map((v, i) => {
        const h = ((H - B - 6) * v) / max;
        return (
          <g key={i}>
            <rect
              x={5 + i * bw + 2}
              y={H - B - h}
              width={bw - 4}
              height={h}
              rx={2}
              fill={i === 0 ? 'var(--orange)' : 'var(--accent)'}
              opacity={i === 0 ? 1 : 0.7}
            >
              <title>{`${i === 0 ? '今天' : i + '天后'}：${v} 张`}</title>
            </rect>
            {labels[i] && (
              <text x={5 + i * bw + bw / 2} y={H - 4} textAnchor="middle" fontSize={10} fill="var(--text-3)">
                {labels[i]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
