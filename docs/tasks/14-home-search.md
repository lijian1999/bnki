# 任务 14：首页全局搜索卡片内容

先读 `AGENTS.md`，再读 `docs/contracts.md` 3.10（`GET /api/search`）和第 5 节，`docs/design.md` §1.1。再读 `web/src/pages/HomePage.tsx`、`web/src/pages/HomePage.test.tsx`。

本任务只改这些文件：

- 修改：`web/src/pages/HomePage.tsx`、`web/src/pages/HomePage.test.tsx`（只加用例，不删改已有的）。
- 新建：`web/src/styles/search.css`（在 `HomePage.tsx` 里 `import '../styles/search.css'`）。

现有接口：`api.search(q, limit)` → `SearchHit[]`（`{ id, deckId, deckTitle, cardType, front, text }`，`text` 是去掉 Markdown 的整张卡纯文本）。卡片链接跳转用 `/deck/<deckId>?card=<id>`（卡片集页会定位到这张卡）。

## 第一步：搜索结果区

首页现有的搜索框（placeholder `搜索卡片集`）继续按标题过滤卡片集，不变。另外：

- 搜索词 `trim()` 后非空时，防抖 250ms 用 `useQuery({ queryKey: ['search', q], queryFn: () => api.search(q, 30) })` 搜卡片内容（`enabled` 控制空串不请求）。只在 `全部卡片集`、`最近使用`、分类视图里搜；回收站视图不显示这一块。
- 卡片集网格下面加一块 `.search-hits`：标题 `<h3>卡片内容</h3>`，后面是灰字条数 `N 张`；没有结果时显示灰字 `没有找到包含“<词>”的卡片`；请求中不显示这一块。
- 每条 `.search-hit`（可点击的 `div`，`role="button"`）：
  - 第一行 `.sh-deck`：卡片集标题（灰字，小号）。
  - 第二行 `.sh-text`：命中片段。从 `text` 里找到搜索词第一次出现的位置（忽略大小写；搜索词里的空白去掉后再找，找不到就从头取），取前后各 30 个字符，前面被截掉加 `…`、后面被截掉加 `…`；片段里所有命中处包成 `<mark class="hit">`（用 React 元素拼，不要 `dangerouslySetInnerHTML`）。
- 点击一条：`navigate('/deck/' + deckId + '?card=' + id)`。
- 键盘：在搜索框里按 Enter 时如果有卡片内容结果，打开第一条。

样式写在 `search.css`：列表纵向排列、每条有 `var(--line)` 下边框、悬停背景 `var(--panel-2)`、`mark.hit` 用马克笔黄 `#fff1a8`。

## 第二步：测试（加在 `HomePage.test.tsx`）

沿用文件里已有的渲染与 `fetch` mock 方式，按 URL 返回：

- 输入 `调度` → 等防抖后请求 `/api/search?q=…&limit=30`；返回两条结果时页面出现 `卡片内容` 标题和 `2 张`，片段里有一个 `mark.hit` 的文字是 `调度`。
- 片段截断：`text` 是 60 个 `甲` + `调度` + 60 个 `乙` → 片段以 `…` 开头、以 `…` 结尾。
- 点击第一条 → 路径变成 `/deck/<deckId>`、search 是 `?card=<id>`（用 `MemoryRouter` 和一个显示 `useLocation()` 的小组件断言）。
- 返回 `[]` → 显示 `没有找到包含“调度”的卡片`。

## 最后一步：收尾检查

```sh
npx vitest run --project web src/pages/HomePage.test.tsx && npx tsc -p web --noEmit
```

通过的标准：`HomePage.test.tsx` 全部通过（含原有用例）；类型检查没有错误；只改了上面列出的文件。全部通过后最后一行输出 `DONE`。
