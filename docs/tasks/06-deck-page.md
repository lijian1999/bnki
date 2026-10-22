# 任务 06：卡片集页

先读 `AGENTS.md`，再读接口约定 `docs/contracts.md`（3.2、3.3、3.4 的 `manual`、第 4 节、第 5 节）。本任务只改这些文件：

- 替换空壳：`web/src/pages/DeckPage.tsx`。
- 新建：`web/src/deck/` 目录下的文件（组件、钩子、纯函数，怎么拆由你定），其中必须有 `web/src/deck/model.ts` 和测试 `web/src/deck/model.test.ts`、`web/src/pages/DeckPage.test.tsx`。
- 需要新样式时写进新建的 `web/src/styles/deck.css`，在本任务的组件文件里 `import '../styles/deck.css'`（路径按文件位置调整）；不要改 `app.css`。

不要改别的文件。请求层、查询钩子、通用浮层已经写好，直接用：`web/src/api.ts`（`api`）、`web/src/queries.ts`（`useDeck`、`useItems`、`useDecks`、`useSettings`、`useSaveSettings`、`invalidateDeck`）、`web/src/ui/`（`toast`、`openMenu`、`confirmDialog`、`promptDialog`、`Swatches`）、`web/src/format.ts`（`fmtDate`）、`web/src/store.ts`（`useUI`：`openEditor`、`openStudy`、`openDialog`）。Markdown 渲染用 `import { renderMarkdown, plainText } from '@bnki/shared/markdown'`；调度相关用 `@bnki/shared` 的 `isDue`、`schedCfgFor`、`resolveStudyCfg`、`CARD_COLORS`、`CONTENT_NAMES`。

## 背景

界面和交互照原型还原：`prototype/app.js` 第 401–917 行（`deckPageHTML` 到卡片集页快捷键），样式类名已在 `web/src/styles/app.css` 里。原型是拼 HTML 字符串、数据存内存；你要改写成 React 组件，数据来自接口。原型里这些东西**不要搬**：顶部的朗读按钮 `🔈`、进度面板的“测验”按钮、⋯ 菜单里的“朗读偏好”“分享 / 创建学习小组”、显示选项里的“测验进度”、所有 `P1` / `P2` / `砍` 标签。

数据：`useDeck(id)` 得到 `DeckSummary`（含 `counts`），`useItems(id)` 得到按位置排好的 `Item[]`（卡片带 `state`）。显示选项在 `deck.displayCfg`（字段名和原型不同：`layout`、`showAnswer`、`showProgress`、`showMindmap`、`showToc`，缺省时 `layout` 为 `'auto'`、其余为 true）。

改动一律：先用 `qc.setQueryData(['items', deckId], …)`（或 `['deck', deckId]`）更新缓存让界面立刻变化，再调接口，完成后 `invalidateDeck(qc, deckId)`。接口出错时 `toast('操作失败')` 并 `invalidateDeck` 回到服务器数据。

## 第一步：纯函数 `web/src/deck/model.ts`

```ts
import type { Item, SectionItem, CardItem } from '@bnki/shared';

/** 目录块：[目录本身的下标, 下一个同级或更高级目录的下标（没有就是 items.length）) */
export function sectionBlock(items: Item[], sectionId: string): [number, number];

/** 页面上要显示的行。q 是搜索词（去掉首尾空白、不区分大小写）。 */
export type Row =
  | { kind: 'section'; item: SectionItem; count: number }   // count = 这个目录块里的卡片数（含子目录里的）
  | { kind: 'cards'; cards: CardItem[] };                  // 连续的一组卡片，渲染成一个网格
export function buildRows(items: Item[], q: string): Row[];

/** 可见项 id（目录和卡片，按页面顺序），用于方向键、⇧ 点击、⌘A。 */
export function visibleIds(rows: Row[]): string[];

/** 新建时的 afterId：选中项是折叠的目录时，返回它的目录块里最后一项的 id；否则返回选中项 id；没有选中返回 undefined（= 末尾）。 */
export function insertAfterId(items: Item[], selectedId: string | undefined): string | undefined;

/** 拖拽：把 dragId 放到 targetId 的前面（after=false）或后面（after=true）。
 *  拖的是目录且 onlyHeading=false 时带上整个目录块。目标在被拖的块里时返回 null。 */
export function computeDrop(items: Item[], dragId: string, targetId: string, after: boolean, onlyHeading: boolean):
  { ids: string[]; afterId: string | null } | null;

/** 把卡片移到某个目录块的末尾（只移动卡片，目录忽略）。 */
export function moveToSectionEnd(items: Item[], ids: string[], sectionId: string): { ids: string[]; afterId: string | null };

/** 卡片 → 它所在的各级目录 id（从外到内）。 */
export function sectionPaths(items: Item[]): Record<string, string[]>;
```

规则：

- `buildRows`：从前往后扫。没有搜索词时，目录 `collapsed` 为 true 就隐藏它后面直到下一个同级或更高级目录之前的所有内容（包括子目录）。有搜索词时忽略折叠，所有目录都显示，卡片只留 `plainText(front + ' ' + hint + ' ' + back)` 包含搜索词的。相邻的卡片合成一个 `cards` 行。
- `computeDrop`：先从序列里拿掉要移动的那些项（`ids` 按原顺序）。`after` 为 false：`afterId` = 剩下序列里目标前一项的 id（目标是第一项时为 null）。`after` 为 true：目标是折叠的目录时，`afterId` = 剩下序列里它的目录块最后一项；否则 = 目标。
- `moveToSectionEnd`：先拿掉要移动的卡片，`afterId` = 剩下序列里该目录块最后一项。

测试 `model.test.ts`（自己造 items）：
- `sectionBlock`：A(1) a1 B(2) b1 C(1) → A 的块是 [0, 5)，B 的块是 [2, 4)。
- `buildRows`：A 折叠时 A 下面的卡片和子目录 B 都不显示，C 显示；`count` 正确；搜索词命中时折叠失效、未命中的卡片不显示；连续卡片合成一行。
- `insertAfterId`：选中折叠的 A → b1；选中展开的 A → A；没选中 → undefined。
- `computeDrop`：[A, 1, 2, 3] 把 3 拖到 1 前面 → `{ ids: ['3'], afterId: 'A' }`；把 A（一级目录，它的块是 A、1、2、3）带块拖到 3 后面 → null（目标在块里）；A 只拖标题（`onlyHeading: true`）拖到 3 后面 → `{ ids: ['A'], afterId: '3' }`；把 2 拖到 A 前面 → `{ ids: ['2'], afterId: null }`；[A, 1, B(1), 2] 且 B 折叠时，把 1 拖到 B 后面 → `{ ids: ['1'], afterId: '2' }`。
- `moveToSectionEnd`：卡片移到 B 块末尾。

```sh
npx vitest run --project web src/deck/model.test.ts
```

## 第二步：页面结构（`DeckPage.tsx` 和 `web/src/deck/` 里的组件）

路由参数 `deckId`。进入页面时调用一次 `api.decks.open(deckId)`（之后 `invalidateDeck(qc)`）。卡片集不存在（404）时显示 `<div class="empty">卡片集不存在</div>` 和返回首页的链接。

照原型 `deckPageHTML`：

- 顶栏 `.deck-top`：返回 `‹`（回到上一页，没有历史时回 `/`）、搜索（点 `⌕` 展开成输入框，`×` 关闭并清空；输入即过滤，搜索词是页面内状态）、`⋯` 卡片集菜单。
- 左侧目录面板 `.toc`（`showToc` 为 false 时不显示）：`＋` 新建一级目录（放在末尾）、`⇕` 全部折叠 / 展开（有任一未折叠的就全部折叠，否则全部展开，逐个 `PATCH collapsed`）、目录列表（缩进按级别）、点击定位：目录是折叠的先展开，再 `scrollIntoView({ behavior: 'smooth', block: 'start' })`。
- 主区：封面（`cover` 非空时显示，`media/` 开头的前面加 `/`）、标题输入框 `.deck-title`、日期行 `创建 2026.10.22 · 更新 2026.10.22`、介绍 `.deck-desc`（非空时）、进度面板（`showProgress` 为 true 且有卡片时）、行列表。
- 标题：输入时本地更新，停止输入 500 毫秒后或失焦时 `PATCH title`；失焦时内容为空就保存为 `无标题卡片集`。Enter 失焦。路由 state 有 `focusTitle: true` 时进入页面自动聚焦并全选标题。
- 进度面板照原型 `progressHTML`，去掉“测验”。`继续学习 · <学习内容名>` → `openStudy({ deckId })`；`⚙` → `openDialog('studySettings', deckId)`；“未学 N 学习 ›” → `openStudy({ deckId, content: 'new' })`；“待复习 N 复习 ›” → `openStudy({ deckId, content: 'review' })`；`showMindmap` 时显示“⌘ 导图”→ `openDialog('mindmap', deckId)`；右侧的计划说明照 `planLabel`，数据来自 `resolveStudyCfg(deck.studyCfg, settings).plan`。
- 目录行照 `sectionHTML`：`.section-h.l<级别>`，折叠时加 `collapsed`，选中时加 `sel`，`▼` 点击切换折叠，右侧是卡片数。改名中显示输入框。
- 卡片网格：`.card-grid`，`layout` 不是 `auto` 时加 `cols-<n>`。卡片照 `cardHTML`：`.mini-card.col-<颜色>`，问答卡显示问题、提示（`.hint-prev`）、答案（`.a`，`showAnswer` 为 false 时不显示），主题卡显示标题和纯文本，笔记卡显示正面；内容用 `renderMarkdown` 渲染（`dangerouslySetInnerHTML`）。右下角状态：`mastered` → `已掌握`；否则 `isDue(state, schedCfgFor(settings, resolveStudyCfg(deck.studyCfg, settings)), Date.now())` → `需复习`（`.state-dot.due`）。
- 有搜索词时，渲染后把卡片 `.md` 里命中的文字包成 `<mark class="hit">`（照原型 `highlightHits`，在 `useLayoutEffect` 里处理）；一张都没命中时显示 `没有匹配的卡片`。
- 空卡片集（没有任何 item）显示原型的引导（`.empty-deck`）：“先新建目录”“新建第一张卡片”“导入文本”（→ `openDialog('import', deckId)`）。
- 右下角 `.fab-group`：“☰ 新建目录”“＋ 新建卡片”。

## 第三步：选择、浮动工具栏、菜单

- 选择状态（页面内）：`sel: Set<string>`、`anchor`。点击目录或卡片照原型 `selectItem`：普通点击单选；⌘（Windows 上 Ctrl）点击切换；⇧ 点击从 anchor 到它的连续范围（按 `visibleIds`）。已经单独选中的目录再点一次 = 切换折叠（等 250 毫秒，期间发生双击就取消）。点页面空白处（不在 `.float-toolbar`、`.fab-group`、`.deck-top`、`.progress-panel`、`.toc`、标题输入框里）清空选择。
- 双击卡片（卡片任意位置）→ 打开查看器：`openStudy({ deckId, viewer: true, cardIds: <当前可见卡片 id，按顺序>, cardId })`；双击目录 → 改名。双击后清掉浏览器选中的文字。
- 浮动工具栏 `.float-toolbar`：照原型 `placeFloatToolbar`，用 portal 渲染进 `#main`，位置在第一个选中项上方居中（`top = 元素顶部 - #main 顶部 + #main.scrollTop`）。三种形态：
  - 多选：`已选 N 项`、颜色（只改卡片）、移动到目录（菜单列出所有目录，选中后把选中的卡片 `moveToSectionEnd`，toast `已移动 N 张卡片`）、删除。
  - 单张卡片：展开（= 打开查看器）、编辑（`openEditor({ deckId, cardId })`）、颜色、删除、`⋯`。
  - 单个目录：改名、级别（菜单 一级目录…五级目录，当前的打勾，`PATCH level`）、删除、`⋯`。
- 颜色：菜单里放 `<Swatches>`（`openMenu(anchor, [{ render: () => <Swatches … /> }])`），选中后逐个 `PATCH color`，并 `useSaveSettings()({ lastCardColor: 颜色 })`。
- 删除：`api.items.remove(ids)`，清空选择，toast 照原型文案（`已删除 N 张卡片` / `N 个目录（目录下的卡片保留）`），带“撤销”→ `api.items.restore(ids)`。
- 卡片 `⋯` 菜单照原型 `cardMenuItems`：
  - 创建副本 → `api.items.duplicate(id)`。
  - 移动到指定目录（子菜单列目录，没有目录时禁用）。
  - 移动到卡片集（子菜单列其他未删除卡片集，`useDecks({})` 的数据）：先 `api.items.list(目标)` 取最后一项 id 作 `afterId`（空集用 null），再 `api.items.move({ ids, afterId, deckId: 目标 })`，toast `已移动 N 张卡片到「标题」`。
  - 在后面添加卡片 ⌥C、在后面添加目录 ⌥D。
  - 已掌握时“恢复学习”（`api.study.manual({ cardId, action: 'unmaster' })`，toast `已恢复学习`），否则“完成学习（标记已掌握）”（`action: 'master'`，toast `已标记为掌握，不再出现在学习中`）。
  - 彻底忘记（重置为新卡）：`state` 为 null 时禁用；`action: 'forget'`，toast `已重置为新卡`。
- 目录 `⋯` 菜单照原型 `sectionMenuItems`：在后面添加卡片、在后面添加目录、移动到指定目录之后（子菜单列其他目录；把这个目录块整体移到目标目录块的最后一项之后）、移动到卡片集（含目录内容；把整个目录块移到目标卡片集末尾，做法同卡片）、从这里开始学习（`PATCH studyCfg: { ...deck.studyCfg, sections: [目录 id] }` 后 `openStudy({ deckId })`）。
- 新建卡片：`openEditor({ deckId, afterId: insertAfterId(items, 最后一个选中项) })`。
- 新建目录：`api.items.create({ deckId, kind: 'section', afterId: insertAfterId(…), level: 选中项是目录时用它的级别，否则 1 })`，然后选中新目录并进入改名状态。目录面板的 `＋` 是 `afterId` 省略（末尾）、`level: 1`。
- 改名：输入框自动聚焦全选；Enter 或失焦提交（去掉首尾空白，截到 200 字，空的用 `新目录`），Esc 取消。
- 卡片集 `⋯` 菜单（`alignRight`）照原型 `deckMenu`，去掉“朗读偏好”“分享”：设置封面（`openDialog('cover')`）、编辑介绍（`promptDialog('编辑介绍', 原介绍, '一句话介绍这个卡片集')` → `PATCH description`）、导入卡片（`openDialog('import')`）、导出（`openDialog('export')`）、学习设置（`openDialog('studySettings')`）、重新开始学习（没有任何卡片有 `state` 时 toast `当前卡片集还没有可重置的学习进度`；否则照原型文案 `confirmDialog` 后 `api.decks.resetProgress`，toast `已重置学习进度`）、卡片布局（子菜单，`PATCH displayCfg`）、显示选项（子菜单：答案内容、学习进度、思维导图、卡片目录）、快捷键与操作（`openDialog('shortcuts')`）。`displayCfg` 是整体替换，PATCH 时带上原有字段。

## 第四步：拖拽和键盘

- 拖拽照原型（HTML5 原生 `draggable`，第 830–862 行）：拖动时被拖项加 `dragging`，目标项用 `box-shadow` 显示插入线（卡片左右、目录上下），放下时用 `computeDrop`（按住 ⌥ 开始拖或放下时只移动目录标题）得到 `{ ids, afterId }` 调 `api.items.move`。
- 键盘：页面挂载期间在 `document` 上监听 `keydown`。`document.querySelector('.mask, .menu')` 存在时（有弹窗或菜单）不处理。焦点在输入框、文本域、可编辑区域时只处理：改名框 Enter / Esc、标题框 Enter、搜索框 Esc。其余照原型 `deckKeys`：⌥C / ⌥D、⌘A 全选可见项、⌘F 打开搜索并聚焦、C 新建卡片、D 新建目录、E 编辑（卡片打开编辑器，目录改名）、Enter 打开查看器（单张卡片）、Backspace / Delete 删除选中、Esc 清空选择、方向键移动选择（⇧ 扩展），移动后 `scrollIntoView({ block: 'nearest' })`。按键用 `e.code === 'KeyC'` 判断 ⌥ 组合（Mac 上 ⌥C 的 `e.key` 是 `ç`）。

## 第五步：页面测试 `web/src/pages/DeckPage.test.tsx`

用 `vi.stubGlobal('fetch', …)` 按 URL 和方法返回数据（卡片集 `d1`，items：目录 A、卡片 c1（笔记，`front` 含 `{{挖空}}`）、目录 B、卡片 c2（问答卡），c2 的 `state` 是一个已到期的复习状态），`/api/settings` 返回 `DEFAULT_SETTINGS`，其余写操作返回 `{ ok: true }` 或对应对象并记录调用。用 `QueryClientProvider` + `MemoryRouter initialEntries={['/deck/d1']}` + `<Routes><Route path="/deck/:deckId" element={<DeckPage />} /></Routes>`，同时渲染 `<Overlays />`。

- 显示标题、两个目录标题、两张卡片；c1 渲染出 `.cloze`；c2 上有 `需复习`。
- 点 A 的 `▼` → 收到 `PATCH /api/items/A`，body 含 `collapsed: true`，c1 不再显示。
- 点击选中 c1 后按 Backspace → 收到 `POST /api/items/delete`，body `{ ids: ['c1'] }`，出现“撤销”。
- 打开搜索输入 `挖空` → 只剩 c1，且有 `mark.hit`。
- items 为空时显示 `开始搭建你的卡片集`。

```sh
npx vitest run --project web src/pages/DeckPage.test.tsx
```

## 最后一步：收尾检查

```sh
npx vitest run --project web src/pages/DeckPage.test.tsx src/deck && npx tsc -p web --noEmit
```

通过的标准：本任务的测试全部通过；类型检查没有错误（如果类型错误只出在本任务以外的文件里，在结果里写明是哪个文件）；只改了上面列出的文件。全部通过后最后一行输出 `DONE`。
