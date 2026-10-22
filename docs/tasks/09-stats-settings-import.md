# 任务 09：统计页、系统设置页、导入对话框、快捷键对话框

先读 `AGENTS.md`，再读接口约定 `docs/contracts.md`（3.5、3.6、3.8、3.9、第 5 节）和设计文档 `docs/design.md` 的 §1.5–§1.7、§7。本任务只改这些文件：

- 替换空壳：`web/src/pages/StatsPage.tsx`、`web/src/pages/SettingsPage.tsx`、`web/src/dialogs/ImportDialog.tsx`、`web/src/dialogs/ShortcutsDialog.tsx`。
- 新建：`web/src/charts.tsx`（折线图、柱状图组件），测试 `web/src/pages/StatsPage.test.tsx`、`web/src/pages/SettingsPage.test.tsx`、`web/src/dialogs/ImportDialog.test.tsx`。
- 需要新样式时追加到 `web/src/styles/app.css` 末尾（不改已有规则）。

不要改别的文件。

## 背景

界面照原型还原：`prototype/app.js` 第 1813–1860 行（`importDialog`）、1911–1917 行（`shortcutsDialog`）、1919–2102 行（统计、设置），样式类名已在 `app.css` 里（`.page`、`.page-head`、`.stat-grid`、`.panel`、`.streak`、`.ring`、`.cal`、`.kpis`、`.kpi`、`.legend`、`.settings-wrap`、`.set-group`、`.set-row`、`.seg`、`.switch`、`.num-input`、`.kbd-table` 等）。原型的数据在内存里；正式版的数据来自接口。原型里这些**不要搬**：所有 `P1` / `P2` 标签，统计页底部“学习排行榜、收藏数已砍掉……”那行灰字，设置页“用自己的复习记录优化参数”那一行，朗读偏好里“AI 自然朗读砍掉”之类的说明，导入对话框里“放在 P1”的占位按钮。

用到的现成模块：`web/src/api.ts`、`web/src/queries.ts`（`useStats`、`useSettings`、`useSaveSettings`、`useBackups`、`useDeck`、`invalidateDeck`）、`web/src/ui/`（`Modal`、`DialogHead`、`toast`、`confirmDialog`）、`web/src/format.ts`、`@bnki/shared`（`chainPreview`、`schedCfgFor`、`resolveStudyCfg`、`DEFAULT_SETTINGS`）、`@bnki/shared/importText`（`parseImportText`，导入预览用）。

## 第一步：图表 `web/src/charts.tsx`

把原型的 `lineChart`、`barChart` 改写成 React 组件（输出同样的 SVG）：

```tsx
export function LineChart(props: { labels: string[]; series: number[][]; colors: string[] }): JSX.Element; // labels 是横轴文字（如 '10/18'）
export function BarChart(props: { values: number[]; labels: string[] }): JSX.Element;                     // 第 0 根橙色，其余蓝色
```

## 第二步：统计页 `StatsPage.tsx`

照原型 `statsHTML` / `bindStats`，数据来自 `useStats(range)`（`range` 是页面状态，默认 7）：

- 学习日历面板：连续天数环（`streak`，满 30 天为满环）、`最长连续学习 N 天`（`best.start`、`best.end` 非空时在后面用灰字显示 `2026.10.1 – 2026.10.5`）、`本月已学习 N 天`（`monthDays`）、当月月历（周一开头；某天的次数取 `calendar['YYYY-MM-DD']`，按原型分 `l1`/`l2`/`l3`，今天加 `today`，`title` 是 `N 次`）。
- 数据面板：`今日学习卡片`（`today`）、`累计学习卡片`（`total`）、`我的卡片集`（`deckCount`）、`我的卡片总数`（`cardCount`）。
- 学习与编辑曲线：`7天 / 30天 / 90天` 切换，图例照原型，`LineChart` 用 `series` 的 `reviews`、`edits`，横轴文字 `M/D`。
- 未来 30 天到期：`BarChart`，数据是 `forecast` 的 `count`，横轴每 5 天标一次（`今天`、`+5`、`+10`……），柱子的 `title` 是 `今天：N 张` / `N天后：N 张`。
- 记忆保持率面板（新增，放在到期预测下面，标题 `真实记忆保持率`）：`retention.actual` 非空时显示百分比（四舍五入到整数）和一行灰字 `近 30 天 N 次复习，目标 90%`（目标用 `retention.target`）；为空时显示灰字 `近 30 天还没有复习记录`。

## 第三步：系统设置页 `SettingsPage.tsx`

照原型 `settingsHTML`，数据来自 `useSettings()`，每次修改立刻 `useSaveSettings()(patch)`：

- 学习偏好：默认复习模式（按天 / 灵活）、每日新学上限、每日复习上限（数字，失焦或回车时保存，最小 1）、点击卡片空白处显示下一个挖空（开关）、卡片文字大小（小 / 默认 / 大 / 特大）。
- 记忆算法（FSRS）：目标记忆保持率（`range` 0.80–0.97，步长 0.01，标题里显示百分比，松手时保存）、下面一行灰字 `新卡一直点“记住了”时的间隔：<chainPreview 的结果用 → 连接>`（`chainPreview(schedCfgFor(settings, resolveStudyCfg(null, settings)), Date.now())`，用当前保持率实时算）、最大间隔（天）、灵活模式的短间隔（1 / 5 / 10 / 30 分钟）、新的一天开始于（0:00 / 2:00 / 4:00 / 6:00）、间隔随机抖动、显示第 4 个评分键“很简单”、“本轮再练”不改变记忆状态（开关，说明文字照原型）。
- 朗读：语速（`ttsRate`：0.8 / 1.0 / 1.2，分段按钮）、语言（`ttsLang`：`<select>`，选项 自动（空串）/ 中文 `zh-CN` / 英语 `en-US` / 日语 `ja-JP`）。
- 通用：连续新建卡片（开关，说明 `点“完成”后保存并继续新建下一张`）、外观（浅色 / 深色 / 跟随系统）。
- 数据：数据目录（`<code>` 显示 `settings.dataDir`，说明 `数据库和图片都存在这里`）；自动备份（说明 `每天第一次启动时备份，保留最近 14 份`，按钮 `立即备份` → `api.backups.create()`，toast `已备份：<name>`，刷新 `['backups']`）；从备份恢复（按钮 `选择备份…` → 打开一个 `Modal light`，标题 `从备份恢复`，列出 `useBackups()` 的每个备份：名字、`fmtMDHM(createdAt)`、大小（KB / MB），每行一个 `恢复` 按钮；点了先 `confirmDialog('从备份恢复', '当前数据会先自动备份一次，然后用「<name>」覆盖。', '恢复', true)`，确认后 `api.backups.restore(name)`，成功后关闭对话框、`queryClient.invalidateQueries()` 刷新全部数据、toast `已恢复`；没有备份时显示 `还没有备份`）。

## 第四步：导入对话框 `ImportDialog.tsx`

props `{ deckId, onClose }`。`Modal light`，宽 620px，标题 `导入卡片`。顶部分段：`文本 / 表格`、`Markdown 文件`。

- **文本 / 表格**（照原型 `importDialog`）：说明文字照原型；文本域（占位照原型）；`上传 CSV 文件` 按钮（选 `.csv,.tsv,.txt` 文件，读成文本放进文本域；扩展名是 `.csv` 时格式记为 `csv`，否则 `tsv`；直接粘贴的文字格式是 `tsv`）；开关“第一列是目录（相同目录名的卡片会归到同一个目录下）”；预览：用 `parseImportText(text, format, firstColumnIsSection)` 解析，`识别到 N 张卡片`，有卡片时预览前 5 张（照原型样式）。按钮 `取消`、`导入到末尾`（0 张时禁用）→ `api.io.importText({ deckId, text, format, firstColumnIsSection })`。
- **Markdown 文件**：说明 `一级到五级标题（#～#####）会变成目录，标题之间的内容按下面的规则切成卡片（都是笔记卡）。`；`选择 .md 文件` 按钮（读成文本放进文本域，也可以直接粘贴）；切分方式分段按钮：`每个列表项一张`（`item`）、`每段一张`（`paragraph`）、`用 --- 分隔`（`hr`），默认 `item`。按钮 `导入到末尾`（文本为空时禁用）→ `api.io.importMarkdown({ deckId, text, split })`。
- 导入成功：toast `已导入 N 张卡片`（目录数大于 0 时 `已导入 N 张卡片、M 个目录`），`invalidateDeck(qc, deckId)`，关闭。失败 toast `导入失败：<错误信息>`。

## 第五步：快捷键对话框 `ShortcutsDialog.tsx`

props `{ deckId, onClose }`（`deckId` 不用）。照原型 `shortcutsDialog` 的三张表（卡片管理、学习、编辑器），`Modal light` + `DialogHead('快捷键与操作')`。编辑器表里加一行 `挖空（另一个键）` → `⌘K`，学习表里 `编辑 / 朗读 / 关闭` 照原型。Windows 上把 `⌘` 显示成 `Ctrl`（`/Mac/.test(navigator.platform)` 判断）。

## 第六步：测试

都用 `vi.stubGlobal('fetch', …)` 按 URL 和方法返回数据并记录调用，`QueryClientProvider` 包住，同时渲染 `<Overlays />`。

`StatsPage.test.tsx`（`/api/stats?range=7` 返回一份数据：`streak 3`、`best { days: 5, start: '2026-10-01', end: '2026-10-05' }`、`today 4`、`series` 7 项、`forecast` 30 项、`retention { actual: 0.875, target: 0.9, samples: 8 }`）：显示 `3`（环里）、`最长连续学习`、`5`、`88%`；点 `30天` 后请求了 `/api/stats?range=30`。

`SettingsPage.test.tsx`（`/api/settings` 返回 `DEFAULT_SETTINGS` 加 `dataDir: '/tmp/bnki'`）：显示 `/tmp/bnki`；点外观的 `深色` → 收到 `PUT /api/settings`，body `{ theme: 'dark' }`；间隔预览那行包含 `→`；点 `立即备份` → 收到 `POST /api/backup`。

`ImportDialog.test.tsx`：在文本域输入 `问1\t答1\n问2`（`fireEvent.change`）→ 显示 `识别到 2 张卡片`；点 `导入到末尾` → 收到 `POST /api/import/text`，body `{ deckId: 'd1', text: '问1\t答1\n问2', format: 'tsv', firstColumnIsSection: false }`，出现 `已导入 2 张卡片`（接口返回 `{ cards: 2, sections: 0 }`）。切到 `Markdown 文件`，输入 `# 章\n- a\n- b`，点 `每段一张`、`导入到末尾` → 收到 `POST /api/import/markdown`，body 的 `split` 是 `paragraph`。

```sh
npx vitest run --project web src/pages/StatsPage.test.tsx src/pages/SettingsPage.test.tsx src/dialogs/ImportDialog.test.tsx
```

## 最后一步：收尾检查

```sh
npx vitest run --project web && npx tsc -p web --noEmit
```

通过的标准：web 下全部测试通过；类型检查没有错误（如果类型错误只出在本任务以外的文件里，在结果里写明是哪个文件）；只改了上面列出的文件。全部通过后最后一行输出 `DONE`。
