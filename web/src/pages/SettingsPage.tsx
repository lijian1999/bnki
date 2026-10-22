// 系统设置页：照原型 settingsHTML，数据来自 GET/PUT /api/settings，改动即时保存。
import { useEffect, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  chainPreview,
  resolveStudyCfg,
  schedCfgFor,
  type FontSize,
  type PlanMode,
  type Settings,
  type Theme,
} from '@bnki/shared';
import { api } from '../api';
import { useBackups, useSaveSettings, useSettings } from '../queries';
import { Modal, DialogHead } from '../ui/Modal';
import { confirmDialog } from '../ui/dialogs';
import { toast } from '../ui/toast';
import { fmtMDHM } from '../format';
import '../styles/pages.css';

function errText(e: unknown): string {
  return typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' && e.message ? e.message : '操作失败';
}

function Row(props: { title: ReactNode; desc?: ReactNode; children: ReactNode }): JSX.Element {
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

/** 分段选择；值用字符串比较，数字型也能对上。 */
function Seg<T extends string | number>(props: { value: T; options: [T, string][]; onPick: (v: T) => void }): JSX.Element {
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

function Switch(props: { on: boolean; onToggle: () => void }): JSX.Element {
  return <button className={'switch' + (props.on ? ' on' : '')} onClick={props.onToggle} />;
}

/** 数字输入：失焦或回车时保存，最小 1。 */
function NumInput(props: { value: number; onCommit: (v: number) => void }): JSX.Element {
  const [txt, setTxt] = useState(String(props.value));
  useEffect(() => {
    setTxt(String(props.value));
  }, [props.value]);
  const commit = (): void => props.onCommit(Math.max(1, parseInt(txt, 10) || 1));
  return (
    <input
      type="number"
      className="num-input"
      value={txt}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function backupSize(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

/** 从备份恢复：列表 + 二次确认，确认后整库覆盖并刷新所有数据。 */
function RestoreDialog(props: { onClose: () => void }): JSX.Element {
  const qc = useQueryClient();
  const { data: backups = [], isFetching } = useBackups();
  const [busy, setBusy] = useState(false);

  const pick = async (name: string): Promise<void> => {
    const ok = await confirmDialog('从备份恢复', `当前数据会先自动备份一次，然后用「${name}」覆盖。`, '恢复', true);
    if (!ok || busy) return;
    setBusy(true);
    try {
      await api.backups.restore(name);
      props.onClose();
      void qc.invalidateQueries();
      toast('已恢复');
    } catch (e) {
      setBusy(false);
      toast(errText(e));
    }
  };

  return (
    <Modal light onClose={props.onClose}>
      <DialogHead title="从备份恢复" onClose={props.onClose} />
      <div className="dialog-body">
        {backups.length ? (
          backups.map((b) => (
            <div className="backup-row" key={b.name}>
              <div className="l">
                <b>{b.name}</b>
                <span>
                  {fmtMDHM(b.createdAt)} · {backupSize(b.size)}
                </span>
              </div>
              <button className="btn sm" disabled={busy} onClick={() => void pick(b.name)}>
                恢复
              </button>
            </div>
          ))
        ) : (
          <div className="hint-text">{isFetching ? '' : '还没有备份'}</div>
        )}
      </div>
    </Modal>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const [ret, setRet] = useState<number | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  if (!settings) return <div className="page settings-wrap" />;
  const live = ret === null ? settings : { ...settings, retention: ret };
  const preview = chainPreview(schedCfgFor(live, resolveStudyCfg(null, live)), Date.now()).join(' → ');

  const save = (patch: Partial<Settings>): void => void saveSettings(patch).catch(() => {});
  const backupNow = async (): Promise<void> => {
    try {
      const r = await api.backups.create();
      toast(`已备份：${r.name}`);
      void qc.invalidateQueries({ queryKey: ['backups'] });
    } catch (e) {
      toast(errText(e));
    }
  };

  return (
    <div className="page settings-wrap">
      <div className="page-head">
        <h1 className="page-title">系统设置</h1>
      </div>

      <div className="set-group">
        <h3>学习偏好</h3>
        <Row title="默认复习模式" desc="新卡片集默认使用；每个卡片集可以在学习设置里单独改">
          <Seg
            value={settings.defaultMode}
            options={[['daily', '按天'], ['flexible', '灵活']]}
            onPick={(v: PlanMode) => save({ defaultMode: v })}
          />
        </Row>
        <Row title="每日新学上限">
          <NumInput value={settings.newPerDay} onCommit={(v) => save({ newPerDay: v })} />
        </Row>
        <Row title="每日复习上限">
          <NumInput value={settings.reviewPerDay} onCommit={(v) => save({ reviewPerDay: v })} />
        </Row>
        <Row title="点击卡片空白处，显示下一个挖空">
          <Switch on={settings.clickBlankRevealNext} onToggle={() => save({ clickBlankRevealNext: !settings.clickBlankRevealNext })} />
        </Row>
        <Row title="卡片文字大小" desc="学习时卡片的默认字号">
          <Seg
            value={settings.fontSize}
            options={[['small', '小'], ['default', '默认'], ['large', '大'], ['xlarge', '特大']]}
            onPick={(v: FontSize) => save({ fontSize: v })}
          />
        </Row>
      </div>

      <div className="set-group">
        <h3>记忆算法（FSRS）</h3>
        <Row
          title={
            <>
              目标记忆保持率　<span style={{ color: 'var(--accent)' }}>{Math.round((ret ?? settings.retention) * 100)}%</span>
            </>
          }
          desc="复习时预计能想起来的概率。越高复习越频繁；0.90 是 Anki 推荐值"
        >
          <input
            className="range-input"
            type="range"
            min="0.80"
            max="0.97"
            step="0.01"
            value={ret ?? settings.retention}
            onChange={(e) => setRet(Number(e.target.value))}
            onPointerUp={() => {
              if (ret !== null) {
                save({ retention: ret });
                setRet(null);
              }
            }}
            onBlur={() => {
              if (ret !== null) {
                save({ retention: ret });
                setRet(null);
              }
            }}
          />
        </Row>
        <div className="set-row" style={{ borderTop: 0, paddingTop: 0 }}>
          <span className="hint-text">
            新卡一直点“记住了”时的间隔：<b style={{ color: 'var(--text)' }}>{preview}</b>
          </span>
        </div>
        <Row title="最大间隔" desc="天">
          <NumInput value={settings.maxIvl} onCommit={(v) => save({ maxIvl: v })} />
        </Row>
        <Row title="灵活模式的短间隔" desc="只在灵活模式下生效">
          <Seg value={settings.steps} options={[[1, '1分钟'], [5, '5分钟'], [10, '10分钟'], [30, '30分钟']]} onPick={(v) => save({ steps: v })} />
        </Row>
        <Row title="新的一天开始于" desc="凌晨学到很晚也算前一天">
          <Seg value={settings.dayHour} options={[[0, '0:00'], [2, '2:00'], [4, '4:00'], [6, '6:00']]} onPick={(v) => save({ dayHour: v })} />
        </Row>
        <Row title="间隔随机抖动" desc="避免同一天到期的卡片扎堆">
          <Switch on={settings.fuzz} onToggle={() => save({ fuzz: !settings.fuzz })} />
        </Row>
        <Row title="显示第 4 个评分键“很简单”" desc="对应 FSRS 的 Easy，间隔更长">
          <Switch on={settings.easyButton} onToggle={() => save({ easyButton: !settings.easyButton })} />
        </Row>
        <Row title="“本轮再练”不改变记忆状态" desc="忘记后本轮再出现时，评分只算练习，不重复惩罚">
          <Switch on={settings.requeueNoReschedule} onToggle={() => save({ requeueNoReschedule: !settings.requeueNoReschedule })} />
        </Row>
      </div>

      <div className="set-group">
        <h3>朗读偏好</h3>
        <Row title="语速">
          <Seg
            value={settings.ttsRate}
            options={[[0.8, '0.8'], [1, '1.0'], [1.2, '1.2']]}
            onPick={(v) => save({ ttsRate: v })}
          />
        </Row>
        <Row title="语言">
          <select
            className="select-input"
            value={settings.ttsLang}
            onChange={(e) => save({ ttsLang: e.target.value })}
          >
            <option value="">自动</option>
            <option value="zh-CN">中文</option>
            <option value="en-US">英语</option>
            <option value="ja-JP">日语</option>
          </select>
        </Row>
      </div>

      <div className="set-group">
        <h3>通用</h3>
        <Row title="连续新建卡片" desc="点“完成”后保存并继续新建下一张">
          <Switch on={settings.continuousNew} onToggle={() => save({ continuousNew: !settings.continuousNew })} />
        </Row>
        <Row title="外观">
          <Seg
            value={settings.theme}
            options={[['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']]}
            onPick={(v: Theme) => save({ theme: v })}
          />
        </Row>
      </div>

      <div className="set-group">
        <h3>数据</h3>
        <Row title="数据目录" desc="数据库和图片都存在这里">
          <code className="dir-code">{settings.dataDir}</code>
        </Row>
        <Row title="自动备份" desc="每天第一次启动时备份，保留最近 14 份">
          <button className="btn sm" onClick={() => void backupNow()}>
            立即备份
          </button>
        </Row>
        <Row title="从备份恢复">
          <button className="btn sm" onClick={() => setRestoreOpen(true)}>
            选择备份…
          </button>
        </Row>
      </div>

      {restoreOpen && <RestoreDialog onClose={() => setRestoreOpen(false)} />}
    </div>
  );
}
