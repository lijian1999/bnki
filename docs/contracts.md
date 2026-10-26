# bnki 接口约定

所有任务共用。名字（路径、字段、函数名）必须一字不差。数据类型的定义在 `shared/src/types.ts`，常量和默认设置在 `shared/src/constants.ts`，复习调度在 `shared/src/scheduler.ts`（已实现、已测试，直接用，不要改）。

## 1. 目录

| 路径 | 内容 |
|---|---|
| `shared/src/` | 前后端共用：`types.ts`、`constants.ts`、`scheduler.ts`、`markdown/`、`importText.ts`。包名 `@bnki/shared`，入口 `shared/src/index.ts` |
| `server/src/` | Fastify + SQLite。`db.ts` 建表，`mappers.ts` 行映射，`settings.ts` 设置读写，`app.ts` 应用工厂，`routes/*.ts` 各组路由 |
| `web/src/` | React 前端。`store.ts` 全局弹窗状态，`api.ts` 请求函数，`queries.ts` 查询钩子，`ui/` 通用组件，`pages/` 页面，`editor/` 编辑器，`study/` 学习，`dialogs/` 对话框 |
| `prototype/` | HTML 原型（只读）。界面结构、类名、文案以它为准 |

导入共享代码：`import { ... } from '@bnki/shared'`；markdown 模块：`import { ... } from '@bnki/shared/markdown/index'`。

## 2. 服务端约定

- 路由模块：`server/src/routes/<名>.ts` 默认导出 `async function register(app: FastifyInstance, ctx: Ctx)`。`Ctx` 见 `server/src/app.ts`。**每次请求都从 `ctx.db` 取数据库连接**（恢复备份会替换它），当前时间用 `ctx.now()`。
- 错误：抛 `server/src/util.ts` 里的 `notFound()` / `badRequest(msg)`，统一返回 `{ error: 'not_found' | 'bad_request', message }`，状态码 404 / 400。
- ID 用 `newId()`（`server/src/util.ts`）。
- 行映射用 `server/src/mappers.ts`：`rowToFolder`、`rowToDeck`、`rowToItem`（卡片带 `state`）、`rowToState`、`saveState`；查卡片时用 `SELECT ${ITEM_COLUMNS} FROM items i LEFT JOIN card_states s ON s.card_id = i.id`。
- 设置用 `server/src/settings.ts` 的 `getSettings(db, ctx.dataDir)`、`putSettings(db, patch, ctx.dataDir)`。
- 学习设置：`resolveStudyCfg(deck.studyCfg, settings)`；调度参数：`schedCfgFor(settings, resolved)`（都在 `@bnki/shared`）。
- 测试：`server/src/routes/<名>.test.ts`，用 `buildApp({ dataDir: <临时目录>, memory: true, now: () => 固定时间 })` 加 `app.inject(...)`。
- 学习日的 key：`'YYYY-MM-DD'`，由 `dayStart(ts, settings.dayHour)` 对应的本地日期得到。

## 3. HTTP API（JSON）

请求、响应都是 JSON（媒体上传、导出除外）。下文 `→` 后是成功时的响应体。

### 3.1 分类

| 方法 路径 | 请求 | 响应 / 行为 |
|---|---|---|
| `GET /api/folders` | | `Folder[]`，按 `position` 升序 |
| `POST /api/folders` | `{ name }` | `Folder`，`position` = 当前最大 + 1 |
| `PATCH /api/folders/:id` | `{ name?, position? }` | `Folder` |
| `DELETE /api/folders/:id` | | `{ ok: true }`。分类里的卡片集全部进回收站（`deleted_at = now`，`folder_id = null`），再删分类 |

### 3.2 卡片集

| 方法 路径 | 请求 | 响应 / 行为 |
|---|---|---|
| `GET /api/decks?view=&folder=&sort=&q=` | `view`: `all`（默认）\| `recent` \| `trash`；`folder`: 分类 id；`sort`: `DeckSort`，默认 `updated`；`q`: 标题包含（不区分大小写） | `DeckSummary[]`，规则见 3.2.1 |
| `GET /api/decks/:id` | | `DeckSummary`（回收站里的也能取） |
| `POST /api/decks` | `{ title?, folderId? }` | `DeckSummary`，`title` 默认 `无标题卡片集` |
| `PATCH /api/decks/:id` | `{ title?, description?, folderId?, cover?, pinned?: boolean, studyCfg?, displayCfg? }` | `DeckSummary`。`studyCfg`、`displayCfg` 整体替换。改 `title`、`description`、`cover` 时刷新 `updatedAt`。`pinned: true` 设 `pinnedAt = now`，`false` 设 null |
| `POST /api/decks/:id/open` | | `{ ok: true }`，`opened_at = now` |
| `POST /api/decks/:id/forget-recent` | | `{ ok: true }`，`opened_at = null`（“从最近列表中删除”） |
| `DELETE /api/decks/:id` | | `{ ok: true }`，进回收站 |
| `POST /api/decks/:id/restore` | | `DeckSummary`，`deleted_at = null`；原分类已不存在时 `folderId = null` |
| `DELETE /api/decks/:id/purge` | | `{ ok: true }`，物理删除卡片集、它的 items、card_states；`review_logs`、`edit_logs` 保留 |
| `DELETE /api/trash` | | `{ ok: true }`，清空回收站（逐个 purge） |
| `POST /api/decks/:id/duplicate` | | `DeckSummary`。新卡片集标题 `<原标题> 副本`，同分类，复制全部未删除 items（新 id，顺序不变），不复制学习进度 |
| `POST /api/decks/:id/reset-progress` | | `{ ok: true }`。删除该集所有卡片的 card_states，每张有状态的卡写一条 `review_logs`（`kind = 'reset'`） |

#### 3.2.1 列表规则

- `all`：未删除；有 `folder` 时只取该分类。先按置顶（`pinnedAt` 非空的在前，`pinnedAt` 大的在前），再按 `sort`：
  - `name`：标题升序（`localeCompare(b, 'zh-CN')`）
  - `updated` / `created` / `studied`：对应时间降序，空值在最后
  - `next_due`：`counts.nextDue` 升序，空值在最后
  - `card_count` / `fresh_count`：`counts.total` / `counts.fresh` 降序
- `recent`：未删除且 `openedAt` 非空，按 `openedAt` 降序，最多 50 个，不考虑置顶和 `sort`。
- `trash`：已删除，按 `deletedAt` 降序。
- `counts`（`DeckCounts`）：只算未删除的卡片。`fresh` = `isNew(state)`；`due` = `isDue(state, schedCfg, now)`，`schedCfg` 用该卡片集自己的复习模式（`schedCfgFor(settings, resolveStudyCfg(deck.studyCfg, settings))`）；`learned = total - fresh`；`pct = total ? Math.round(learned / total * 100) : 0`；`nextDue` = 未掌握且 `state > 0` 的卡片里最小的 `due`，没有就是 null。

### 3.3 目录和卡片（items）

| 方法 路径 | 请求 | 响应 / 行为 |
|---|---|---|
| `GET /api/decks/:id/items` | | `Item[]`，未删除，按 `position` 升序；卡片带 `state` |
| `GET /api/items/:id` | | `Item`（带 `state`）。条目或所在卡片集已删除时 404。卡片链接 `bnki://card/<id>` 用它找所在卡片集 |
| `POST /api/items` | `{ deckId, kind, afterId?, level?, title?, cardType?, front?, hint?, back?, color? }` | `Item`。位置：`afterId` 省略 = 末尾；`afterId: null` = 最前面；否则紧跟在 `afterId` 之后。默认值：目录 `level 1`、`title '新目录'`；卡片 `cardType 'note'`、`front/hint/back ''`、`color 'default'`。新建卡片写 `edit_logs`（`create`）。刷新卡片集 `updatedAt` |
| `PATCH /api/items/:id` | `{ title?, level?, collapsed?, cardType?, front?, hint?, back?, color? }` | `Item`。卡片内容（`cardType/front/hint/back`）有变化时写 `edit_logs`（`update`）；编辑器边打字边自动保存，同一张卡最近一条日志是 10 分钟内的 `update` 就不再写新的。除了只改 `collapsed`，都刷新卡片集 `updatedAt` 和本项 `updatedAt` |
| `POST /api/items/delete` | `{ ids: ID[] }` | `{ ok: true }`，软删除（`deleted_at = now`）；卡片写 `edit_logs`（`delete`）。删目录只删标题，下面的卡片保留 |
| `POST /api/items/restore` | `{ ids: ID[] }` | `{ ok: true }`，撤销删除（`deleted_at = null`，位置不变） |
| `POST /api/items/move` | `{ ids: ID[], afterId: ID \| null, deckId?: ID }` | `{ ok: true }`。把 `ids`（按给定顺序）移到目标卡片集（默认原卡片集）里 `afterId` 之后，`afterId: null` = 最前面，`afterId` 不在目标卡片集里时放末尾。只改 `position`（和 `deck_id`），card_states 跟着卡片走 |
| `POST /api/items/:id/duplicate` | | `Item`，复制一项插在它后面，不复制学习进度 |

位置用小数：插在 a、b 之间取 `(a + b) / 2`；末尾取最大 + 1；最前面取最小 - 1。

### 3.4 学习

| 方法 路径 | 请求 | 响应 / 行为 |
|---|---|---|
| `POST /api/study/:deckId/session` | `{ content?: StudyContent }` | `{ label: string, queue: QueueEntry[], cards: CardItem[] }`，规则见 3.4.1。`label` = `CONTENT_NAMES[content]`。`cards` 是队列里涉及的卡片（每张一次） |
| `POST /api/study/review` | `{ cardId, rating, durationMs?, practice?: boolean }` | `{ state: CardState \| null, label: string, requeue: boolean }`，规则见 3.4.2 |
| `POST /api/study/manual` | `{ cardId, action: 'due' \| 'master' \| 'unmaster' \| 'forget', due?: number }` | `{ state: CardState \| null }`，规则见 3.4.3 |
| `GET /api/study/preview/:cardId` | | `{ previews: Record<number, string> }`，`previews(state, now, schedCfg, settings.easyButton ? 4 : 3)` |

#### 3.4.1 生成队列

输入：卡片集未删除的 items（按 position），`cfg = resolveStudyCfg(deck.studyCfg, settings)`，`content = 请求里的 content ?? cfg.content`，`sc = schedCfgFor(settings, cfg)`。

1. 卡片所在目录：从前往后扫 items，维护目录栈（遇到目录时先弹出栈里 `level >= 它` 的，再压入它）；每张卡片的目录路径 = 当时栈里所有目录 id。
2. 筛选：`cfg.sections` 非空时，只留目录路径和 `cfg.sections` 有交集的卡片；`cfg.colors` 非空时，只留 `color` 在其中的卡片。
3. 今天已学数量：今天学习日（`dayStart(now, dayHour)` 起）里该卡片集 `kind = 'grade'` 的日志，按 `card_id` 去重；`state = 0`（评分前是新卡）的算新学数，其余算复习数。`freshLeft = max(0, plan.newPerDay - 新学数)`，`dueLeft = max(0, plan.reviewPerDay - 复习数)`。
4. `due` = 筛选后 `isDue(state, sc, now)` 的卡片；`order === 'due_first'` 时按 `state.due` 升序。取前 `dueLeft` 张。
5. `fresh` = 筛选后 `isNew(state)` 的卡片（卡片集顺序），取前 `freshLeft` 张。
6. 按 `content` 组合：`new` → fresh；`review` → due；`all` → 筛选后所有未掌握的卡片（卡片集顺序，不受上限）；`recommend` → `[...due, ...fresh]`。
7. `order === 'random'` 时打乱整个列表。
8. 每项 `{ cardId, rep: false, flipped }`：只有问答卡（`qa`）可能翻转：`direction` 为 `back` 时 `true`，`random` 时随机，其余 `false`。

#### 3.4.2 评分

- `practice: true`：只写一条 `review_logs`（`kind = 'practice'`、`rating`），不改状态，返回当前状态，`label = ''`、`requeue = false`。
- 否则：`r = schedule(当前 state, rating, now, sc)`，用 `saveState` 写入 `r.state`（`mastered` 为 false），写一条 `review_logs`：`kind 'grade'`、`rating`、`state` = 评分**前**的状态值（没有记录时为 0）、`due/stability/difficulty/elapsed_days/scheduled_days` = 评分后的值、`reviewed_at = now`、`duration_ms`。返回 `{ state: r.state, label: r.label, requeue: r.requeue }`。
- 两种情况都设卡片集 `studied_at = now`。`rating` 只能是 1–4，否则 400。

#### 3.4.3 手动

- `due`：`manualDue(state, due, now, sc)` 写入；日志 `kind 'manual'`。`due` 缺失或不是数字时 400。
- `master`：状态 `mastered = 1`（没有状态时用 `newCardState()` 加 `mastered: true`）；日志 `kind 'master'`。
- `unmaster`：`mastered = 0`；日志 `kind 'unmaster'`。
- `forget`：删除 card_states 行（回到新卡）；日志 `kind 'reset'`；返回 `{ state: null }`。

### 3.5 统计

`GET /api/stats?range=7|30|90`（默认 7）→

```ts
{
  today: number;          // 今天学习日里评过分的卡片数（kind = 'grade'，按卡片去重）
  total: number;          // 累计评过分的卡片数（kind = 'grade'，按卡片去重）
  deckCount: number;      // 未删除的卡片集数
  cardCount: number;      // 未删除卡片集里未删除的卡片数
  streak: number;         // 连续学习天数：今天有评分就从今天往前数，否则从昨天往前数
  best: { days: number; start: string | null; end: string | null }; // 最长连续记录（近 400 天）
  monthDays: number;      // 本月（自然月）学习天数
  calendar: Record<string, number>; // 'YYYY-MM-DD' → 当天 grade 次数（近 400 天，只含 > 0 的天）
  series: { date: string; reviews: number; edits: number }[]; // 最近 range 天（含今天），按日期升序；edits = edit_logs 条数
  forecast: { date: string; count: number }[]; // 未来 30 天（从今天起）每天到期的未掌握卡片数（未删除卡片集）；今天包含已逾期的
  retention: { actual: number | null; target: number; samples: number }; // 近 30 天、评分前是复习状态（state = 2）的 grade 日志里 rating >= 2 的比例；samples 是条数，为 0 时 actual = null
}
```

“学习了”= 当天至少一条 `kind = 'grade'` 的日志。日期一律是学习日（按 `dayHour` 换日）。

### 3.6 设置

- `GET /api/settings` → `Settings`
- `PUT /api/settings`，请求体是 `Partial<Settings>` → 更新后的 `Settings`；不合法 400。实现直接调用 `getSettings` / `putSettings`。

### 3.7 媒体

- `POST /api/media`：`multipart/form-data`，字段名 `file`，只接受 `image/*`。内容 sha256 的前 16 位十六进制作文件名，扩展名按 mime（png/jpg/gif/webp/svg，其余用原文件扩展名）。存到 `ctx.mediaDir`，写 `media` 表（同 hash 已存在就不重复写）。→ `{ path: 'media/<hash>.<ext>' }`
- `GET /media/<文件名>`：静态文件（`app.ts` 已挂好）。
- Markdown 里图片写 `![](media/<hash>.<ext>)`；渲染时变成 `/media/<hash>.<ext>`。

### 3.8 导入、导出

- `POST /api/import/text`：`{ deckId, text, format: 'tsv' | 'csv', firstColumnIsSection: boolean }` → `{ cards: number, sections: number }`。用 `shared/src/importText.ts` 的 `parseImportText` 解析，追加到卡片集末尾。
- `POST /api/import/markdown`：`{ deckId, text, split: 'item' | 'paragraph' | 'hr' }` → `{ cards: number, sections: number }`。
- `POST /api/import/apkg`：multipart，字段 `file`（`.apkg`），查询参数 `deckId` → `{ cards: number, sections: number }`。
- `GET /api/export/:deckId?format=md|html|csv|json&cloze=keep|answer&sections=<id,id>&inline=1`：文件下载，`Content-Disposition: attachment; filename*=UTF-8''<urlencode(标题.扩展名)>`；`inline=1` 时不加这个头（HTML 打印用）。

### 3.10 搜索

- `GET /api/search?q=<关键词>&limit=<1–100，默认 30>` → `{ id, deckId, deckTitle, cardType, front, text }[]`：在所有未删除卡片集的未删除卡片里，按正面、提示、背面去掉 Markdown 标记后的纯文本搜（忽略大小写和空白），最近修改的在前。`front` 是正面 Markdown 原文，`text` 是纯文本全文。空关键词返回 `[]`。

### 3.9 备份

- `GET /api/backups` → `{ name: string, createdAt: number, size: number }[]`，新的在前。
- `POST /api/backup` → `{ name }`：在 `ctx.backupsDir/<YYYYMMDD-HHmmss>/` 下用 `VACUUM INTO` 生成 `bnki.sqlite`，并复制 `media/` 目录。
- `POST /api/restore`：`{ name }` → `{ ok: true }`：先做一次备份（名字加后缀 `-before-restore`），再用备份里的数据库和 media 覆盖当前的，调用 `ctx.reopen()`。

## 4. Markdown（`shared/src/markdown/`）

入口 `shared/src/markdown/index.ts`：

```ts
export function createMd(opts?: { highlight?: boolean }): MarkdownIt; // 带全部扩展规则的实例；highlight 默认 true
export function renderMarkdown(src: string, opts?: { editor?: boolean }): string; // 块级渲染，结果已按白名单清洗
export function renderInline(src: string): string; // 行内渲染（目录标题、导图节点）
export function plainText(src: string): string; // 去掉标记的纯文本（搜索、朗读、导图）
export function countCloze(src: string): number; // 挖空个数（代码块、行内代码里的不算）
```

渲染出的 HTML 结构（前端 CSS 和编辑器都依赖它）：

| 语法 | HTML |
|---|---|
| `{{内容}}` | `<span class="cloze" data-i="N">内容渲染结果</span>`，N 从 0 起按出现顺序（一次 render 内连续编号，问答卡的正反面分别 render） |
| `==x==` | `<mark>x</mark>` |
| `<mark data-c="red" data-s="wavy">x</mark>` 等白名单标签 | 原样输出 |
| `$x$` | `<span class="math" data-tex="x" data-display="0">KaTeX 输出</span>` |
| `$$…$$` | `<div class="math-block"><span class="math" data-tex="…" data-display="1">KaTeX 输出</span></div>` |
| 代码块 | `<pre><code class="language-xx">高亮后的 HTML</code></pre>`；`editor: true` 时不高亮，内容是转义后的原文 |
| `![](media/a.png)` | `<img src="/media/a.png" alt="">` |
| `- [ ] x` / `- [x] x` | `<li class="task"><input type="checkbox" disabled> x</li>`（勾选的带 `checked`） |
| 链接 | `<a href="…" target="_blank" rel="noopener">`；`bnki://card/<id>` → `<a href="#" data-card-link="<id>">` |

白名单内联 HTML（其余标签一律转义成文本）：`<u>` `</u>` `<br>`；`<mark>`，可带 `data-c="yellow|green|blue|red|purple"`、`data-s="line|wavy"`；`</mark>`；`<span data-tc="red|blue|green|grey">`、`<span data-fs="12|16|22|26">`、`</span>`。

## 5. 前端约定

- 路由（`react-router-dom`，见 `web/src/App.tsx`）：`/` 全部卡片集、`/recent`、`/trash`、`/folder/:folderId`、`/deck/:deckId`、`/stats`、`/settings`。
- 全局弹窗状态：`web/src/store.ts` 的 `useUI`（`openEditor`、`openStudy`、`openDialog(kind, deckId)`）。弹窗组件挂在 `App.tsx`，页面只调用动作。
- 对话框组件：默认导出，props 为 `{ deckId: string; onClose: () => void }`，由 `web/src/dialogs/DeckDialogs.tsx` 按 kind 挂载。
- 请求：`web/src/api.ts` 导出 `api` 对象，每个 HTTP 接口一个函数；查询钩子在 `web/src/queries.ts`。查询 key：`['folders']`、`['decks', params]`、`['deck', id]`、`['items', deckId]`、`['settings']`、`['stats', range]`、`['backups']`。改动后用 `invalidateDeck(qc, deckId)` 一次刷新 `['decks']`、`['deck', id]`、`['items', id]`。
- 通用 UI（`web/src/ui/`）：`toast(msg, action?)`（`ui/toast.ts`）、`openMenu(anchor, items, opts?)`（`ui/menu.ts`）、`Modal` / `DialogHead`（`ui/Modal.tsx`）、`confirmDialog(...)` / `promptDialog(...)`（`ui/dialogs.ts`）、`Swatches`（`ui/Swatches.tsx`）。toast、菜单、确认框、输入框由 `ui/Overlays.tsx` 统一渲染（已挂在 `App.tsx`）。
- 样式：`web/src/styles/app.css`（从原型复制来的），类名沿用原型。需要新样式时追加到这个文件末尾。
- 界面文字全部中文，沿用原型文案；原型里的说明性文字、P1/P2 标签、占位入口不要搬（见 design.md §10.1）。
