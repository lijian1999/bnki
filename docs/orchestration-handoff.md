# 交接：bnki 编排进度

## 目标
按 `docs/design.md`（设计）和 `prototype/`（原型）完整实现 bnki：P0（M1–M4）+ P1（M5）。接口约定 `docs/contracts.md`，执行者守则 `AGENTS.md`，派工记录 `docs/orchestration-notes.md`。无人值守：每批结束覆盖写本文件，然后直接做下一批。

## 已完成
- 骨架、shared 类型/常量/FSRS 调度（`shared/src/scheduler.ts`）、服务端基础、前端脚手架：编排者直接写。
- 批次 1（已验收提交）：t01-markdown（`shared/src/markdown/`）、t02-library（`server/src/routes/library.ts`）、t03-study（study/stats/settings 路由）、t04-io（io/media/backup 路由、`shared/src/importText.ts`）、t05-shell（`web/src/api.ts`、`queries.ts`、`ui/`、Sidebar、HomePage）。
- 编排者直接改：`web/src/editor/schema.ts`（Tiptap 扩展 + docToMarkdown，含往返测试）、FTS5 trigram 搜索（`db.ts` 的 `items_fts` + 触发器，`routes/search.ts`，contracts 3.10，`api.search`）、`routes/export.ts`/`apkg.ts` 空壳已挂载、server 装了 `fflate`。

## 进行中：批次 2（18:57 派出）
t06-deck（`docs/tasks/06-deck-page.md`）、t07-editor（07）、t08-study（08）、t09-pages（09，统计/设置/导入/快捷键）、t10-export（10）、t11-apkg（11）。各自的新样式写在 `web/src/styles/<deck|editor|study|pages|export>.css`。验收要点：06/07/08 交互多，看 diff + 浏览器实测；10/11 是对外接口，通读。

## 下一批（批次 3，P1 收尾，说明未写）
- 封面对话框 `dialogs/CoverDialog.tsx`、导图 `dialogs/MindmapDialog.tsx`（用 plainText 按目录生成）。
- 编辑器：格式刷、`[[` 插入卡片链接（用 `api.search`）；卡片集页 `?card=<id>` 定位高亮。
- 首页全局搜卡片内容（`api.search`），卡片集朗读。
- ImportDialog 加 `.apkg` 页签（`api.io.importApkg`）。
- 深色主题检查。
- 最后：停掉占用 18421 的旧 python 服务，`preview_start bnki-dev` 浏览器端到端实测；全仓搜 `P1`、`砍`、`proto` 确认原型说明没进正式版。

## 环境
- pi 连本地模型要绕开代理：`export NO_PROXY="$NO_PROXY,100.75.105.101" no_proxy="$no_proxy,100.75.105.101"` 再跑 `start_pi.sh`。
- 端口：后端 18420、Vite 18421、原型 18429（`.claude/launch.json`）。
