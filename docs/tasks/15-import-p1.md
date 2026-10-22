# 任务 15：导入 P1——Excel（.xlsx）表格、Anki 牌组（.apkg）页签

先读 `AGENTS.md`，再读 `docs/contracts.md` 3.8（导入接口，含 `POST /api/import/apkg`），`docs/design.md` §1.5、§8。再读 `web/src/dialogs/ImportDialog.tsx`、`web/src/dialogs/ImportDialog.test.tsx`。

本任务只改这些文件：

- 修改：`web/src/dialogs/ImportDialog.tsx`、`web/src/dialogs/ImportDialog.test.tsx`（只加用例，不删改已有的）。
- 新建：`web/src/import/xlsx.ts`、`web/src/import/xlsx.test.ts`。
- 需要新样式时追加到 `web/src/styles/pages.css` 末尾。

`web` 包已经装了 `fflate`（`import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'`）。`api.io.importApkg(deckId, file)` 已有，返回 `{ cards, sections }`。

## 第一步：`xlsx.ts`，读出第一张工作表

```ts
/** 读 .xlsx 的第一张工作表，返回按行排列的单元格文字（空行去掉，每行末尾的空单元格去掉）。 */
export function xlsxToRows(data: Uint8Array): string[][];
/** 行 → 导入框用的 TSV：单元格里的 Tab、换行换成一个空格，行之间用 \n。 */
export function rowsToTsv(rows: string[][]): string;
```

.xlsx 是 zip，里面是 XML（用 `DOMParser` 解析，`'application/xml'`；jsdom 和浏览器都有）：

1. `xl/workbook.xml`：第一个 `<sheet>` 元素的关系 id 属性是 `r:id`（命名空间 `http://schemas.openxmlformats.org/officeDocument/2006/relationships`，用 `getAttributeNS` 或直接 `getAttribute('r:id')`）。
2. `xl/_rels/workbook.xml.rels`：找 `Id` 等于它的 `<Relationship>`，`Target` 形如 `worksheets/sheet1.xml`（相对 `xl/`；以 `/` 开头时去掉开头的 `/`，是从 zip 根算的路径）。
3. `xl/sharedStrings.xml`（可能不存在）：按顺序每个 `<si>` 是一个字符串，值 = 它里面所有 `<t>` 的文字拼起来（富文本是多个 `<r><t>`；跳过 `<rPh>` 里的 `<t>`，那是注音）。
4. 工作表里每个 `<row>` 的每个 `<c>`：列号从 `r` 属性（如 `C5`）的字母算（A=0，Z=25，AA=26）；没有 `r` 时接着上一格。值：
   - `t="s"`：`<v>` 是共享字符串下标；
   - `t="inlineStr"`：`<is>` 里所有 `<t>` 拼起来；
   - `t="b"`：`1` → `TRUE`，`0` → `FALSE`；
   - 其他（数字、`t="str"` 公式结果）：`<v>` 的文字原样；没有 `<v>` 就是空串。
   - 中间缺的列补空串。

找不到工作簿或工作表时抛 `Error('不是有效的 Excel 文件')`。

测试 `xlsx.test.ts`：用 `zipSync` + `strToU8` 在测试里拼出最小的 .xlsx（`xl/workbook.xml`、`xl/_rels/workbook.xml.rels`、`xl/sharedStrings.xml`、`xl/worksheets/sheet1.xml`）。覆盖：共享字符串、富文本 `<r><t>`（含 `<rPh>` 被跳过）、`inlineStr`、数字、布尔、跳列（`A1`、`C1` → 中间补空串）、空行被去掉、工作表 Target 是 `/xl/worksheets/sheet1.xml` 也能读；`rowsToTsv` 把单元格里的 `\t`、`\n` 换成空格；随便一段非 zip 字节抛错。

```sh
npx vitest run --project web src/import/xlsx.test.ts
```

## 第二步：文本页签接 Excel

- “上传 CSV 文件”按钮文字改成 `上传 Excel / CSV 文件`，文件框 `accept` 加 `.xlsx`。
- 选中 `.xlsx`：`file.arrayBuffer()` → `xlsxToRows` → `rowsToTsv` 填进文本框，格式按 TSV 处理（和粘贴 Excel 内容一样走现有预览）；解析失败 `toast('读取 Excel 失败')`。
- `.xls`（老格式）不支持：选中时 `toast('只支持 .xlsx，请在 Excel 里另存为 .xlsx')`。

## 第三步：Anki 页签

页签加第三个 `Anki 牌组（.apkg）`：

- 说明灰字（`.hint-text`）：`问答模板 → 问答卡，填空模板 → 笔记卡（{{c1::x}} 变成 {{x}}），子牌组 → 目录，图片一起导入。学习进度不导入。`
- 按钮 `选择 .apkg 文件`（`accept=".apkg"`），选中后显示文件名和大小（KB/MB，一位小数）。
- 底部主按钮 `导入`：没选文件时禁用；导入中显示 `导入中…` 并禁用。调用 `api.io.importApkg(deckId, file)`，成功后 `toast('已导入 ' + cards + ' 张卡片')`（`sections > 0` 时加 `、' + sections + ' 个目录'`），刷新这一卡片集的数据（照文件里现有导入成功后的做法），关闭对话框；失败 `toast` 后端返回的错误信息（`ApiError` 的 message），对话框保留。

测试（加在 `ImportDialog.test.tsx`，沿用已有的 mock 方式）：切到 `Anki 牌组（.apkg）` 页签，`导入` 按钮禁用；用 `fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'a.apkg')] } })` 选文件后可用；点 `导入` → 发出 `POST /api/import/apkg?deckId=<id>` 请求、body 是 `FormData`；返回 `{ cards: 3, sections: 1 }` 后对话框 `onClose` 被调用。

## 最后一步：收尾检查

```sh
npx vitest run --project web src/import src/dialogs/ImportDialog.test.tsx && npx tsc -p web --noEmit
```

通过的标准：这些测试全部通过（含原有用例）；类型检查没有错误；只改了上面列出的文件。全部通过后最后一行输出 `DONE`。
