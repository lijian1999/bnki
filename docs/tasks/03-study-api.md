# 任务 03：学习、统计、设置的 HTTP 接口

先读 `AGENTS.md`，再读接口约定 `docs/contracts.md` 第 2 节、3.4–3.6 节。本任务只改这些文件：`server/src/routes/study.ts`、`server/src/routes/stats.ts`、`server/src/routes/settings.ts`（现在都是空壳，替换掉），新建 `server/src/routes/study.test.ts`、`server/src/routes/stats.test.ts`、`server/src/routes/settings.test.ts`，需要的话新建 `server/src/repo/study.ts` 放查询函数。不要改别的文件。

## 背景

复习调度已经写好在 `shared/src/scheduler.ts`（`schedule`、`previews`、`manualDue`、`newCardState`、`isNew`、`isDue`、`dayStart`、`schedCfgFor`），学习设置合并用 `resolveStudyCfg`（`shared/src/constants.ts`）。本任务只负责读写数据库、按约定组合这些函数。卡片集和卡片的增删改接口由另一个任务同时在写（`routes/library.ts`），**本任务的测试不要调用 `/api/decks`、`/api/items`**：在测试文件里写一个辅助函数，直接用 `ctx.db` 插入 `decks`、`items` 行（列见 `server/src/db.ts`），需要已有状态的卡片用 `saveState`（`server/src/mappers.ts`）写入。

测试一律用 `buildApp({ dataDir: <临时目录>, memory: true, now: () => clock })`，`clock` 是测试里的变量，取一个固定的本地时间，例如 `new Date(2026, 9, 22, 15, 30).getTime()`，需要时间前进时改它。

## 第一步：设置接口（`routes/settings.ts`）

按 3.6 实现，直接调 `getSettings` / `putSettings`。

测试（`settings.test.ts`）：`GET` 返回的 `retention` 是 0.9、`dataDir` 等于 `ctx.dataDir`；`PUT { retention: 0.85, theme: 'dark' }` 后 `GET` 能读到；`PUT { retention: 2 }`、`PUT { foo: 1 }`、`PUT { dayHour: 3 }` 都是 400。

```sh
npx vitest run --project server src/routes/settings.test.ts
```

## 第二步：学习接口（`routes/study.ts`）

按 3.4、3.4.1、3.4.2、3.4.3 实现四个接口。补充：

- 卡片集或卡片不存在（或已删除）时 404；`content` 不是四种之一时 400。
- 评分、手动操作用的调度参数：卡片所在卡片集的 `schedCfgFor(settings, resolveStudyCfg(deck.studyCfg, settings))`。
- 队列里 `cards` 用 `rowToItem` 映射（带 `state`）。
- 随机打乱用 `Math.random`（测试里不断言随机顺序）。

测试（`study.test.ts`）：每个用例开始时先 `putSettings(ctx.db, { fuzz: false })`，否则间隔有随机抖动、文字断言不稳定。准备一个卡片集：目录 A（level 1）、卡片 c1、c2、目录 B（level 1）、卡片 c3（问答卡）、c4（颜色 `red`）。逐条：

1. 全是新卡，`session` 默认（推荐）→ 队列是 c1、c2、c3、c4，`label` 是 `系统推荐`，`cards` 有 4 张，`rep` 都是 false。
2. 学习设置 `sections: [B]` → 只有 c3、c4；`colors: ['red']` → 只有 c4。（学习设置直接写进 `decks.study_cfg` 列，JSON 字符串。）
3. `plan.newPerDay: 2` → 只有 c1、c2；再对 c1 评一次分（`review`）后重新生成 → 新卡只剩 1 个名额，队列是 c2。
4. 给 c1 写入 `state: 2, due: clock - 1 天` 的状态、给 c2 写入 `state: 2, due: clock + 10 天` → 推荐队列是 c1（复习）在前，然后 c3、c4（新卡）；`content: 'review'` 只有 c1；`content: 'new'` 是 c3、c4；`content: 'all'` 是 c1、c2、c3、c4。
5. `order: 'due_first'`：两张到期卡 due 不同，due 早的排前面。
6. `direction: 'back'` → c3 的 `flipped` 为 true，其余为 false。
7. 已掌握（`mastered: true`）的卡不出现在任何队列里。
8. `review { cardId: c1, rating: 3 }`（c1 是新卡）→ 返回的 `state.state` 为 2、`state.due` 大于 `clock`、`label` 是 `3天`、`requeue` 为 false；数据库 `card_states` 有 c1 的行；`review_logs` 有一条 `kind 'grade'`、`rating 3`、`state 0`；卡片集 `studied_at` 等于 `clock`。
9. `review { rating: 1 }` → `requeue` 为 true，`label` 以 `本轮再练·` 开头。
10. `review { practice: true, rating: 1 }` → 状态不变，日志 `kind 'practice'`。
11. `review { rating: 5 }` → 400；不存在的 cardId → 404。
12. `manual { action: 'due', due: clock + 7 天 }` → `state.due` 等于它；`master` → `state.mastered` 为 true，`unmaster` → false；`forget` → `state` 为 null，`card_states` 没有这行，日志里有 `reset`。
13. `preview` 新卡 → `previews` 有 1、2、3 三个键，`previews[3]` 是 `3天`；设置 `easyButton: true` 后有 4 个键。

```sh
npx vitest run --project server src/routes/study.test.ts
```

## 第三步：统计接口（`routes/stats.ts`）

按 3.5 实现。学习日的日期 key：`const d = new Date(dayStart(ts, dayHour))`，key 为 `YYYY-MM-DD`（本地年月日，月、日补零）。`series` 和 `forecast` 里的日期也用这个格式。

- `range` 只能是 7、30、90，否则 400。
- `best`：从 400 个学习日之前到今天逐日扫描，求最长的连续“学习了”的天数，`start` / `end` 是这段的首尾日期；一天都没学过时 `{ days: 0, start: null, end: null }`。
- `forecast`：第 0 天（今天）= `due < 明天学习日开始` 的未掌握、`state > 0` 卡片数（含逾期）；第 i 天 = `due` 落在第 i 个学习日内的数量。只算未删除卡片集里未删除的卡片。

测试（`stats.test.ts`）：直接往 `review_logs`、`edit_logs`、`items`、`card_states` 插行。

1. 空库 → `today 0`、`total 0`、`streak 0`、`best.days 0`、`series` 长度 7 且全是 0、`forecast` 长度 30、`retention.actual` 为 null、`retention.target` 0.9。
2. 今天、昨天、前天各插一条 grade 日志，大前天没有，再往前连续 5 天有 → `streak 3`、`best.days 5`；`calendar` 里今天的 key 值为 1。
3. 今天没有、昨天和前天有 → `streak 2`。
4. 今天同一张卡评了两次、另一张评了一次 → `today 2`。
5. 凌晨 3 点（`dayHour` 默认 4）的日志算前一天。
6. `range=30` → `series` 长度 30，最后一项是今天；`edit_logs` 今天 3 条 → 最后一项 `edits 3`。
7. `retention`：近 30 天、`state = 2` 的 grade 日志 4 条，rating 分别是 1、2、3、3 → `actual 0.75`、`samples 4`；`state = 0` 的不计入。
8. `forecast`：一张卡 due 是昨天（逾期）、一张是今天下午、一张是 3 个学习日之后 → `forecast[0].count 2`、`forecast[3].count 1`。
9. `range=8` → 400。

```sh
npx vitest run --project server src/routes/stats.test.ts
```

## 最后一步：收尾检查

```sh
npx vitest run --project server src/routes/settings.test.ts src/routes/study.test.ts src/routes/stats.test.ts src/app.test.ts && npx tsc -p server --noEmit
```

通过的标准：这四个测试文件全部通过；类型检查没有错误（如果类型错误只出在本任务以外的文件里，在结果里写明是哪个文件）；只改了上面列出的文件。全部通过后最后一行输出 `DONE`。
