# 交接：bnki 编排进度

## 目标
按 `docs/design.md`（设计）和 `prototype/`（原型）完整实现 bnki：P0（M1–M4）+ P1（M5）。接口约定 `docs/contracts.md`，执行者守则 `AGENTS.md`，派工记录 `docs/orchestration-notes.md`。

## 状态：全部批次完成
- 批次 1：t01-markdown、t02-library、t03-study、t04-io、t05-shell。
- 批次 2：t06-deck、t07-editor、t08-study、t09-pages、t10-export、t11-apkg。
- 批次 3（P1）：t12-editor（格式刷、`[[` 卡片链接）、t13-deck（链接跳转、`?card=` 定位、框选、朗读）、t14-search（首页搜卡片内容）、t15-import（Excel、.apkg 页签）。
- 补齐：t16-tts（朗读偏好：方式、范围、语言、语言筛选、语速、模式；设置页、卡片集 ⋯、学习 ⋮ 三处入口）。
- 编排者直接写：骨架与 shared 类型/调度、Tiptap schema 与往返、FTS5 搜索、`GET /api/items/:id`、封面对话框、导图、首次学习说明、编辑器里保留 `bnki://` 链接（`MdEnv.editor`）。
- 检查：`npx vitest run` 37 个文件 283 个用例全过；`npm run typecheck` 无错。浏览器实测过首页、卡片集、编辑器、学习、统计、设置、导入导出、封面、导图、链接跳转、格式刷、朗读，浅色和深色主题。
- 原型说明、P1/P2/砍 标签、原型控制条（含 `.proto-bar` 样式）都没有进正式版。

## 范围与对照
- 范围是 P0 + P1（§11 里程碑 M1–M5）。P2（AI 生成卡片集、测验与测验进度、录音和附件、AI 挖空/划重点/口诀/提示、智能导入、用复习记录优化 FSRS 参数）按 §1 “以后再说”和 §12 第 5 条“测验、AI 功能先不做”不实现；按 §10.1 也不显示占位入口。
- 和原型逐条对照过：把 `prototype/app.js` 里全部中文界面文字和正式代码比对，没对上的只剩原型说明、P1/P2 标签、占位入口、代码注释和 P2 功能。对照中补上了导出对话框的内容预览和“复制”、回收站的使用提示。
- 有意和原型不同、以设计文档为准的：统计页“累计学习卡片”（§1.6，原型写的是“累计学习次数”）；导出除了原型的预览和复制，还按 §8 提供 Markdown/HTML/CSV/JSON 下载和 HTML 打印。

## 已知问题
- 无。卡片链接折行点击、格式刷（单次、连续、Esc）、朗读偏好均已在浏览器里实测。

## 环境
- pi 连本地模型要绕开代理：`export NO_PROXY="$NO_PROXY,100.75.105.101" no_proxy="$no_proxy,100.75.105.101"` 再跑 `start_pi.sh`。
- 端口：后端 18420、Vite 18421、原型 18429（`.claude/launch.json`）。
