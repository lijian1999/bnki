# 任务 05：前端外壳——请求层、通用浮层、侧边栏、首页

先读 `AGENTS.md`，再读接口约定 `docs/contracts.md`（第 3 节全部接口、第 5 节前端约定）。本任务只改这些文件：

- 新建：`web/src/api.ts`、`web/src/queries.ts`、`web/src/ui/toast.ts`、`web/src/ui/menu.ts`、`web/src/ui/dialogs.ts`、`web/src/ui/Modal.tsx`、`web/src/ui/Swatches.tsx`、`web/src/format.ts`，以及测试 `web/src/api.test.ts`、`web/src/ui/ui.test.tsx`、`web/src/pages/HomePage.test.tsx`。
- 替换现有空壳：`web/src/ui/Overlays.tsx`、`web/src/components/Sidebar.tsx`、`web/src/components/useTheme.ts`、`web/src/pages/HomePage.tsx`。
- 需要新样式时追加到 `web/src/styles/app.css` 末尾（不改已有规则）。

不要改别的文件（`App.tsx`、`main.tsx`、`store.ts` 只读）。卡片集页、编辑器、学习页、统计、设置页由别的任务做。

## 背景

界面按原型还原：`prototype/app.js` 的第 130–253 行是 toast、菜单、弹窗、确认框、输入框；第 299–399 行是侧边栏和首页；第 713–760 行是首页上的点击动作（卡片集 ⋯ 菜单、排序菜单、分类的新建/编辑/删除）。样式已经复制到 `web/src/styles/app.css`，类名照原型用。原型是拼 HTML 字符串，你要改写成 React 组件，结构和类名保持一致。

原型侧边栏最下面的灰字“学习小组、社区……已砍掉”不要搬。

## 第一步：请求层 `web/src/api.ts`

导出 `class ApiError extends Error { status: number; code: string }` 和 `api` 对象，覆盖 `docs/contracts.md` 第 3 节的所有接口（导出接口只需要 `exportUrl` 返回 URL 字符串）：

```ts
api.folders.list() / create(name) / update(id, patch) / remove(id)
api.decks.list(params?: { view?, folder?, sort?, q? }) / get(id) / create(body?) / update(id, patch) / open(id) / forgetRecent(id)
          / remove(id) / restore(id) / purge(id) / emptyTrash() / duplicate(id) / resetProgress(id)
api.items.list(deckId) / create(body) / update(id, patch) / remove(ids) / restore(ids) / move(body) / duplicate(id)
api.study.session(deckId, content?) / review(body) / manual(body) / preview(cardId)
api.stats(range)
api.settings.get() / put(patch)
api.media.upload(file: Blob, filename?: string)   // multipart，字段名 file
api.io.importText(body) / importMarkdown(body) / importApkg(deckId, file: Blob) / exportUrl(deckId, params)
api.backups.list() / create() / restore(name)
```

- 统一用一个 `request<T>(method, path, body?)`：JSON 请求带 `Content-Type: application/json`；响应不是 2xx 时读 JSON 里的 `error`、`message` 抛 `ApiError`。
- 参数、返回值类型用 `@bnki/shared` 里的类型（`Folder`、`DeckSummary`、`Item`、`CardItem`、`CardState`、`Settings`、`QueueEntry` 等）；统计返回值按 3.5 定义一个 `Stats` 接口导出。
- 查询参数用 `URLSearchParams`，值为 undefined 或空串的不带。

测试 `web/src/api.test.ts`：用 `vi.stubGlobal('fetch', vi.fn(...))` 断言以下调用的方法、URL、请求体：`decks.list({ view: 'trash', sort: 'name' })` → `GET /api/decks?view=trash&sort=name`；`items.move({ ids: ['a'], afterId: null })` → `POST /api/items/move` 且 body 一致；`items.remove(['a','b'])` → `POST /api/items/delete`；`decks.purge('x')` → `DELETE /api/decks/x/purge`；`settings.put({ theme: 'dark' })` → `PUT /api/settings`；404 响应 `{ error: 'not_found', message: 'x' }` → 抛 `ApiError`，`status` 404、`code` `not_found`。

```sh
npx vitest run --project web src/api.test.ts
```

## 第二步：查询钩子 `web/src/queries.ts`

用 TanStack Query 导出：`useFolders()`、`useDecks(params)`、`useDeck(id)`、`useItems(deckId)`、`useSettings()`、`useStats(range)`、`useBackups()`（key 见约定第 5 节），以及：

- `invalidateDeck(qc: QueryClient, deckId?: string)`：刷新 `['decks']`（前缀匹配，所有列表）、`['folders']`，有 `deckId` 时再刷新 `['deck', deckId]`、`['items', deckId]`。
- `useSaveSettings()`：返回 `(patch: Partial<Settings>) => Promise<Settings>`，先乐观更新 `['settings']` 缓存，再 `api.settings.put`，成功后用返回值覆盖缓存，失败时回滚并 `toast('保存失败')`。

## 第三步：通用浮层

- `ui/toast.ts`：`toast(msg: string, action?: { label: string; run: () => void })`。同一时间只显示一条，新的替换旧的；有 action 时 5 秒、否则 2.2 秒后消失；点 action 按钮执行并关闭。
- `ui/menu.ts`：
  ```ts
  export type MenuItem =
    | '-' | null | undefined | false
    | { header: string }
    | { render: () => React.ReactNode }   // 自定义内容（例如颜色色块）
    | { label: string; icon?: string; kbd?: string; danger?: boolean; checked?: boolean; disabled?: boolean;
        onClick?: () => void; sub?: () => MenuItem[] };
  export function openMenu(anchor: HTMLElement | { x: number; y: number }, items: MenuItem[], opts?: { alignRight?: boolean }): void;
  export function closeMenu(): void;
  ```
  行为照原型 `openMenu`：`-` 是分隔线（`.ms`），`header` 是 `.mh`，菜单项 `.mi`（`danger`、`checked`、`disabled` 加同名类），`kbd` 显示在右侧 `.kbd`，有 `sub` 的右侧显示 `›`、点击后在同一位置换成子菜单；`null/false/undefined` 跳过。位置：锚点下方 6px，超出窗口底部时放到上方，左右不超出窗口（`alignRight` 时右边对齐锚点）。在菜单外按下鼠标、按 Esc 都关闭。
- `ui/dialogs.ts`：`confirmDialog(title, text, ok = '确定', danger = false): Promise<boolean>`、`promptDialog(title, value = '', placeholder = ''): Promise<string | null>`。样式和行为照原型 `confirmDialog`、`promptDialog`（`mask light` + `.dialog`，Enter 确定，Esc / 点遮罩 / 取消返回 false 或 null；输入框打开时自动聚焦并全选）。
- `ui/Modal.tsx`：
  ```tsx
  export function Modal(props: { onClose: () => void; className?: string; light?: boolean; raw?: boolean;
    closeOnMask?: boolean; onKeyDown?: (e: KeyboardEvent) => void; children: React.ReactNode }): JSX.Element;
  export function DialogHead(props: { title: React.ReactNode; onClose: () => void }): JSX.Element;
  ```
  用 portal 渲染到 `document.body`：`<div class="mask{ light}">`，`raw` 时直接放 children，否则包一层 `<div class="dialog {className}">`。`closeOnMask` 默认 true（在遮罩本身上按下鼠标时关闭）。多个 Modal 叠加时只有最上面的一个响应键盘：Esc 调 `onClose`，其余按键交给它的 `onKeyDown`。确认框、输入框也算在这个叠加顺序里。`DialogHead` 输出原型的 `.dialog-head`（标题 + `×` 按钮）。
- `ui/Swatches.tsx`：`<Swatches current={color} onPick={(c) => …} />`，照原型 `swatchesEl` 输出 10 个色块（`CARD_COLORS`），当前的加 `on` 类，`title` 是颜色名。
- `ui/Overlays.tsx`：默认导出组件，渲染当前的 toast、菜单、确认框和输入框（用一个小的 zustand store 或模块内状态 + `useSyncExternalStore` 都可以）。

测试 `web/src/ui/ui.test.tsx`（渲染 `<Overlays />` 再调用函数）：`toast('已删除', { label: '撤销', run })` 后能找到文字，点“撤销”调用了 `run` 且 toast 消失；`openMenu` 三项（含一个分隔线、一个 `danger`）渲染出 2 个 `.mi`、1 个 `.ms`，点第一项调用了它的 `onClick` 并关闭菜单；`sub` 菜单点击后出现子项；`confirmDialog` 点“确定”resolve true，按 Esc resolve false；`promptDialog` 输入后按 Enter resolve 输入的文字。

```sh
npx vitest run --project web src/ui/ui.test.tsx
```

## 第四步：主题与格式化

- `components/useTheme.ts`：读 `useSettings()` 的 `theme`，`light` / `dark` 直接设 `document.documentElement.dataset.theme`；`system` 时按 `matchMedia('(prefers-color-scheme: dark)')`，并监听变化。设置还没加载时按 `system` 处理。
- `web/src/format.ts`：`fmtDate(t)` → `2026.10.22`（空值 `—`）；`fmtMonthDay(t)` → `10月18日`；`fmtMDHM(t)` → `10月18日 09:05`。别的任务会复用。

## 第五步：侧边栏 `components/Sidebar.tsx`

照原型 `sidebarHTML` 和对应的点击动作：品牌、`＋ 新建卡片集`、全部卡片集（右侧 `＋` 新建分类、`✎` 切换分类编辑模式）、分类列表（编辑模式下每个分类右侧有重命名、删除按钮）、最近使用、回收站、我的统计、系统设置。用 `NavLink`/`useLocation` 判断当前项高亮（`/folder/:id` 高亮对应分类）。

- 新建卡片集：`api.decks.create({ folderId: 当前在分类页时为该分类 id })`，然后 `navigate('/deck/' + id, { state: { focusTitle: true } })`，并 `invalidateDeck(qc)`。
- 新建分类、重命名：`promptDialog`；删除分类：`confirmDialog`，文案照原型（有卡片集时提示会一起移到回收站，数量用该分类下卡片集的数量），删除后如果正在看这个分类就回到 `/`。

## 第六步：首页 `pages/HomePage.tsx`

`view` 为 `all | recent | trash | folder`（`folder` 时从路由取 `folderId`）。照原型 `homeHTML`、`deckCardHTML` 和第 713–760 行的动作：

- 标题：全部卡片集 / 最近使用 / 回收站 / 分类名。
- 排序 chip（最近使用页不显示）：`⇅ 按编辑时间` 等，点击弹出 7 个排序项（名称、编辑时间、创建时间、学习时间、下次复习时间、卡片数量、待学习卡片数量，对应 `DeckSort` 的 `name updated created studied next_due card_count fresh_count`），选中的打勾。当前排序存在设置 `homeSort` 里（`useSaveSettings`）。
- 搜索框：输入即过滤（传给 `useDecks` 的 `q`）。
- 卡片集卡片：封面（`cover` 以 `media/` 开头时前面加 `/`）、置顶图标、`···` 菜单按钮、标题、`卡片 N`、`◷ 未学习 N`、`需复习 N`（只在 > 0 时显示，橙色）、分类标签。点卡片进入 `/deck/:id`。
- `···` 菜单（非回收站）：打开、在新标签页打开（`window.open('/deck/' + id, '_blank')`）、置顶 / 取消置顶、从最近列表中删除（只在最近使用页）、分隔线、移动到分类（子菜单：不分类 + 各分类，当前的打勾）、创建副本（toast `已创建副本（学习进度不复制）`）、分隔线、删除（toast `已移到回收站`，带“撤销”）。
- 回收站：点卡片或 `···` 弹出 恢复（toast `已恢复`）/ 彻底删除（`confirmDialog` 二次确认）；回收站有内容时标题右侧多一个“清空回收站”按钮（`btn sm`），确认后 `api.decks.emptyTrash()`。
- 空状态文案照原型（回收站是空的 / 没有匹配的卡片集 / 还没有卡片集，点左上角“新建卡片集”）。
- 每个改动后 `invalidateDeck(qc, id)`。

测试 `web/src/pages/HomePage.test.tsx`：stub `fetch`，对 `/api/decks` 返回两个卡片集（一个 `counts.due` 为 3、一个为 0）、对 `/api/folders` 返回一个分类、对 `/api/settings` 返回 `DEFAULT_SETTINGS`；用 `QueryClientProvider` + `MemoryRouter` 渲染 `<HomePage view="all" />` 和 `<Overlays />`：

- 两个标题都显示；`需复习 3` 显示且只出现一次。
- 点第一个卡片的 `···`，菜单里有“置顶”“创建副本”“删除”；点“删除”后 `fetch` 收到 `DELETE /api/decks/<id>`，并出现 `已移到回收站`。
- `view="trash"` 时点卡片弹出“恢复”“彻底删除”。

```sh
npx vitest run --project web src/pages/HomePage.test.tsx
```

## 最后一步：收尾检查

```sh
npx vitest run --project web && npx tsc -p web --noEmit
```

通过的标准：web 下全部测试通过；类型检查没有错误；只改了上面列出的文件。全部通过后最后一行输出 `DONE`。
