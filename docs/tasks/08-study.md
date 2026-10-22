# 任务 08：学习弹窗与学习设置

先读 `AGENTS.md`，再读接口约定 `docs/contracts.md`（3.3、3.4、第 4 节、第 5 节）和设计文档 `docs/design.md` 的 §1.4、§5。本任务只改这些文件：

- 替换空壳：`web/src/study/StudyModal.tsx`、`web/src/study/StudySettingsDialog.tsx`。
- 新建：`web/src/study/` 目录下的其他文件（怎么拆由你定），以及测试 `web/src/study/StudyModal.test.tsx`、`web/src/study/StudySettingsDialog.test.tsx`。
- 需要新样式时写进新建的 `web/src/styles/study.css`，在本任务的组件文件里 `import '../styles/study.css'`（路径按文件位置调整）；不要改 `app.css`。

不要改别的文件。

## 背景

界面照原型还原：`prototype/app.js` 第 1420–1790 行（`studyCfg` 到 `planEditorHTML`），样式类名已在 `app.css` 里（`.study-wrap`、`.study`、`.study-head`、`.study-state`、`.study-content`、`.study-foot`、`.grade`、`.cloze.hidden-c` / `.shown`、`.cloze-counter`、`.study-done`、`.mode-card`、`.seg`、`.opt-list`、`.switch` 等）。原型的数据在内存里；正式版的队列由服务器生成，评分调接口。原型里这些**不要搬**：⋮ 菜单的“朗读偏好”和所有 `P1` 标签（“移动到其他目录 / 卡片集”本任务要做，见下）。

用到的现成模块：`web/src/store.ts`（`useUI().study`：`StudyTarget | null`，`closeStudy`、`openEditor`、`openDialog`）、`web/src/api.ts`、`web/src/queries.ts`（`useDeck`、`useItems`、`useDecks`、`useSettings`、`invalidateDeck`）、`web/src/ui/`（`Modal`、`DialogHead`、`toast`、`openMenu`、`confirmDialog`、`promptDialog`、`Swatches`）、`web/src/format.ts`（`fmtMDHM`）、`@bnki/shared`（`resolveStudyCfg`、`schedCfgFor`、`previews`、`isDue`、`dueCutoff`、`dayStart`、`relTime`、`DAY`、`HOUR`、`MIN`、`CARD_TYPE_NAMES`、`CARD_COLORS`、`CONTENT_NAMES`）、`@bnki/shared/markdown`（`renderMarkdown`、`plainText`）。

`StudyTarget`（见 `store.ts`）：

- `{ deckId, content? }`：学习。打开时 `api.study.session(deckId, content)` 得到 `{ label, queue, cards }`。
- `{ deckId, viewer: true, cardIds, cardId }`：查看器（“全部卡片”模式，从卡片集页双击或 Enter 打开）。队列是 `cardIds` 各一项（`rep: false`、`flipped: false`），从 `cardId` 那张开始，标题 `全部卡片`。查看器里同样可以评分，但“忘记了”不加入本轮重练。

## 第一步：学习弹窗 `StudyModal.tsx`

`useUI().study` 不为 null 时渲染 `<Modal raw …>`（Esc 关闭）。

- 学习模式打开后队列为空：toast（`content` 为 `review` → `当前没有需要复习的卡片`；`new` → `今天的新卡已学完（或没有未学卡片）`；其余 → `当前待学卡片已清空 🎉`），然后 `closeStudy()`。
- 卡片内容按 id 优先从 `useItems(deckId)` 的数据里取（这样在学习中编辑卡片后能看到新内容），取不到时用 session 返回的 `cards`；状态 `state` 同样取自它。
- 每张卡片的显示状态（换卡时重置）：已揭示的挖空编号集合、`ans`（显示答案）、`hint`、`hideHint`、`topic`（主题卡显示内容），以及这张卡开始显示的时间。
- 结构照原型 `renderStudy`：右上角 `×`、左右箭头、卡片面板 `.study.col-<颜色>.size-<size>.fs-<fontSize>`（`size`、`fontSize` 来自 `resolveStudyCfg(deck.studyCfg, settings)`）、头部（标题 `<label>（i/N）· <类型名>`、朗读 🔈、编辑 ✎、⋮）、状态行、内容、底部（提示 / 隐藏内容切换、挖空计数、评分键、`⋯`）。
- 出题方向：队列项 `flipped` 为 true 的问答卡，问题和答案对调，并且不显示提示。
- 问答卡、笔记卡、主题卡的内容照原型（内容用 `renderMarkdown` 渲染）。
- **挖空**：渲染后把 `.study-content .cloze` 按出现顺序编号（0 起），在已揭示集合里的加 `shown`，否则加 `hidden-c`。点挖空切换揭示。计数器 `.cloze-counter` 显示 `挖空 已揭示/总数　V`，没有挖空时隐藏；点计数器揭示下一个。`resolveStudyCfg(...).clickBlankRevealNext` 为 true 时，点内容区空白处（不是链接、按钮、代码块）揭示下一个。
- **评分键**：`忘记了`、`模糊`、`记住了`（设置 `easyButton` 为 true 时再加 `很简单`），每个键下方是间隔：当前项 `rep` 为 true 且设置 `requeueNoReschedule` 为 true 时都显示 `本轮练习`；否则 `previews(state, Date.now(), schedCfgFor(settings, resolveStudyCfg(deck.studyCfg, settings)), easyButton ? 4 : 3)` 的对应项。问答卡显示答案后、主题卡显示内容后才可用，笔记卡一直可用。
- **状态行**照原型：`state` 为 null 或 `state.state === 0` 时显示 `新卡片 第一次学习`；否则三段：到期情况（已掌握 / 逾期多久需复习 / 多久后下次复习，用 `relTime`、`dueCutoff`）、`N 次 已复习`、上次复习时间（`fmtMDHM(state.lastReview)`，没有时 `—`）。
- **评分**：`practice = 当前项 rep && settings.requeueNoReschedule`。调 `api.study.review({ cardId, rating, durationMs: 现在 - 这张开始的时间, practice })`；返回的 `state` 写回 `['items', deckId]` 缓存里这张卡（`qc.setQueryData`）。本次结果计数 `results[rating]++`。评“忘记了”且不是查看器时，在队列里 `min(队列长度, 当前位置 + 4)` 处插入 `{ cardId, rep: true, flipped: 当前项的 flipped }`，toast `已加入本轮稍后再练一次`。然后前进：已是最后一项则进入结束页，否则下一张。
- **`⋯`（自定义复习）菜单**照原型 `customTimeMenu`：15分钟、1小时、6小时、明天、3天、7天、14天、30天、3个月（`api.study.manual({ cardId, action: 'due', due })`，`明天` 的 `due = dayStart(now, settings.dayHour) + DAY`，其余是 `now + 时长`）、`N 天后…`（`promptDialog('几天后复习？', '10', '天数')`）、`选择日期…`（`promptDialog('选择复习日期', 7 天后的 YYYY-MM-DD, 'YYYY-MM-DD')`，日期当天 `dayHour` 点）。之后 toast `下次复习：<文字>` 并前进。分隔线后：完成学习（已掌握，不再出现）→ `action: 'master'`，toast `已标记为掌握`；彻底忘记（重置为新卡）（danger）→ `action: 'forget'`，toast `已重置为新卡`；都前进。返回的 `state` 同样写回缓存。
- **⋮ 菜单**照原型 `studyMenu`：学习设置（`openDialog('studySettings', deckId)`）、分隔、卡片颜色（子菜单 `<Swatches>`，`api.items.update(id, { color })`）、卡片文字大小（小 / 默认 / 大 / 特大，`PATCH` 卡片集 `studyCfg.fontSize`，当前的打勾）、卡片大小（默认 / 放大 / 宽屏 / 全屏，`studyCfg.size`）、分隔、创建副本（`api.items.duplicate`，toast `已创建副本`）、移动到卡片集（子菜单列其他未删除卡片集；`api.items.list(目标)` 取最后一项 id 作 `afterId`，空集用 null，再 `api.items.move({ ids: [id], afterId, deckId: 目标 })`；toast `已移动到「标题」`；从队列里拿掉这一项）、删除卡片（danger，`confirmDialog('删除卡片', '删除后可以在卡片集页撤销。', '删除', true)` 后 `api.items.remove([id])`，从队列里拿掉）。拿掉当前项后：后面还有就显示后面那张，否则进入结束页。`PATCH studyCfg` 是整体替换，带上原有字段。
- **朗读**（🔈、R 键）：`speechSynthesis` 不存在时 toast `浏览器不支持朗读`。先 `speechSynthesis.cancel()`，朗读 `plainText(问答卡未显示答案时只读问题，否则问题和答案用“。”连起来)`；`rate = settings.ttsRate`，`settings.ttsLang` 非空时设 `lang`。
- **编辑**（✎、E 键）：`openEditor({ deckId, cardId })`。
- **结束页**照原型 `studyDoneHTML`：🎉、`学习完成`、说明（查看器：`已浏览到最后一张`；否则 `本次学习已完成，当前待学卡片已清空`）、`共 N 次评分`、`用时 N 分钟`（至少 1）、三种评分各几次。不是查看器时再调一次 `api.study.session(deckId)`，队列非空就显示 `再学一组（N）` 按钮（用这次返回的队列重新开始，计数清零）。`完成` 按钮关闭。
- **键盘**（只有学习弹窗在最上层时生效，`Modal` 的 `onKeyDown`）照原型 `studyKeys`：1 / 2 / 3（`easyButton` 时 4）评分，键不可用时 toast（问答卡 `先按空格显示答案`，其余 `先显示内容`）；空格：问答卡切换答案，主题卡切换内容，笔记卡揭示下一个挖空；V 揭示下一个，⇧V 全部显示或全部隐藏；H 显示提示；← / → 上一张 / 下一张；E 编辑；R 朗读。结束页上 Enter 或空格关闭。带 ⌘、Ctrl、⌥ 的键不处理。
- 关闭时 `invalidateDeck(qc, deckId)`。

## 第二步：学习设置 `StudySettingsDialog.tsx`

props `{ deckId, onClose }`（由 `DeckDialogs.tsx` 挂载）。照原型 `studySettingsDialog` 和 `planEditorHTML`：`Modal light`，宽 520px，标题 `开始学习 · 学习设置`。

- 草稿从 `resolveStudyCfg(deck.studyCfg, settings)` 初始化。
- 学习内容（4 段，下方一行说明照原型）、卡片颜色（多选，10 色，不选 = 全部）、学习目录（多选，列出卡片集的目录，按级别缩进；没有目录时显示 `这个卡片集还没有目录`）、卡片顺序、出题方向、点击卡片空白处显示下一个挖空（开关）。
- “复习计划与每日上限”：一行摘要（`按天模式 · 每日新学 20 · 每日复习 100`），点击展开：三张模式卡片（文案照原型；灵活模式里的分钟数用设置的 `steps`）、冲刺模式时显示考试日期（`input type=date`）、每日新学 / 每日复习（数字，最小 0）、说明 `间隔由 FSRS 计算（目标记忆保持率 0.9，可在系统设置里改）`（数值用设置的 `retention`）。
- 底部：`仅保存`、`开始学习`。保存时 `api.decks.update(deckId, { studyCfg: { ...deck.studyCfg, content, colors, sections, order, direction, clickBlankRevealNext, plan } })`，`invalidateDeck`，关闭。`开始学习`：保存后，如果学习弹窗开着先关掉，再 `openStudy({ deckId })`。

## 第三步：测试

`StudyModal.test.tsx`：`vi.stubGlobal('fetch', …)` 按 URL 和方法返回数据并记录调用；`/api/settings` 返回 `{ ...DEFAULT_SETTINGS, fuzz: false }`；卡片集 `d1`；items：笔记卡 `c1`（`front: 'A {{x}} B {{y}}'`）、问答卡 `c2`（`front: 'Q'`、`back: 'ANS'`）；`POST /api/study/d1/session` 返回 `{ label: '系统推荐', queue: [{cardId:'c1',rep:false,flipped:false},{cardId:'c2',rep:false,flipped:false}], cards: [...] }`；`POST /api/study/review` 返回 `{ state: <一个 state 2 的状态>, label: '3天', requeue: false }`。渲染 `QueryClientProvider` 包住的 `<StudyModal />` 和 `<Overlays />`，`act(() => useUI.getState().openStudy({ deckId: 'd1' }))`。

- 标题含 `系统推荐（1/2）`；有 2 个 `.cloze.hidden-c`；按 V 后 1 个 `.shown`，计数显示 `挖空 1/2`；⇧V 后全部 `.shown`。
- 评分键下方显示新卡的间隔（`记住了` 下面是 `3天`）。
- 按 3 → 收到 `POST /api/study/review`，body `{ cardId: 'c1', rating: 3, practice: false, … }`；标题变成 `（2/2）`。
- 第二张是问答卡：按 3 不发请求并出现 `先按空格显示答案`；按空格后出现 `ANS`；按 1 → review 请求 `rating: 1`，出现 `已加入本轮稍后再练一次`，标题变成 `（3/3）`；再按空格、按 3 → 这次 body 的 `practice` 是 true。之后出现 `学习完成`。
- session 返回空队列时出现 `当前待学卡片已清空 🎉`，`useUI.getState().study` 变回 null。
- 查看器 `openStudy({ deckId: 'd1', viewer: true, cardIds: ['c1','c2'], cardId: 'c2' })`：标题含 `全部卡片（2/2）`，没有请求 session。

`StudySettingsDialog.test.tsx`：渲染 `<StudySettingsDialog deckId="d1" onClose={fn} />`（卡片集有一个目录 `S1`）；点 `仅复习`、点 `红色`、点 `S1`、点 `仅保存` → 收到 `PATCH /api/decks/d1`，body 的 `studyCfg` 含 `content: 'review'`、`colors: ['red']`、`sections: ['S1']`，`onClose` 被调用。

```sh
npx vitest run --project web src/study/
```

## 最后一步：收尾检查

```sh
npx vitest run --project web src/study && npx tsc -p web --noEmit
```

通过的标准：本任务的测试全部通过；类型检查没有错误（如果类型错误只出在本任务以外的文件里，在结果里写明是哪个文件）；只改了上面列出的文件。全部通过后最后一行输出 `DONE`。
