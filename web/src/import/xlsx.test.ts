import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { xlsxToRows, rowsToTsv } from './xlsx';

/** 构造一个最小 .xlsx（zip），覆盖共享字符串、富文本、inlineStr、数字、布尔等。 */
function makeXlsx(opts: {
  sheetTarget?: string; // workbook.xml.rels 的 Target，默认 'worksheets/sheet1.xml'
  sharedStrings?: string;
  sheetXml: string;
}): Uint8Array {
  const wbXml =
    '<?xml version="1.0"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const relsXml =
    '<?xml version="1.0"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Target="${opts.sheetTarget ?? 'worksheets/sheet1.xml'}"/>` +
    '</Relationships>';
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(wbXml),
    'xl/_rels/workbook.xml.rels': strToU8(relsXml),
    'xl/worksheets/sheet1.xml': strToU8(opts.sheetXml),
  };
  if (opts.sharedStrings) files['xl/sharedStrings.xml'] = strToU8(opts.sharedStrings);
  return zipSync(files);
}

describe('xlsxToRows', () => {
  it('共享字符串', () => {
    const sst = '<?xml version="1.0"?><sst><si><t>问1</t></si><si><t>答1</t></si></sst>';
    const sheet =
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '</sheetData></worksheet>';
    const rows = xlsxToRows(makeXlsx({ sharedStrings: sst, sheetXml: sheet }));
    expect(rows).toEqual([['问1', '答1']]);
  });

  it('富文本 r/t 拼接，rPh 跳过', () => {
    const sst =
      '<?xml version="1.0"?><sst>' +
      '<si><r><t>富</t></r><r><t>文</t></r><rPh><t>音</t></rPh><r><t>本</t></r></si>' +
      '</sst>';
    const sheet =
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
      '</sheetData></worksheet>';
    const rows = xlsxToRows(makeXlsx({ sharedStrings: sst, sheetXml: sheet }));
    expect(rows).toEqual([['富文本']]);
  });

  it('inlineStr', () => {
    const sheet =
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>直</t><t>接</t></is></c></row>' +
      '</sheetData></worksheet>';
    const rows = xlsxToRows(makeXlsx({ sheetXml: sheet }));
    expect(rows).toEqual([['直接']]);
  });

  it('数字', () => {
    const sheet =
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1"><v>42</v></c><c r="B1"><v>3.14</v></c></row>' +
      '</sheetData></worksheet>';
    const rows = xlsxToRows(makeXlsx({ sheetXml: sheet }));
    expect(rows).toEqual([['42', '3.14']]);
  });

  it('布尔', () => {
    const sheet =
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>0</v></c></row>' +
      '</sheetData></worksheet>';
    const rows = xlsxToRows(makeXlsx({ sheetXml: sheet }));
    expect(rows).toEqual([['TRUE', 'FALSE']]);
  });

  it('跳列 A1、C1 中间补空串', () => {
    const sst = '<?xml version="1.0"?><sst><si><t>a</t></si><si><t>c</t></si></sst>';
    const sheet =
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
      '</sheetData></worksheet>';
    const rows = xlsxToRows(makeXlsx({ sharedStrings: sst, sheetXml: sheet }));
    expect(rows).toEqual([['a', '', 'c']]);
  });

  it('空行被去掉', () => {
    const sst = '<?xml version="1.0"?><sst><si><t>x</t></si></sst>';
    const sheet =
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
      '<row r="2"></row>' +
      '<row r="3"><c r="A3" t="s"><v>0</v></c></row>' +
      '</sheetData></worksheet>';
    const rows = xlsxToRows(makeXlsx({ sharedStrings: sst, sheetXml: sheet }));
    expect(rows).toEqual([['x'], ['x']]);
  });

  it('Target 以 / 开头也能读', () => {
    const sst = '<?xml version="1.0"?><sst><si><t>y</t></si></sst>';
    const sheet =
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
      '</sheetData></worksheet>';
    const rows = xlsxToRows(makeXlsx({ sheetTarget: '/xl/worksheets/sheet1.xml', sharedStrings: sst, sheetXml: sheet }));
    expect(rows).toEqual([['y']]);
  });

  it('非 zip 抛错', () => {
    expect(() => xlsxToRows(new Uint8Array([1, 2, 3, 4, 5]))).toThrow('不是有效的 Excel 文件');
  });
});

describe('rowsToTsv', () => {
  it('Tab 换行替换为空格', () => {
    expect(rowsToTsv([['a\tb\nc', 'd\r\ne']])).toBe('a b c\td e');
  });
});
