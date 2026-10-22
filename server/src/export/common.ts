// 导出用的公共类型和挖空处理。
import { unwrapCloze } from './cloze';

export type ClozeMode = 'keep' | 'answer';
export type ExportFormat = 'md' | 'html' | 'csv' | 'json';

export interface ExportDeck {
  title: string;
  description: string;
}

/** `answer` 时去掉挖空标记，`keep` 原样 */
export function applyCloze(s: string, cloze: ClozeMode): string {
  const v = s ?? '';
  return cloze === 'answer' ? unwrapCloze(v) : v;
}
