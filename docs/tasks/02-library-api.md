# 任务 02：卡片集、分类、目录和卡片的 HTTP 接口

先读 `AGENTS.md`，再读接口约定 `docs/contracts.md` 第 2 节、3.1–3.3 节。本任务只改这些文件：`server/src/routes/library.ts`（现在是空壳，替换掉）、新建 `server/src/routes/library.test.ts`，需要的话新建 `server/src/repo/library.ts` 放查询函数。不要改别的文件。

## 背景

`server/src/app.ts` 已经挂载了 `routes/library.ts` 的默认导出。数据库表在 `server/src/db.ts`，行映射在 `server/src/mappers.ts`，设置在 `server/src/settings.ts`，ID 和错误在 `server/src/util.ts`，计数要用的 `isNew`、`isDue`、`resolveStudyCfg`、`schedCfgFor` 在 `@bnki/shared`。

## 第一步：分类接口

按 3.1 实现 `GET/POST /api/folders`、`PATCH/DELETE /api/folders/:id`。`name` 去掉首尾空白后为空时 400。分类不存在时 404。删除分类时，分类里**未删除**的卡片集进回收站（`deleted_at = now`、`folder_id = null`），已在回收站里的卡片集只把 `folder_id` 置空。

测试（`library.test.ts`，用 `buildApp({ dataDir: <临时目录>, memory: true, now: () => T })` 和 `app.inject`；`T` 是一个固定时间戳，需要时间前进的用例自己改 `now`）：
- 新建两个分类，列表按 position 顺序返回；改名后返回新名字；空名字 400。
- 删除有两个卡片集的分类：两个卡片集出现在 `view=trash` 里，`folderId` 为 null；分类列表里没有它了。

```sh
npx vitest run --project server src/routes/library.test.ts
```

## 第二步：卡片集接口

按 3.2 和 3.2.1 实现所有卡片集接口。要点：

- `DeckSummary` = `rowToDeck(row)` 加 `counts`。计数规则见 3.2.1：每个卡片集用它自己的学习设置算 `due`（`schedCfgFor(settings, resolveStudyCfg(deck.studyCfg, settings))`，`settings = getSettings(ctx.db, ctx.dataDir)`），时间用 `ctx.now()`。
- `PATCH` 的 `folderId` 指向不存在的分类时 400；`title` 去掉首尾空白后为空时 400。
- 卡片集不存在时 404。
- `POST /api/decks/:id/duplicate` 复制时 items 的相对顺序不变（复制 position 原值即可）。
- `DELETE /api/decks/:id/purge` 要删 `card_states`（属于该卡片集卡片的）和 `items`，再删 deck。

测试：
- 新建卡片集，默认标题 `无标题卡片集`；`GET /api/decks` 里能看到，`counts` 全是 0、`nextDue` 为 null。
- 排序：三个卡片集分别设置不同标题、置顶其中一个，`sort=name` 时置顶的排第一，其余按标题升序；`sort=card_count` 按卡片数降序。
- `q` 过滤标题（大小写不敏感）。
- `folder` 过滤。
- `recent`：调 `open` 的才出现，按打开时间降序；`forget-recent` 后消失。
- 删除 → 出现在 `trash`、不在 `all`；`restore` 后回到 `all`；`purge` 后 `GET /api/decks/:id` 返回 404，且 `items`、`card_states` 表里没有它的行（直接用 `ctx.db` 查）。
- `DELETE /api/trash` 清空回收站。
- 计数：往卡片集加 3 张卡，用 `saveState`（`server/src/mappers.ts`）给一张写入 `state: 2, due: T - 1000` 的状态、给一张写入 `state: 2, due: T + 30 天` 的状态 → `counts` 为 `{ total: 3, fresh: 1, due: 1, learned: 2, pct: 67, nextDue: T - 1000 }`。再把第一张标记 `mastered: true` → `due` 为 0。
- `duplicate`：新卡片集标题加“ 副本”，卡片数相同，卡片 id 都不同，新卡片都没有 `state`。
- `reset-progress`：之后所有卡片 `state` 为 null，`review_logs` 里多了 `kind = 'reset'` 的行。

```sh
npx vitest run --project server src/routes/library.test.ts
```

## 第三步：目录和卡片接口

按 3.3 实现。要点：

- 位置规则见 3.3 末尾。`afterId` 指向不存在或不属于该卡片集的项时，`POST /api/items` 返回 400。
- `level` 只能是 1–5，`cardType` 只能是 `note | qa | topic`，`color` 只能是 `CARD_COLORS` 里的 key，否则 400。
- `POST /api/items/move`：先把要移动的项从目标序列里拿掉，再按 `ids` 的顺序依次放在 `afterId` 之后（第一个在 `afterId` 和它原来的下一项之间，后面的依次排在前一个之后，仍在原来的下一项之前）。`deckId` 不同时同时改 `deck_id`，两个卡片集的 `updatedAt` 都刷新。
- 返回的卡片带 `state`（用 `ITEM_COLUMNS` 那条 LEFT JOIN）。

测试：
- 依次新建目录 A、卡片 1、卡片 2，`GET items` 顺序是 A、1、2；`afterId: null` 新建的卡片排在最前；`afterId: A` 新建的卡片排在 A 和 1 之间。
- 默认值：新目录 `level 1`、`title '新目录'`；新卡片 `cardType 'note'`、`color 'default'`、`front ''`、`state null`。
- `PATCH` 改 `front` → 返回新内容，`edit_logs` 有一条 `update`；只改 `collapsed` → 卡片集 `updatedAt` 不变。
- 非法 `level: 6`、`color: 'pink'` → 400。
- `delete` 两张卡 → 列表里没有了，`edit_logs` 有两条 `delete`；`restore` 后回来，顺序和原来一样。
- `move`：顺序 [A, 1, 2, 3]，`move { ids: [3, 1], afterId: A }` → [A, 3, 1, 2]；`afterId: null` → 移到最前；移到另一个卡片集末尾后，原卡片集没有了、新卡片集有，并且之前写入的 `card_states` 还在。
- `duplicate` 一张卡 → 新卡紧跟在原卡后面，内容相同，`state` 为 null。

```sh
npx vitest run --project server src/routes/library.test.ts
```

## 最后一步：收尾检查

```sh
npx vitest run --project server && npx tsc -p server --noEmit
```

通过的标准：server 下全部测试通过；类型检查没有错误；只改了上面列出的文件。全部通过后最后一行输出 `DONE`。
