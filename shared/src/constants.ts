import type { CardColor, CardType, ResolvedStudyCfg, Settings, StudyCfg, StudyContent } from './types';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** 10 种卡片颜色：[key, 名称, 主色]。后 5 种在界面上是更浓的渐变背景。 */
export const CARD_COLORS: { key: CardColor; name: string; hex: string }[] = [
  { key: 'default', name: '白色', hex: '#ffffff' },
  { key: 'light-yellow', name: '浅黄', hex: '#fff3c4' },
  { key: 'light-blue', name: '浅蓝', hex: '#dbe9ff' },
  { key: 'light-green', name: '浅绿', hex: '#d8f3e2' },
  { key: 'light-red', name: '浅红', hex: '#fbdcdc' },
  { key: 'grey', name: '灰色', hex: '#c9cdd3' },
  { key: 'yellow', name: '黄色', hex: '#f7d774' },
  { key: 'blue', name: '蓝色', hex: '#a9c8f5' },
  { key: 'green', name: '绿色', hex: '#a8dcbb' },
  { key: 'red', name: '红色', hex: '#eba48d' },
];

export const CARD_TYPE_NAMES: Record<CardType, string> = { note: '笔记卡片', qa: '问答卡片', topic: '主题卡片' };
export const CONTENT_NAMES: Record<StudyContent, string> = {
  recommend: '系统推荐', new: '仅未学习', review: '仅复习', all: '全部卡片',
};

/** 马克笔颜色（§3.3）与文字颜色。 */
export const MARK_COLORS = ['yellow', 'green', 'blue', 'red', 'purple'] as const;
export const MARK_STYLES = ['line', 'wavy'] as const; // 不写 data-s 就是普通马克笔
export const TEXT_COLORS = ['red', 'blue', 'green', 'grey'] as const;
export const FONT_SIZES = ['12', '16', '22', '26'] as const;

export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'daily',
  newPerDay: 20,
  reviewPerDay: 100,
  clickBlankRevealNext: true,
  fontSize: 'default',
  retention: 0.9,
  maxIvl: 365,
  dayHour: 4,
  steps: 10,
  fuzz: true,
  easyButton: false,
  requeueNoReschedule: true,
  continuousNew: true,
  theme: 'system',
  homeSort: 'updated',
  lastCardType: 'qa',
  lastCardColor: 'default',
  markerColor: 'yellow',
  ttsRate: 1,
  ttsLang: '',
  ttsScope: 'visible',
  ttsLangFilter: 'all',
  ttsMode: 'once',
  dataDir: '',
};

/** 卡片集的学习设置 + 全局设置 → 完整的学习设置。 */
export function resolveStudyCfg(cfg: StudyCfg | null | undefined, settings: Settings): ResolvedStudyCfg {
  const c = cfg || {};
  const p = c.plan || {};
  return {
    content: c.content ?? 'recommend',
    colors: c.colors ?? [],
    sections: c.sections ?? [],
    order: c.order ?? 'sequential',
    direction: c.direction ?? 'front',
    clickBlankRevealNext: c.clickBlankRevealNext ?? settings.clickBlankRevealNext,
    plan: {
      mode: p.mode ?? settings.defaultMode,
      examDate: p.examDate ?? null,
      newPerDay: p.newPerDay ?? settings.newPerDay,
      reviewPerDay: p.reviewPerDay ?? settings.reviewPerDay,
    },
    fontSize: c.fontSize ?? settings.fontSize,
    size: c.size ?? 'default',
  };
}
