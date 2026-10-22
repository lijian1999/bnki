# 任务 10：导出（服务端接口 + 导出对话框）

先读 `AGENTS.md`，再读接口约定 `docs/contracts.md`（第 2 节、3.3、3.8、第 4 节、第 5 节）。本任务只改这些文件：

- 替换空壳：`server/src/routes/export.ts`、`web/src/dialogs/ExportDialog.tsx`。
- 新建：`server/src/routes/export.test.ts`、`web/src/dialogs/ExportDialog.test.tsx`；需要的话新建 `server/src/export/` 目录放各格式的生成函数。
- 需要新样式时写进新建的 `web/src/styles/export.css`，在本任务的组件文件里 `import '../styles/export.css'`（路径按文件位置调整）；不要改 `app.css`。

不要改别的文件。`server/src/app.ts` 已经挂载了 `routes/export.ts` 的默认导出（`register(app, ctx)`）；`web/src/api.ts` 已有 `api.io.exportUrl(deckId, params)`（参数里有 `inline?: 1`）。

## 第一步：接口 `GET /api/export/:deckId`

查询参数：

- `format`：`md` | `html` | `csv` | `json`，默认 `md`，其余 400。
- `cloze`：`keep`（默认）| `answer`。
- `sections`：逗号分隔的目录 id，可省略（= 全部）。
- `inline`：`1` 时不加 `Content-Disposition`（浏览器里直接打开，用于打印）。

卡片集不存在（或已删除）时 404。读该卡片集未删除的 items（按 `position`）。`sections` 非空时只保留这些目录的**目录块**（目录本身 + 直到下一个同级或更高级目录之前的所有项），多个块按原顺序合并、去重。

响应头：`Content-Type` 分别是 `text/markdown; charset=utf-8`、`text/html; charset=utf-8`、`text/csv; charset=utf-8`、`application/json; charset=utf-8`；不是 inline 时 `Content-Disposition: attachment; filename*=UTF-8''<encodeURIComponent(标题 + 扩展名)>`（扩展名 `.md` / `.html` / `.csv` / `.json`）。

挖空处理：`cloze=answer` 时把 Markdown 里的 `{{内容}}` 换成 `内容`（`\{{` 是字面量，不处理；代码块和行内代码里的不处理）。写一个函数 `unwrapCloze(md: string): string` 并测试。

各格式：

- **md**：照 `prototype/app.js` 第 1865–1874 行（`exportDialog` 里的 `build`）：第一行 `# 标题`、空行；目录 `#` 的个数 = `min(6, level + 1)`；问答卡 `**Q:** 问题`、空行、提示非空时 `> 提示：提示` 和空行、`**A:** 答案`、空行、`---`、空行；笔记卡 内容、空行、`---`、空行；主题卡 `**标题**`、空行、内容、空行、`---`、空行。卡片集介绍非空时放在标题下面一段。
- **html**：完整的 HTML 文档（`<!doctype html>`、`<meta charset="utf-8">`、`<title>`），标题 `<h1>`，介绍 `<p>`，目录 `<h2>`～`<h6>`（`min(6, level + 1)`），每张卡片一个 `<section class="card">`：问答卡问题、提示（`<div class="hint">`）、`<hr>`、答案；笔记卡内容；主题卡标题 + 纯文本内容。内容用 `renderMarkdown`（`@bnki/shared/markdown`）。`<style>` 内联一份简单样式（卡片有边框、圆角、间距；`.cloze` 在 `keep` 时显示为蓝色下划线空白、文字透明，`answer` 时不会出现 `.cloze`；`@media print` 时卡片不跨页 `break-inside: avoid`），并用 `<link rel="stylesheet">` 引入 KaTeX 的 CSS（`https://cdn.jsdelivr.net/npm/katex@<package.json 里 katex 的版本>/dist/katex.min.css`）。图片：把 `src="/media/<文件名>"` 换成 `data:` URL（读 `ctx.mediaDir` 里的文件，按扩展名给 mime；文件不存在就保持原样）。`inline=1` 时在 `</body>` 前加 `<script>window.onload=()=>window.print()</script>`。
- **csv**：第一行表头 `目录,类型,问题/内容,提示,答案`，每张卡片一行：目录 = 卡片所在最近一级目录的标题（没有为空），类型 = `CARD_TYPE_NAMES`，后三列是 Markdown 原文（按 `cloze` 处理过）。字段含逗号、双引号、换行时用双引号包住，内部双引号写成 `""`。行分隔 `\r\n`。整个内容前加 UTF-8 BOM（`﻿`），方便 Excel 打开。
- **json**：`{ version: 1, title, description, exportedAt: <ctx.now()>, items: [...] }`，目录项 `{ kind: 'section', level, title }`，卡片项 `{ kind: 'card', cardType, color, front, hint, back }`（按 `cloze` 处理过）。两个空格缩进。

测试（`export.test.ts`，`buildApp({ dataDir: <临时目录>, memory: true })`，直接用 `ctx.db` 插入卡片集和 items）：准备卡片集 `测试集`：目录 A(1)、问答卡 q1（`front: '问{{答}}'`、`hint: '提'`、`back: '答案'`）、目录 B(1)、笔记卡 n1（`front: '进程是 {{资源}} 的单位 \\{{x}} `{{c}}`'`）、目录 B1(2)、笔记卡 n2。

- `unwrapCloze('a {{b}} \\{{c}} `{{d}}`')` → `'a b \\{{c}} `{{d}}`'`；代码块里的 `{{x}}` 保留。
- md 默认：包含 `# 测试集`、`## A`、`**Q:** 问{{答}}`、`> 提示：提`、`**A:** 答案`、`### B1`；`Content-Disposition` 含 `filename*=UTF-8''`，解码后是 `测试集.md`。
- md `cloze=answer`：包含 `**Q:** 问答`、`进程是 资源 的单位`。
- `sections=B`：不含 `问{{答}}`，含 n1、n2；`sections=B1`：只有 n2 和 `B1`。
- html：以 `<!doctype html>` 开头，含 `class="cloze"`；`cloze=answer` 时不含 `class="cloze"`；`inline=1` 时没有 `Content-Disposition`、含 `window.print`；在 `ctx.mediaDir` 写一个 `ab.png`、卡片里写 `![](media/ab.png)` 时，输出含 `src="data:image/png;base64,`。
- csv：以 BOM 开头，表头正确，含逗号的内容被引号包住，q1 那一行的目录列是 `A`、n2 那一行是 `B1`。
- json：`JSON.parse` 后 `items.length` 是 6，第一项 `{ kind: 'section', level: 1, title: 'A' }`。
- `format=pdf` → 400；卡片集不存在 → 404。

```sh
npx vitest run --project server src/routes/export.test.ts
```

## 第二步：导出对话框 `web/src/dialogs/ExportDialog.tsx`

props `{ deckId, onClose }`。`Modal light`，宽 520px，`DialogHead` 标题 `导出`。

- 格式（分段按钮）：Markdown、HTML、CSV、JSON。
- 挖空（分段按钮）：保留挖空、显示答案。CSV、JSON 也适用。
- 范围：`全部` / `选中目录` 两个分段按钮；选 `选中目录` 时下面列出卡片集的目录（`useItems(deckId)` 里的目录，按级别缩进，`.opt-list` 里的 `.opt` 多选样式），没选任何目录时下载按钮禁用。
- 底部：`取消`；格式是 HTML 时多一个 `打印 / 存为 PDF` 按钮（`window.open(api.io.exportUrl(deckId, { …, inline: 1 }), '_blank')`）；`下载` 按钮：创建一个 `<a href={exportUrl} download>` 并点击，然后关闭对话框。

测试（`ExportDialog.test.tsx`，`vi.stubGlobal('fetch', …)` 返回 items（目录 A、B 和两张卡片）、`QueryClientProvider` 包住）：默认点 `下载` → 创建的链接 `href` 是 `/api/export/d1?format=md&cloze=keep`（参数顺序可以不同，用 `URL` 解析后断言）；选 `CSV`、`显示答案`、`选中目录`、点 `B` 后下载 → `format=csv`、`cloze=answer`、`sections=B`；选中目录但一个都没选时 `下载` 按钮是 disabled。监听链接点击可以用 `vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { … this.href … })`。

```sh
npx vitest run --project web src/dialogs/ExportDialog.test.tsx
```

## 最后一步：收尾检查

```sh
npx vitest run --project server src/routes/export.test.ts && npx vitest run --project web src/dialogs/ExportDialog.test.tsx && npx tsc -p server --noEmit && npx tsc -p web --noEmit
```

通过的标准：这两个测试文件全部通过；类型检查没有错误（如果类型错误只出在本任务以外的文件里，在结果里写明是哪个文件）；只改了上面列出的文件。全部通过后最后一行输出 `DONE`。
