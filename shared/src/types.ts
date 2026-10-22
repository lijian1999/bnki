// 前后端共用的数据类型。字段名就是 API 的 JSON 字段名（camelCase）；数据库列名是 snake_case，由 server 转换。
// 时间一律是毫秒时间戳（number），日期字符串一律是 'YYYY-MM-DD'。

export type ID = string;

export type CardType = 'note' | 'qa' | 'topic';
export type CardColor =
  | 'default' | 'light-yellow' | 'light-blue' | 'light-green' | 'light-red'
  | 'grey' | 'yellow' | 'blue' | 'green' | 'red';

export type PlanMode = 'daily' | 'flexible' | 'sprint';
export type StudyContent = 'recommend' | 'new' | 'review' | 'all';
export type StudyOrder = 'sequential' | 'due_first' | 'random';
export type StudyDirection = 'front' | 'back' | 'random';
export type FontSize = 'small' | 'default' | 'large' | 'xlarge';
export type CardSize = 'default' | 'large' | 'wide' | 'full';
export type Theme = 'light' | 'dark' | 'system';
export type Rating = 1 | 2 | 3 | 4; // 1 忘记了 2 模糊 3 记住了 4 很简单

export type DeckSort =
  | 'name' | 'updated' | 'created' | 'studied' | 'next_due' | 'card_count' | 'fresh_count';

export interface Folder {
  id: ID;
  name: string;
  position: number;
  createdAt: number;
}

export interface StudyPlan {
  mode?: PlanMode;
  examDate?: string | null; // 'YYYY-MM-DD'，冲刺模式用
  newPerDay?: number;
  reviewPerDay?: number;
}

/** 每个卡片集一份，存 decks.study_cfg。字段都可省略，省略时用全局设置（见 resolveStudyCfg）。 */
export interface StudyCfg {
  content?: StudyContent;
  colors?: CardColor[]; // 空数组 = 全部颜色
  sections?: ID[]; // 空数组 = 全部目录
  order?: StudyOrder;
  direction?: StudyDirection;
  clickBlankRevealNext?: boolean;
  plan?: StudyPlan;
  fontSize?: FontSize; // 学习页文字大小
  size?: CardSize; // 学习页卡片大小
}

export interface ResolvedStudyCfg {
  content: StudyContent;
  colors: CardColor[];
  sections: ID[];
  order: StudyOrder;
  direction: StudyDirection;
  clickBlankRevealNext: boolean;
  plan: { mode: PlanMode; examDate: string | null; newPerDay: number; reviewPerDay: number };
  fontSize: FontSize;
  size: CardSize;
}

/** 卡片集页的布局与显示选项，存 decks.display_cfg。 */
export interface DisplayCfg {
  layout?: 'auto' | 1 | 2 | 3;
  showAnswer?: boolean; // 网格里显示答案内容，默认 true
  showProgress?: boolean; // 显示学习进度面板，默认 true
  showMindmap?: boolean; // 显示导图按钮，默认 true
  showToc?: boolean; // 显示左侧目录面板，默认 true
}

export interface CardState {
  state: 0 | 1 | 2 | 3; // 0 New 1 Learning 2 Review 3 Relearning
  due: number | null;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  lastReview: number | null;
  mastered: boolean;
}

export interface DeckCounts {
  total: number; // 卡片总数（不含已删除）
  fresh: number; // 未学：New 且未掌握
  due: number; // 待复习：到期且未掌握
  learned: number; // 已学 = total - fresh
  pct: number; // Math.round(learned / total * 100)，total 为 0 时是 0
  nextDue: number | null; // 未掌握、已学卡片里最早的 due
}

export interface Deck {
  id: ID;
  title: string;
  description: string;
  folderId: ID | null;
  cover: string | null;
  pinnedAt: number | null;
  createdAt: number;
  updatedAt: number;
  openedAt: number | null;
  studiedAt: number | null;
  deletedAt: number | null;
  studyCfg: StudyCfg;
  displayCfg: DisplayCfg;
}

export interface DeckSummary extends Deck {
  counts: DeckCounts;
}

export interface SectionItem {
  id: ID;
  deckId: ID;
  kind: 'section';
  position: number;
  level: 1 | 2 | 3 | 4 | 5;
  title: string;
  collapsed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CardItem {
  id: ID;
  deckId: ID;
  kind: 'card';
  position: number;
  cardType: CardType;
  front: string; // Markdown
  hint: string; // Markdown，可为空串
  back: string; // Markdown，可为空串
  color: CardColor;
  createdAt: number;
  updatedAt: number;
  state: CardState | null; // null = 从没评过分（等同 New）
}

export type Item = SectionItem | CardItem;

export interface Settings {
  defaultMode: PlanMode;
  newPerDay: number;
  reviewPerDay: number;
  clickBlankRevealNext: boolean;
  fontSize: FontSize;
  retention: number; // 0.80–0.97
  maxIvl: number; // 天
  dayHour: number; // 0 | 2 | 4 | 6
  steps: number; // 灵活模式短间隔（分钟）：1 | 5 | 10 | 30
  fuzz: boolean;
  easyButton: boolean;
  requeueNoReschedule: boolean;
  continuousNew: boolean;
  theme: Theme;
  homeSort: DeckSort;
  lastCardType: CardType;
  lastCardColor: CardColor;
  markerColor: string; // 最近一次用的马克笔：'yellow' | 'green' | 'blue' | 'red' | 'purple'
  ttsRate: number; // 朗读语速 0.8–1.2
  ttsLang: string; // 朗读语言，'' = 自动
  dataDir: string; // 只读，服务端填
}

export type ReviewLogKind = 'grade' | 'practice' | 'manual' | 'master' | 'unmaster' | 'reset';

export interface ReviewLog {
  id: number;
  cardId: ID;
  deckId: ID;
  kind: ReviewLogKind;
  rating: Rating | null;
  state: number | null; // 评分前的状态
  due: number | null; // 评分后的 due
  stability: number | null;
  difficulty: number | null;
  elapsedDays: number | null;
  scheduledDays: number | null;
  reviewedAt: number;
  durationMs: number | null;
}

/** 学习队列里的一项。 */
export interface QueueEntry {
  cardId: ID;
  rep: boolean; // true = 本轮重练（忘记了之后再出现一次）
  flipped: boolean; // 问答卡出题方向：true = 答案作为题面
}
