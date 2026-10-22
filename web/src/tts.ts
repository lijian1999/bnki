// 朗读共用：朗读前的文本处理（挖空、只读外语）和语音构建。
import type { Settings } from '@bnki/shared';
import { plainText } from '@bnki/shared/markdown';

/** 把 Markdown 里没揭示的挖空 `{{…}}` 换成“空白”。挖空按出现顺序从 0 编号；`revealed` 里的编号保留原文（去掉花括号）。 */
export function hideClozes(src: string, revealed: ReadonlySet<number>): string {
  let n = 0;
  // 非贪婪取到最近的 }}；内容为空（{{}}）不算挖空，原样保留、不占编号，和渲染规则一致。
  return src.replace(/\{\{([^\n]*?)\}\}/g, (m, inner: string) => (inner === '' ? m : revealed.has(n++) ? inner : '空白'));
}

/** 只读外语：去掉汉字（Unicode Script=Han）和全角标点（U+3000–U+303F、U+FF00–U+FFEF），连续空白压成一个空格，首尾去空白。 */
export function foreignOnly(text: string): string {
  return text
    .replace(/[\p{Script=Han}\u3000-\u303F\uFF00-\uFFEF]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 按设置做朗读前的最后处理：先转纯文本，`ttsLangFilter` 是 'foreign' 时再跳过汉字，最后 trim。 */
export function ttsText(src: string, s: Pick<Settings, 'ttsLangFilter'>): string {
  const t = plainText(src);
  return (s.ttsLangFilter === 'foreign' ? foreignOnly(t) : t).trim();
}

/** 建一条语音：语速取 `ttsRate`，设了语言才带上 `lang`（空串 = 自动，交给浏览器）。 */
export function utter(text: string, s: Pick<Settings, 'ttsRate' | 'ttsLang'>): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(text);
  u.rate = s.ttsRate;
  if (s.ttsLang) u.lang = s.ttsLang;
  return u;
}

/** 浏览器有没有朗读能力（jsdom 下没有时调用方要提示不支持）。 */
export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}
