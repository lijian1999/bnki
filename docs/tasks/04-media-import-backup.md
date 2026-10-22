# 任务 04：图片上传、文本 / Markdown 导入、备份与恢复

先读 `AGENTS.md`，再读接口约定 `docs/contracts.md` 第 2 节、3.7–3.9 节。本任务只改这些文件：`server/src/routes/media.ts`、`server/src/routes/io.ts`、`server/src/routes/backup.ts`（现在都是空壳，替换掉；`backup.ts` 里的 `autoBackup` 签名保持不变），新建 `shared/src/importText.ts`、`shared/src/importText.test.ts`、`server/src/routes/media.test.ts`、`server/src/routes/io.test.ts`、`server/src/routes/backup.test.ts`。不要改别的文件。本任务不做 `.apkg` 导入和导出接口。

## 背景

卡片集和卡片的接口由另一个任务同时在写，**本任务的测试不要调用 `/api/decks`、`/api/items`**：测试里直接用 `ctx.db` 插入 `decks` 行、用 SQL 查 `items` 行验证。测试用 `buildApp({ dataDir: <每个用例新建的临时目录>, memory: <见各步> })`。

新建 items 的位置：追加在该卡片集现有未删除 items 的最大 `position` 之后，依次 +1。新建卡片同时写 `edit_logs`（`action 'create'`），并刷新卡片集 `updated_at`。

## 第一步：`shared/src/importText.ts`

```ts
export interface ImportRow { section: string | null; front: string; back: string }
export function parseImportText(text: string, format: 'tsv' | 'csv', firstColumnIsSection: boolean): ImportRow[];
```

规则：
- 按行切分（`\r\n` 和 `\n` 都算），去掉全是空白的行。
- `tsv`：每行按 `\t` 分列。`csv`：标准 CSV，双引号包住的字段里可以有逗号、换行和 `""`（表示一个 `"`）；带引号字段里的换行属于字段内容，不切行。
- 每列去掉首尾空白。`firstColumnIsSection` 为 true 时第一列是目录名（空串当作 null），其后依次是正面、背面；否则第一列正面、第二列背面。多余的列忽略，缺的列当作空串。
- 正面为空的行跳过。

测试（`importText.test.ts`）：tsv 两列、tsv 一列、带目录列、空行跳过、CSV 引号里有逗号和换行、`""` 转义、`\r\n` 换行、正面为空的行跳过、多余列忽略。

```sh
npx vitest run --project shared src/importText.test.ts
```

## 第二步：文本导入、Markdown 导入（`routes/io.ts`）

**`POST /api/import/text`**（3.8）：用 `parseImportText` 解析。每行一张卡：背面非空是问答卡（`card_type 'qa'`，`front`、`back`），否则笔记卡（`card_type 'note'`，只有 `front`）。`firstColumnIsSection` 为 true 时：某行的目录名和上一张导入的卡片不同且非空，就先新建一个 level 1 目录（标题是目录名）再放卡片；同名且连续的复用。返回新建的卡片数和目录数。卡片集不存在 404；解析出 0 张卡时 400。

**`POST /api/import/markdown`**（3.8）：

- 行首 `#`～`#####`（后面跟空格）是目录，`#` 的个数就是 level，标题是去掉 `#` 和首尾空白的文字。代码块（```` ``` ```` 围起来的部分）里的 `#` 行不算标题。
- 目录之间的正文按 `split` 切成卡片（全部是笔记卡，`front` 是这段 Markdown 原文，去掉首尾空行）：
  - `item`：每个顶层列表项（行首没有缩进的 `- `、`* `、`+ `、`1. ` 开头）连同它下面缩进的行是一张卡，`front` 去掉顶层的列表标记；不在列表项里的段落按 `paragraph` 规则处理。
  - `paragraph`：用空行分隔的段落各是一张卡；代码块内部的空行不切。
  - `hr`：用单独一行的 `---` 分隔。
- `{{}}` 原样保留。空的段落不产生卡片。

测试（`io.test.ts`，用 `memory: true`）：
- 文本导入 tsv：3 行（其中 1 行有背面）→ `{ cards: 3, sections: 0 }`，数据库里 1 张 qa、2 张 note，顺序和输入一致，`position` 在原有 items 之后。
- 带目录列：`第一章\t问1\t答1`、`第一章\t问2`、`第二章\t问3` → 2 个目录、3 张卡，顺序是 目录1、卡、卡、目录2、卡。
- 空文本 → 400；卡片集不存在 → 404。
- Markdown 导入 `item`：`# 进程\n- 进程是 {{资源分配}} 的单位\n  - 子项\n- 线程\n## 调度\n段落一\n\n段落二` → 目录 `进程`(1)、卡 `进程是 {{资源分配}} 的单位\n  - 子项`、卡 `线程`、目录 `调度`(2)、卡 `段落一`、卡 `段落二`。（子项的缩进保留原样即可，断言卡片包含 `子项`。）
- Markdown 导入 `hr`：`a\n\n---\nb` → 两张卡 `a`、`b`。
- 代码块里的 `# comment` 不变成目录，代码块里的空行不切卡。

```sh
npx vitest run --project server src/routes/io.test.ts
```

## 第三步：图片上传（`routes/media.ts`）

按 3.7 实现 `POST /api/media`。读取上传文件用 `@fastify/multipart`（`app.ts` 已注册）：`const file = await req.file()`，`const buf = await file.toBuffer()`，`file.mimetype`、`file.filename`。不是 `image/*` 或没有文件时 400。hash 用 `node:crypto` 的 sha256。

测试（`media.test.ts`，`memory: true`，但临时目录是真的，文件会写到 `ctx.mediaDir`）：用 `app.inject` 发 multipart 请求（自己拼 `multipart/form-data` 请求体：boundary、`Content-Disposition: form-data; name="file"; filename="a.png"`、`Content-Type: image/png`、内容）。
- 上传一个 PNG 字节内容 → `{ path: 'media/<16位十六进制>.png' }`，文件存在于 `ctx.mediaDir`，`media` 表有一行。
- 同样内容再传一次 → 同一个 path，`media` 表仍然只有一行。
- `GET /<path>`（即 `/media/xxx.png`）→ 200，内容一致。
- 上传 `text/plain` → 400。

```sh
npx vitest run --project server src/routes/media.test.ts
```

## 第四步：备份与恢复（`routes/backup.ts`）

按 3.9 实现三个接口和 `autoBackup(ctx)`：

- 备份名：`YYYYMMDD-HHmmss`（本地时间，用 `ctx.now()`）；同一秒已存在时加后缀 `-2`、`-3`……
- 备份：`ctx.db.exec("VACUUM INTO '<目录>/bnki.sqlite'")`（路径里的单引号要转义成两个），再用 `fs.cpSync(ctx.mediaDir, <目录>/media, { recursive: true })`。
- `GET /api/backups`：列出 `ctx.backupsDir` 下含 `bnki.sqlite` 的子目录，`createdAt` 是目录的修改时间（毫秒），`size` 是 `bnki.sqlite` 的字节数，按名字降序。
- 恢复：备份不存在 404；`ctx.dbFile` 是 `':memory:'` 时 400（内存库不能恢复）。否则按顺序：先备份当前数据（名字后缀 `-before-restore`）；`ctx.db.close()`；复制备份的 `bnki.sqlite` 覆盖 `ctx.dbFile`；删除 `ctx.dbFile` 同目录下的 `bnki.sqlite-wal`、`bnki.sqlite-shm`（存在的话）；删除 `ctx.mediaDir` 后用备份里的 `media` 复制过来；最后 `ctx.db = openDb(ctx.dbFile)`（`openDb` 从 `../db` 导入）。不要调用 `ctx.reopen()`（它会再关一次已关闭的连接）。
- `autoBackup(ctx)`：`ctx.dbFile` 是 `':memory:'` 时直接返回。今天（本地日期 `YYYYMMDD`）已经有以它开头、且不带 `-before-restore` 后缀的备份就不做；否则做一次。然后只保留按名字降序的前 14 个**不带** `-before-restore` 后缀的备份，其余的删掉（`fs.rmSync(..., { recursive: true })`）；带后缀的不删。

测试（`backup.test.ts`，用 `memory: false`，临时目录，`now` 可控）：
- 插入一个卡片集 → `POST /api/backup` → 返回的名字对应目录下有 `bnki.sqlite` 和 `media/`；`GET /api/backups` 有它。
- 备份后删掉那个卡片集，再 `restore` 那个备份 → 卡片集回来了（用 `ctx.db` 查）；`GET /api/backups` 里多了一个 `-before-restore` 结尾的。
- 恢复不存在的名字 → 404。
- `autoBackup`：同一天调两次只产生一个备份；把 `now` 依次设成连续 16 天各调一次 → 只剩 14 个。
- 内存库调 `autoBackup` 不报错、不产生备份。

```sh
npx vitest run --project server src/routes/backup.test.ts
```

## 最后一步：收尾检查

```sh
npx vitest run --project shared src/importText.test.ts && npx vitest run --project server src/routes/io.test.ts src/routes/media.test.ts src/routes/backup.test.ts src/app.test.ts && npx tsc -p server --noEmit
```

通过的标准：列出的测试全部通过；类型检查没有错误（如果类型错误只出在本任务以外的文件里，在结果里写明是哪个文件）；只改了上面列出的文件。全部通过后最后一行输出 `DONE`。
