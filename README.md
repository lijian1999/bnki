# bnki

本地运行的卡片复习系统：卡片集、目录、笔记卡 / 问答卡 / 挖空，复习调度用 FSRS。数据存在本机 SQLite。

## 运行

需要 Node 24。

```sh
npm install
npm run dev        # 开发：后端 18420 + 前端 18421，浏览器打开 http://127.0.0.1:18421
npm run build      # 构建前端到 web/dist
npm start          # 生产：一个进程同时提供接口和页面，http://127.0.0.1:18420
```

## 端口

本项目占用 18420–18429：

| 端口 | 用途 |
| --- | --- |
| 18420 | 后端（`npm start` 时也提供页面） |
| 18421 | 前端开发服务器（Vite，代理 `/api`、`/media` 到 18420） |
| 18429 | 原型预览（`python3 -m http.server 18429 -d prototype`） |

后端命令行参数：`--port`（默认 18420）、`--host`（默认 127.0.0.1）、`--data`（数据目录）、`--web`（前端构建目录）。

## 数据

数据目录里有 `bnki.sqlite`、`media/`（图片）、`backups/`（每天第一次启动时自动备份，保留 14 份）。

## 测试

```sh
npm test
npm run typecheck
```
