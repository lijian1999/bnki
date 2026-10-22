# bnki · 工作约定

你是执行者。任务说明由编排者（Claude）给出，完成后由编排者独立验收，所以：
- 严格按任务说明做，不要做说明之外的功能，不要改说明没提到的文件。
- 说明里写的接口、字段名、文件路径必须一字不差。
- 说明有歧义时，按 `docs/contracts.md`（接口约定）和 `docs/design.md`（设计文档）判断。
- 完成前必须亲自运行说明里列出的检查命令，全部通过才算完成。不能跳过测试、不能为了通过而删改测试断言。
- 不要执行改动 git 状态的命令（`add`、`commit`、`reset`、`checkout`、`stash`、`merge` 等），版本由编排者管理；`git diff`、`git status`、`git log` 这类只读命令可以用。
- 最后一行只输出 `DONE` 或 `FAILED: <原因>`。

## 工作方式

- 任务说明里写了“第一步”“第二步”的，按顺序做，每一步做完就运行那一步给出的命令。
- 说明里有歧义或自相矛盾的地方：按最直接的理解做，继续往下，最后在结果里写明你是怎么理解的。
- 一项检查试了两次仍然通不过、又判断不了是代码的问题还是说明的问题：停下来，最后一行写 `FAILED: <卡在哪里>`，由编排者处理。

## 结果报告

结束时的最后一条回复只写这几项，不要复述任务说明，不要贴代码：

- 改动的文件：每个一行。
- 检查命令：每条一行，写通过还是没通过；没通过的附上关键的报错行。
- 歧义的处理、说明里的漏洞或错误：逐条写；没有就写“无”。
- 最后一行：`DONE` 或 `FAILED: <原因>`。

## 环境

- 本机 macOS，项目在 `/Users/kris/projects/bnki`，所有命令在项目根目录运行。
- Node 24，npm workspaces（`shared`、`server`、`web`）。依赖已经装好。

## 目录

- `docs/design.md`：设计文档（只读）。
- `docs/contracts.md`：接口约定（只读）。先读它。
- `prototype/`：HTML 原型（只读）。界面的结构、类名、文案、交互以它为准：`app.js` 是全部界面逻辑，`styles.css` 是样式，`md.js` 是原型的 Markdown 规则，`fsrs.js`、`data.js` 是原型用的调度和示例数据。
- `shared/src/`：前后端共用代码。`types.ts`、`constants.ts`、`scheduler.ts` 只读。
- `server/src/`：后端。`db.ts`、`util.ts`、`mappers.ts`、`settings.ts`、`app.ts`、`cli.ts` 只读，除非任务说明让你改。
- `web/src/`：前端。`main.tsx`、`App.tsx`、`store.ts`、`dialogs/DeckDialogs.tsx` 只读，除非任务说明让你改。
- `data/`：本地运行时的数据目录，不要动。

## 技术约束

- TypeScript（strict）。前端 React 19 + Vite + TanStack Query + Zustand + react-router-dom 7；编辑器 Tiptap 3 + prosemirror-markdown；后端 Fastify 5 + better-sqlite3；调度 ts-fsrs（已封装在 `shared/src/scheduler.ts`）。
- 测试框架 vitest：`npx vitest run --project shared|server|web [文件]`。前端测试环境是 jsdom，可以用 `@testing-library/react`。
- 类型检查：`npm run typecheck`。
- 不要安装新依赖。确实需要时在结果里说明，由编排者处理。
- 不要启动长期运行的服务（`npm run dev`、`vite`、`tsx watch`），后端用 `app.inject` 测，前端用 jsdom 测。

## 绝对不能做的事

- 不要改 `prototype/`、`docs/`、`data/`、`.claude/`、`.orch/`。
- 不要改 `package.json`、`package-lock.json`、各包的 `package.json`、`tsconfig*.json`、`vite.config.ts`、`vitest.config.ts`。
- 不要删除或改写别的任务的测试。

## 风格

- 注释和界面文字用中文。注释只写“为什么”和不明显的规则，不要逐行解释。
- 界面文字沿用原型文案。原型里的说明性灰字、`P1` / `P2` / `砍` 标签、点了只弹“放在 P1”的占位入口、底部原型控制条、示例数据，一律不要搬进正式实现；还没做的功能直接不显示。
- 不写 `any` 能避免就避免；不写 `console.log` 调试输出。
