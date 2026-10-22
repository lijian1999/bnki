# 任务 13：卡片集页 P1——卡片链接跳转、`?card=` 定位、框选、朗读

先读 `AGENTS.md`，再读 `docs/contracts.md`（3.3 的 `GET /api/items/:id`、第 4 节链接一行、第 5 节）、`docs/design.md` §1.2。再读 `web/src/pages/DeckPage.tsx`、`web/src/deck/` 和 `web/src/styles/deck.css`。

本任务只改这些文件：

- 修改：`web/src/pages/DeckPage.tsx`、`web/src/App.tsx`（只加一行挂载钩子）、`web/src/pages/DeckPage.test.tsx`（只加用例，不删改已有的）。
- 新建：`web/src/components/useCardLinks.ts`、`web/src/components/useCardLinks.test.tsx`、`web/src/deck/marquee.ts`、`web/src/deck/marquee.test.ts`。
- 样式追加到 `web/src/styles/deck.css` 末尾。

现有接口：`api.items.get(id)` → `Item`（不存在或已删除时请求失败，`ApiError` 的 `status` 是 404）；`useUI()` 里有 `closeStudy()`、`closeEditor()`（名字以 `web/src/store.ts` 为准）；设置 `useSettings()` 里有 `ttsRate`、`ttsLang`；`plainText` 从 `@bnki/shared/markdown` 导入。

## 第一步：卡片链接点击 `useCardLinks.ts`

Markdown 渲染出的卡片链接是 `<a href="#" data-card-link="<id>">`（卡片网格、学习弹窗里都有）。

```ts
export function useCardLinks(): void;
```

- 在 `document` 上挂 `click` 监听（捕获阶段）。目标在 `a[data-card-link]` 里时：`preventDefault()`、`stopPropagation()`，再 `api.items.get(id)`：
  - 成功：如果学习弹窗开着就关掉；`navigate('/deck/' + item.deckId + '?card=' + id)`。
  - 失败：`toast('卡片不存在或已删除')`。
- 点击发生在 `.ProseMirror`（编辑器里）时不处理。
- 在 `App.tsx` 的 `App` 组件里调用一次 `useCardLinks()`。

测试 `useCardLinks.test.tsx`：用 `MemoryRouter` + 一个显示 `useLocation()` 的小组件；渲染一个 `<a href="#" data-card-link="c1">x</a>`，`fetch` 返回 `{ id: 'c1', deckId: 'd9', kind: 'card', … }` → 点击后路径变成 `/deck/d9`、search 是 `?card=c1`；`fetch` 返回 404 → 路径不变（toast 可以 `vi.mock('../ui/toast')` 断言被调用）。

```sh
npx vitest run --project web src/components/useCardLinks.test.tsx
```

## 第二步：`?card=<id>` 定位

`DeckPage` 读 `useSearchParams()` 的 `card`。条目加载完、且这张卡在本卡片集里时：

1. 如果它所在的目录或任一上级目录是折叠的，用现有的展开逻辑（`patchItem(id, { collapsed: false })`）把它们展开。
2. 选中这张卡（`sel = {id}`），`scrollIntoView({ block: 'center' })`，给卡片元素加类 `flash` 1.6 秒（`deck.css`：`@keyframes` 背景从 `var(--accent-soft)` 渐变回原色）。
3. 处理完用 `setSearchParams({}, { replace: true })` 去掉参数，同一张卡再次跳转时能再次触发。

卡不在本卡片集（已被移走）时什么都不做，同样去掉参数。

测试（加在 `DeckPage.test.tsx`，沿用文件里已有的 mock 方式）：路由 `/deck/d1?card=<某卡 id>` 渲染后，这张卡的 `[data-item]` 元素有 `sel` 类；它所在目录原本 `collapsed: true` 时，发出了 `PATCH /api/items/<目录 id>`，body 含 `"collapsed":false`。（jsdom 没有 `scrollIntoView`，测试里 `Element.prototype.scrollIntoView = vi.fn()`。）

## 第三步：框选

纯函数放 `deck/marquee.ts`：

```ts
export interface Rect { left: number; top: number; right: number; bottom: number }
/** 两点围成的矩形（起点终点任意方向）。 */
export function rectFrom(x1: number, y1: number, x2: number, y2: number): Rect;
/** 和 box 相交（边接触不算）的条目 id，按 rects 的顺序。 */
export function hitIds(box: Rect, rects: { id: string; rect: Rect }[]): string[];
```

测试 `marquee.test.ts`：反方向拖得到同一个矩形；相交、包含、只碰边、不相交四种情况。

`DeckPage` 里：

- 在主区空白处（不在 `[data-item]`、按钮、输入框、`.toc` 目录面板、浮动按钮上）按下鼠标左键并移动超过 4px 开始框选；显示一个 `position: fixed` 的 `.marquee` 框（1px `var(--accent)` 边框、`var(--accent-soft)` 填充）。
- 拖动时实时计算与框相交的**卡片**（不含目录标题）作为选区；按着 ⌘/Ctrl 或 Shift 开始时，结果和开始时的原选区合并。
- 松开鼠标结束；没超过 4px 的就是普通点击（保持现有“点空白清空选择”的行为）。
- 框选结束后不要触发一次 click 把选区清掉（例如用一个 ref 记住“刚框选完”，在 click 处理里跳过一次）。

## 第四步：朗读

在顶栏搜索按钮左边加按钮 `🔈`，`title="朗读"`，正在朗读时有 `on` 类、`title="停止朗读"`。

- 点击：`speechSynthesis` 不存在时 `toast('浏览器不支持朗读')`。否则按卡片集顺序朗读：有选中的卡片时只读选中的卡片，否则读全部卡片（折叠目录里的也读）。每张卡一条 `SpeechSynthesisUtterance`：问答卡读 `正面纯文本 + '。' + 背面纯文本`，笔记卡读正面纯文本，空文本的卡跳过；`rate = settings.ttsRate`，`settings.ttsLang` 非空时设 `lang`。
- 正在读的那张卡加类 `speaking`（`deck.css`：`outline: 2px solid var(--accent)`），并 `scrollIntoView({ block: 'nearest' })`。
- 再点一次或离开页面（组件卸载）：`speechSynthesis.cancel()`，清掉状态。全部读完自动回到未朗读状态。

测试（加在 `DeckPage.test.tsx`）：`vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn() })`，并 stub 一个最小的 `SpeechSynthesisUtterance` 类（记录 `text`）。点 `朗读` 按钮 → `speak` 被调用，第一条的 `text` 是第一张卡的纯文本；再点一次 → `cancel` 被调用。

## 最后一步：收尾检查

```sh
npx vitest run --project web src/pages/DeckPage.test.tsx src/components/useCardLinks.test.tsx src/deck && npx tsc -p web --noEmit
```

通过的标准：这些测试全部通过（含 `DeckPage.test.tsx` 原有用例）；类型检查没有错误；只改了上面列出的文件。全部通过后最后一行输出 `DONE`。
