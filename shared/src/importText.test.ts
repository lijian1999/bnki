import { describe, expect, it } from 'vitest';
import { parseImportText } from './importText';

describe('parseImportText', () => {
  it('tsv 两列', () => {
    const rows = parseImportText('问1\t答1\n问2\t答2', 'tsv', false);
    expect(rows).toEqual([
      { section: null, front: '问1', back: '答1' },
      { section: null, front: '问2', back: '答2' },
    ]);
  });

  it('tsv 一列（无背面）', () => {
    const rows = parseImportText('只有正面', 'tsv', false);
    expect(rows).toEqual([{ section: null, front: '只有正面', back: '' }]);
  });

  it('带目录列', () => {
    const rows = parseImportText('第一章\t问1\t答1\n\t问2\t答2', 'tsv', true);
    expect(rows).toEqual([
      { section: '第一章', front: '问1', back: '答1' },
      { section: null, front: '问2', back: '答2' },
    ]);
  });

  it('空行跳过', () => {
    const rows = parseImportText('问1\t答1\n\n   \n问2\t答2', 'tsv', false);
    expect(rows).toEqual([
      { section: null, front: '问1', back: '答1' },
      { section: null, front: '问2', back: '答2' },
    ]);
  });

  it('csv 引号里有逗号', () => {
    const rows = parseImportText('"问,1"\t答1', 'csv', false);
    // csv 格式下应该能解析
    const rows2 = parseImportText('"问,1",答1', 'csv', false);
    expect(rows2).toEqual([{ section: null, front: '问,1', back: '答1' }]);
  });

  it('csv 引号里有换行', () => {
    const rows = parseImportText('"问\n1",答1', 'csv', false);
    expect(rows).toEqual([{ section: null, front: '问\n1', back: '答1' }]);
  });

  it('csv "" 转义', () => {
    const rows = parseImportText('"问""1",答1', 'csv', false);
    expect(rows).toEqual([{ section: null, front: '问"1', back: '答1' }]);
  });

  it('\\r\\n 换行', () => {
    const rows = parseImportText('问1\t答1\r\n问2\t答2', 'tsv', false);
    expect(rows).toEqual([
      { section: null, front: '问1', back: '答1' },
      { section: null, front: '问2', back: '答2' },
    ]);
  });

  it('正面为空的行跳过', () => {
    const rows = parseImportText('\t答1\n问2\t答2', 'tsv', false);
    expect(rows).toEqual([{ section: null, front: '问2', back: '答2' }]);
  });

  it('多余列忽略', () => {
    const rows = parseImportText('问1\t答1\t多余', 'tsv', false);
    expect(rows).toEqual([{ section: null, front: '问1', back: '答1' }]);
  });
});
