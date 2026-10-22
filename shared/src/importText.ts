// 文本导入解析：TSV / CSV → 行列表。
export interface ImportRow { section: string | null; front: string; back: string }

/**
 * 解析 TSV 或 CSV 文本。
 * @param firstColumnIsSection 为 true 时第一列是目录名，后续列依次是正面、背面。
 */
export function parseImportText(
  text: string,
  format: 'tsv' | 'csv',
  firstColumnIsSection: boolean,
): ImportRow[] {
  const rows: ImportRow[] = [];
  const columnsList = format === 'csv' ? parseCsv(text) : parseTsv(text);
  for (const cols of columnsList) {
    const trimmed = cols.map(c => c.trim());
    if (trimmed.every(c => c === '')) continue;
    let section: string | null = null;
    let front: string;
    let back: string;
    if (firstColumnIsSection) {
      section = trimmed[0] || null;
      front = trimmed[1] ?? '';
      back = trimmed[2] ?? '';
    } else {
      front = trimmed[0] ?? '';
      back = trimmed[1] ?? '';
    }
    if (!front) continue;
    rows.push({ section, front, back });
  }
  return rows;
}

function parseTsv(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  const result: string[][] = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    result.push(line.split('\t'));
  }
  return result;
}

/**
 * 标准 CSV 解析：支持双引号字段（内含逗号、换行、"" 转义）。
 * 返回二维数组，每个内层数组是一行，元素是列值。
 */
function parseCsv(text: string): string[][] {
  const result: string[][] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const row: string[] = [];
    // 解析一行
    while (true) {
      if (i >= len) {
        // 行末（文件末尾），推入当前行
        row.push('');
        break;
      }
      if (text[i] === '"') {
        // 带引号的字段
        i++; // 跳过开引号
        let field = '';
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              // 闭引号
              i++; // 跳过闭引号
              break;
            }
          } else {
            field += text[i];
            i++;
          }
        }
        row.push(field);
        // 引号结束后期望逗号或行末
        if (i < len && text[i] === ',') {
          i++; // 跳过逗号
          continue;
        } else if (i < len && (text[i] === '\n' || text[i] === '\r')) {
          if (text[i] === '\r' && i + 1 < len && text[i + 1] === '\n') i++;
          else i++;
          break;
        } else {
          // 文件末尾
          break;
        }
      } else {
        // 无引号字段，读到逗号或行末
        let field = '';
        while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          field += text[i];
          i++;
        }
        row.push(field);
        if (i < len && text[i] === ',') {
          i++; // 跳过逗号
          continue;
        } else if (i < len && (text[i] === '\n' || text[i] === '\r')) {
          if (text[i] === '\r' && i + 1 < len && text[i + 1] === '\n') i++;
          else i++;
          break;
        } else {
          // 文件末尾
          break;
        }
      }
    }
    // 跳过全是空白的行
    if (row.every(c => c.trim() === '')) continue;
    result.push(row);
  }
  return result;
}
