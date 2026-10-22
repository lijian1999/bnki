// tts.ts 纯函数测试：挖空替换、只读外语过滤、朗读文本管线。
import { describe, expect, it } from 'vitest';
import { foreignOnly, hideClozes, ttsText } from './tts';

describe('hideClozes', () => {
  it('没揭示的换成空白，揭示的保留原文', () => {
    expect(hideClozes('a {{x}} b {{y}}', new Set([1]))).toBe('a 空白 b y');
  });
  it('空集合时全部换成空白', () => {
    expect(hideClozes('a {{x}} b {{y}}', new Set())).toBe('a 空白 b 空白');
  });
  it('{{}} 不算挖空，原样保留且不占编号', () => {
    expect(hideClozes('{{}}', new Set([0]))).toBe('{{}}');
    expect(hideClozes('{{}} {{x}}', new Set([0]))).toBe('{{}} x');
  });
});

describe('foreignOnly', () => {
  it('去掉汉字和全角标点，空白压成一个空格', () => {
    expect(foreignOnly('苹果 apple，香蕉 banana。')).toBe('apple banana');
  });
  it('全是汉字时得到空串', () => {
    expect(foreignOnly('苹果香蕉')).toBe('');
  });
});

describe('ttsText', () => {
  it('all 时只转纯文本，不带 Markdown 符号', () => {
    const out = ttsText('**粗** text', { ttsLangFilter: 'all' });
    expect(out).toBe('粗 text');
    expect(out).not.toContain('*');
  });
  it('foreign 时跳过汉字', () => {
    expect(ttsText('**粗** text', { ttsLangFilter: 'foreign' })).toBe('text');
  });
});
