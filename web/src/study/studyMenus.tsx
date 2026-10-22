// 学习页的两个菜单：⋯（自定义下次复习时间、完成学习、彻底忘记）和 ⋮（学习设置、卡片外观、副本、移动、删除）。
// 结构照原型 customTimeMenu / studyMenu。
import {
  DAY, HOUR, MIN, dayStart, resolveStudyCfg,
  type CardColor, type CardItem, type CardSize, type CardState, type DeckSummary, type FontSize, type ID, type Settings, type StudyCfg,
} from '@bnki/shared';
import { api } from '../api';
import { useUI } from '../store';
import { confirmDialog, promptDialog } from '../ui/dialogs';
import type { MenuItem } from '../ui/menu';
import { Swatches } from '../ui/Swatches';
import { toast } from '../ui/toast';
import { errText } from './util';
import type { JSX } from 'react';

/** 学习弹窗交给菜单用的动作；卡片相关的操作都作用在“当前这一张”上。 */
export interface StudyOps {
  deckId: ID;
  card: CardItem;
  deck: DeckSummary | null;
  settings: Settings;
  /** 把新状态写回 ['items', deckId] 缓存里的当前卡片。 */
  writeState: (st: CardState | null) => void;
  advance: () => void;
  /** 从队列里拿掉当前卡片。 */
  dropCurrent: () => void;
  setColor: (c: CardColor) => void;
  setCfg: (patch: StudyCfg) => void;
  /** 自定义到期时间（绝对时刻）+ 提示文字。 */
  due: (due: number, text: string) => void;
  /** 完成学习 / 彻底忘记。 */
  mark: (action: 'master' | 'forget', msg: string) => void;
}

const FONT_SIZES: [FontSize, string][] = [
  ['small', '小'],
  ['default', '默认'],
  ['large', '大'],
  ['xlarge', '特大'],
];
const CARD_SIZES: [CardSize, string][] = [
  ['default', '默认'],
  ['large', '放大'],
  ['wide', '宽屏'],
  ['full', '全屏'],
];

export function customTimeMenu(ops: StudyOps): MenuItem[] {
  const now = Date.now();
  const s = ops.settings;
  const opts: [string, number][] = [
    ['15分钟', now + 15 * MIN],
    ['1小时', now + HOUR],
    ['6小时', now + 6 * HOUR],
    // 明天：下一个学习日的 dayHour 点起
    ['明天', dayStart(now, s.dayHour) + DAY],
    ['3天', now + 3 * DAY],
    ['7天', now + 7 * DAY],
    ['14天', now + 14 * DAY],
    ['30天', now + 30 * DAY],
    ['3个月', now + 90 * DAY],
  ];
  return [
    { header: '自定义下次复习时间' },
    ...opts.map(([label, due]) => ({ label, onClick: () => ops.due(due, label) })),
    {
      label: 'N 天后…',
      onClick: async () => {
        const v = await promptDialog('几天后复习？', '10', '天数');
        const n = parseFloat(v ?? '');
        if (n > 0) ops.due(Date.now() + n * DAY, n + '天');
      },
    },
    {
      label: '选择日期…',
      onClick: async () => {
        const d = new Date(Date.now() + 7 * DAY);
        const def = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const v = await promptDialog('选择复习日期', def, 'YYYY-MM-DD');
        const day = v ? v.trim() : '';
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
        if (!m) return;
        const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), s.dayHour, 0, 0, 0).getTime();
        ops.due(due, day);
      },
    },
    '-',
    { label: '完成学习（已掌握，不再出现）', icon: '✓', onClick: () => ops.mark('master', '已标记为掌握') },
    { label: '彻底忘记（重置为新卡）', icon: '⟲', danger: true, onClick: () => ops.mark('forget', '已重置为新卡') },
  ];
}

export function studyMenu(ops: StudyOps, decks: DeckSummary[]): MenuItem[] {
  const { card } = ops;
  const cur = resolveStudyCfg(ops.deck?.studyCfg, ops.settings);
  return [
    { label: '学习设置', icon: '⚙', onClick: () => useUI.getState().openDialog('studySettings', ops.deckId) },
    { label: '朗读偏好', icon: '🔈', onClick: () => useUI.getState().openDialog('ttsPrefs', ops.deckId) },
    '-',
    {
      label: '卡片颜色',
      icon: '●',
      sub: (): MenuItem[] => [{ render: (): JSX.Element => <Swatches current={card.color} onPick={ops.setColor} /> }],
    },
    {
      label: '卡片文字大小',
      icon: 'A',
      sub: () =>
        FONT_SIZES.map(([k, l]) => ({
          label: l,
          checked: cur.fontSize === k,
          onClick: () => ops.setCfg({ fontSize: k }),
        })),
    },
    {
      label: '卡片大小',
      icon: '▭',
      sub: () =>
        CARD_SIZES.map(([k, l]) => ({
          label: l,
          checked: cur.size === k,
          onClick: () => ops.setCfg({ size: k }),
        })),
    },
    '-',
    {
      label: '创建副本',
      icon: '⧉',
      onClick: () => {
        void api.items
          .duplicate(card.id)
          .then(() => toast('已创建副本'))
          .catch((e: unknown) => toast(errText(e)));
      },
    },
    {
      label: '移动到卡片集',
      icon: '⇄',
      sub: () =>
        decks
          .filter((d) => d.id !== ops.deckId)
          .map((d) => ({ label: d.title, onClick: () => moveTo(ops, d.id, d.title) })),
    },
    {
      label: '删除卡片',
      icon: '🗑',
      danger: true,
      onClick: async () => {
        if (!(await confirmDialog('删除卡片', '删除后可以在卡片集页撤销。', '删除', true))) return;
        void api.items
          .remove([card.id])
          .then(() => ops.dropCurrent())
          .catch((e: unknown) => toast(errText(e)));
      },
    },
  ];
}

/** 移到别的卡片集末尾，并把它从本轮队列里拿掉。 */
function moveTo(ops: StudyOps, deckId: ID, title: string): void {
  void api.items
    .list(deckId)
    .then((list) => api.items.move({ ids: [ops.card.id], afterId: list.length ? list[list.length - 1].id : null, deckId }))
    .then(() => {
      toast(`已移动到「${title}」`);
      ops.dropCurrent();
    })
    .catch((e: unknown) => toast(errText(e)));
}
