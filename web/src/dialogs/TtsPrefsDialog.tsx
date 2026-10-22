// 朗读偏好弹窗：卡片集 ⋯ / 学习 ⋮ 菜单里的入口，和设置页“朗读偏好”一组共用 TtsPrefsRows。
import type { JSX } from 'react';
import type { TtsLangFilter, TtsMode, TtsScope } from '@bnki/shared';
import { useSaveSettings, useSettings } from '../queries';
import { Modal, DialogHead } from '../ui/Modal';
import { Row, Seg } from '../ui/settingRows';

/** 朗读偏好的一组设置行；两处（设置页、弹窗）显示一致，改动立即保存。 */
export function TtsPrefsRows(): JSX.Element | null {
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  if (!settings) return null;
  const put = (patch: Parameters<typeof save>[0]): void => void save(patch).catch(() => {});
  return (
    <>
      <Row title="朗读方式" desc="使用系统自带的语音">
        <span className="hint-text">系统朗读</span>
      </Row>
      <Row title="朗读范围" desc="当前可见：只读已经显示出来的内容；整张卡：正面和背面都读">
        <Seg
          value={settings.ttsScope}
          options={[
            ['visible', '当前可见'],
            ['card', '整张卡'],
          ]}
          onPick={(v: TtsScope) => put({ ttsScope: v })}
        />
      </Row>
      <Row title="语言">
        <select className="select-input" value={settings.ttsLang} onChange={(e) => put({ ttsLang: e.target.value })}>
          <option value="">自动</option>
          <option value="zh-CN">中文</option>
          <option value="en-US">英语</option>
          <option value="ja-JP">日语</option>
        </select>
      </Row>
      <Row title="语言筛选" desc="只读外语时跳过汉字">
        <Seg
          value={settings.ttsLangFilter}
          options={[
            ['all', '全部语言'],
            ['foreign', '只读外语'],
          ]}
          onPick={(v: TtsLangFilter) => put({ ttsLangFilter: v })}
        />
      </Row>
      <Row title="语速">
        <Seg
          value={settings.ttsRate}
          options={[[0.8, '0.8'], [0.9, '0.9'], [1, '1.0'], [1.1, '1.1'], [1.2, '1.2']]}
          onPick={(v: number) => put({ ttsRate: v })}
        />
      </Row>
      <Row title="朗读模式" desc="单次：读完停止；连续：读完自动下一张；单卡循环：反复读当前卡片">
        <Seg
          value={settings.ttsMode}
          options={[
            ['once', '单次'],
            ['continuous', '连续'],
            ['loop', '单卡循环'],
          ]}
          onPick={(v: TtsMode) => put({ ttsMode: v })}
        />
      </Row>
    </>
  );
}

export default function TtsPrefsDialog(props: { deckId: string; onClose: () => void }): JSX.Element {
  return (
    <Modal light onClose={props.onClose} className="tts-prefs-dialog">
      <DialogHead title="朗读偏好" onClose={props.onClose} />
      <div className="dialog-body">
        <TtsPrefsRows />
      </div>
    </Modal>
  );
}
