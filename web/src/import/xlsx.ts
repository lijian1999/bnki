// .xlsx 解析：zip + XML，用 fflate 解包、DOMParser 解析。
import { unzipSync, strFromU8 } from 'fflate';

/** 读 .xlsx 的第一张工作表，返回按行排列的单元格文字（空行去掉，每行末尾的空单元格去掉）。 */
export function xlsxToRows(data: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error('不是有效的 Excel 文件');
  }

  const parse = (s: string): Document => {
    const doc = new DOMParser().parseFromString(s, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('不是有效的 Excel 文件');
    return doc;
  };

  // 1. workbook.xml → 第一张 sheet 的 r:id
  const wbBuf = files['xl/workbook.xml'];
  if (!wbBuf) throw new Error('不是有效的 Excel 文件');
  const wb = parse(strFromU8(wbBuf));
  const sheet = wb.getElementsByTagName('sheet')[0];
  if (!sheet) throw new Error('不是有效的 Excel 文件');
  const rid =
    sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ??
    sheet.getAttribute('r:id');
  if (!rid) throw new Error('不是有效的 Excel 文件');

  // 2. workbook.xml.rels → 工作表路径
  const relBuf = files['xl/_rels/workbook.xml.rels'];
  if (!relBuf) throw new Error('不是有效的 Excel 文件');
  const rels = parse(strFromU8(relBuf));
  const rel = Array.from(rels.getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid);
  if (!rel) throw new Error('不是有效的 Excel 文件');
  let target = rel.getAttribute('Target') ?? '';
  if (!target) throw new Error('不是有效的 Excel 文件');

  // 路径：相对 xl/，以 / 开头时从 zip 根算
  const wsPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
  const wsBuf = files[wsPath];
  if (!wsBuf) throw new Error('不是有效的 Excel 文件');
  const ws = parse(strFromU8(wsBuf));

  // 3. 共享字符串
  const sstBuf = files['xl/sharedStrings.xml'];
  let shared: string[] = [];
  if (sstBuf) {
    const sst = parse(strFromU8(sstBuf));
    shared = Array.from(sst.getElementsByTagName('si')).map((si) =>
      Array.from(si.getElementsByTagName('t'))
        .filter((t) => !t.closest('rPh'))
        .map((t) => t.textContent ?? '')
        .join(''),
    );
  }

  // 4. 工作表 cell
  const rows: string[][] = [];
  for (const row of Array.from(ws.getElementsByTagName('row'))) {
    const cells: string[] = [];
    let prevCol = -1; // 上一格的列号
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      // 列号
      let col: number;
      const ref = c.getAttribute('r');
      if (ref) {
        col = refToCol(ref);
      } else {
        col = prevCol < 0 ? 0 : prevCol + 1;
      }
      prevCol = col;
      // 中间缺列补空串
      while (cells.length < col) cells.push('');

      const t = c.getAttribute('t') ?? '';
      let val: string;
      if (t === 's') {
        const vEl = c.querySelector('v') ?? c.getElementsByTagName('v')[0];
        const idx = vEl ? Number(vEl.textContent ?? '') : -1;
        val = idx >= 0 && idx < shared.length ? shared[idx] : '';
      } else if (t === 'inlineStr') {
        const isEl = c.querySelector('is') ?? c.getElementsByTagName('is')[0];
        val = isEl
          ? Array.from(isEl.getElementsByTagName('t'))
              .filter((te) => !te.closest('rPh'))
              .map((te) => te.textContent ?? '')
              .join('')
          : '';
      } else if (t === 'b') {
        const vEl = c.querySelector('v') ?? c.getElementsByTagName('v')[0];
        val = (vEl?.textContent ?? '') === '1' ? 'TRUE' : 'FALSE';
      } else {
        const vEl = c.querySelector('v') ?? c.getElementsByTagName('v')[0];
        val = vEl?.textContent ?? '';
      }

      // 如果 col 大于 cells.length（跳列），上面的 while 已补齐
      cells[col] = val;
    }
    // 去掉行末尾的空单元格
    let end = cells.length;
    while (end > 0 && cells[end - 1] === '') end--;
    const trimmed = cells.slice(0, end);
    if (trimmed.length > 0) rows.push(trimmed);
  }
  return rows;
}

/** 行 → 导入框用的 TSV：单元格里的 Tab、换行换成一个空格，行之间用 \n。 */
export function rowsToTsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => cell.replace(/\r\n|[\t\n\r]/g, ' '))
        .join('\t'),
    )
    .join('\n');
}

/** Excel 引用 "C5" 的字母部分 → 0-based 列号。 */
function refToCol(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    if (ch >= 'A' && ch <= 'Z') n = n * 26 + (ch.charCodeAt(0) - 64);
    else if (ch >= 'a' && ch <= 'z') n = n * 26 + (ch.charCodeAt(0) - 96);
    else break;
  }
  return n - 1;
}
