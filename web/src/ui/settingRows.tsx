// 设置行和分段按钮：设置页和朗读偏好弹窗共用。
import type { JSX, ReactNode } from 'react';
import '../styles/pages.css';

export function Row(props: { title: ReactNode; desc?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="set-row">
      <div className="l">
        <b>{props.title}</b>
        {props.desc && <span>{props.desc}</span>}
      </div>
      {props.children}
    </div>
  );
}

export function Seg<T extends string | number>(props: { value: T; options: [T, string][]; onPick: (v: T) => void }): JSX.Element {
  return (
    <div className="seg">
      {props.options.map(([v, label]) => (
        <button key={String(v)} className={String(props.value) === String(v) ? 'on' : ''} onClick={() => props.onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
