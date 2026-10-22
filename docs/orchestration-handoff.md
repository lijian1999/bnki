# 交接：bnki 编排进度

## 目标
按 `docs/design.md`（设计）和 `prototype/`（原型）完整实现 bnki：P0（M1–M4）+ P1（M5）。接口约定 `docs/contracts.md`，执行者守则 `AGENTS.md`，派工记录 `docs/orchestration-notes.md`。

## 状态：全部批次完成
- 批次 1：t01-markdown、t02-library、t03-study、t04-io、t05-shell。
- 批次 2：t06-deck、t07-editor、t08-study、t09-pages、t10-export、t11-apkg。
- 批次 3（P1）：t12-editor（格式刷、`[[` 卡片链接）、t13-deck（链接跳转、`?card=` 定位、框选、朗读）、t14-search（首页搜卡片内容）、t15-import（Excel、.apkg 页签）。
- 编排者直接写：骨架与 shared 类型/调度、Tiptap schema 与往返、FTS5 搜索、`GET /api/items/:id`、封面对话框、导图、首次学习说明、编辑器里保留 `bnki://` 链接（`MdEnv.editor`）。
- 检查：`npx vitest run` 35 个文件 264 个用例全过；`npm run typecheck` 无错。浏览器实测过首页、卡片集、编辑器、学习、统计、设置、导入导出、封面、导图、链接跳转，浅色和深色主题。
- 原型说明、P1/P2/砍 标签、原型控制条（含 `.proto-bar` 样式）都没有进正式版。

## 已知小问题
- 卡片链接折成两行时，点两行之间的空白处会选中卡片而不跳转；点在文字上正常。
- 格式刷只做了纯函数测试，没有在浏览器里点过。
- 卡片集 ⋯ 菜单里没有“朗读偏好”入口（朗读速度和语言在系统设置里改）。

## 环境
- pi 连本地模型要绕开代理：`export NO_PROXY="$NO_PROXY,100.75.105.101" no_proxy="$no_proxy,100.75.105.101"` 再跑 `start_pi.sh`。
- 端口：后端 18420、Vite 18421、原型 18429（`.claude/launch.json`）。
