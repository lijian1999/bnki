# 任务 11：导入 Anki 牌组（.apkg）

先读 `AGENTS.md`，再读接口约定 `docs/contracts.md`（第 2 节、3.8）。本任务只改这些文件：

- 替换空壳：`server/src/routes/apkg.ts`。
- 新建：`server/src/apkg/`（读包、转换内容的函数，文件怎么分自己定），测试 `server/src/apkg/apkg.test.ts`、`server/src/routes/apkg.test.ts`，测试用的造包函数放 `server/src/apkg/fixture.ts`。

不要改别的文件。`server/src/app.ts` 已经挂载了 `routes/apkg.ts` 的默认导出（`register(app, ctx)`）；解压用已安装的 `fflate`（`unzipSync`、`zipSync`），zstd 用 Node 自带的 `zlib.zstdDecompressSync` / `zlib.zstdCompressSync`。

## 背景：.apkg 的结构

.apkg 是一个 zip，里面有：

- 集合数据库（SQLite），按这个顺序找第一个存在的：
  1. `collection.anki21b`：zstd 压缩过的 SQLite（新版 Anki 导出），先 `zlib.zstdDecompressSync` 再打开。
  2. `collection.anki21`：普通 SQLite。
  3. `collection.anki2`：普通 SQLite。
- 媒体清单 `media`：
  - 旧格式：JSON 文本，`{"0": "a.png", "1": "b.jpg"}`，键是 zip 里的文件名，值是原文件名。
  - 新格式（有 `collection.anki21b` 时）：zstd 压缩的 protobuf。判断方法：文件开头 4 字节是 `28 b5 2f fd`（zstd 魔数）就是新格式。解压后按下面的结构读，第 i 个条目对应 zip 里的文件 `String(i)`：
    ```
    message MediaEntries { repeated MediaEntry entries = 1; }
    message MediaEntry { string name = 1; uint32 size = 2; bytes sha1 = 3; }
    ```
    protobuf 自己写一个最小的解析器：每个字段先读一个 varint 作为 key，`字段号 = key >> 3`、`类型 = key & 7`；类型 0 是 varint，类型 2 是“长度（varint）+ 字节”，类型 1 / 5 分别跳过 8 / 4 字节。外层只取字段 1（每个都是一个 MediaEntry 的字节），内层只取字段 1（UTF-8 文件名），其余字段跳过。
- 媒体文件：zip 里名字是 `0`、`1`……；新格式下每个文件也是 zstd 压缩的（同样用魔数判断，是就解压）。

数据库里要读的东西（两种表结构都要支持）：

- 笔记：`notes` 表，`id`、`mid`（笔记类型 id）、`flds`（各字段用 `\x1f` 分隔）。
- 卡片：`cards` 表，`nid`（笔记 id）、`did`（牌组 id）、`ord`。
- 牌组名：
  - 有 `decks` 表（新结构）时：`SELECT id, name FROM decks`，名字的层级用 `\x1f` 分隔。
  - 否则（旧结构）：`SELECT decks FROM col`，是 JSON 对象 `{ "<id>": { "name": "父::子" } }`，层级用 `::` 分隔。
- 不需要读笔记类型：用内容判断是不是挖空笔记（见下）。

## 第一步：读包 `readApkg(buf: Buffer): ApkgData`

```ts
interface ApkgNote { id: number; fields: string[]; deckPath: string[] }   // deckPath：这条笔记 ord 最小的那张卡片所在牌组的路径
interface ApkgData { notes: ApkgNote[]; media: Map<string, Buffer> }       // media 的键是原文件名
```

- 集合数据库写到临时文件（`os.tmpdir()` 下）再用 `better-sqlite3` 只读打开，读完关闭并删除临时文件。
- 没有卡片的笔记丢掉。笔记按 `deckPath` 的字典序（逐级比较）再按笔记 `id` 排序。
- 不是 zip、或者里面没有集合数据库：抛出 `badRequest('不是有效的 .apkg 文件')`（`../util`）。

测试（`apkg.test.ts`）：在 `fixture.ts` 里写 `buildApkg(opts: { format: 'legacy' | 'new'; decks: Record<number, string>; notes: { id: number; flds: string[]; did: number }[]; media?: Record<string, Buffer> }): Buffer`：用 `better-sqlite3` 在临时文件里建表（只建上面要读的表和列：`notes(id, mid, flds)`、`cards(id, nid, did, ord)`；`legacy` 建 `col(decks)` 并写 JSON，名字用 `::`；`new` 建 `decks(id, name)`，名字用 `\x1f`），按格式放进 zip（`new`：`collection.anki21b` 和 `media` 都用 zstd 压缩，media 清单用 protobuf 编码，媒体文件也压缩；`legacy`：`collection.anki2` + JSON 清单）。两种格式各测一次：笔记数、字段、`deckPath`、媒体内容都读对；非 zip 内容抛错。

## 第二步：转换内容 `ankiToMarkdown(html: string): string`

Anki 字段是 HTML，转成 bnki 的 Markdown（语法见 `docs/contracts.md` 第 4 节）：

| Anki | 结果 |
|---|---|
| `{{c1::内容}}`、`{{c2::内容::提示}}` | `{{内容}}`（编号、提示都去掉） |
| `<b>`/`<strong>` | `**…**` |
| `<i>`/`<em>` | `*…*` |
| `<u>` | `<u>…</u>` |
| `<s>`/`<strike>`/`<del>` | `~~…~~` |
| `<br>`、`<div>…</div>`、`<p>…</p>` | 换行（div/p 结束处换行；连续 3 个以上换行压成 2 个） |
| `<ul><li>a</li><li>b</li></ul>` | `- a\n- b`；`<ol>` 用 `1. ` `2. ` |
| `<img src="a.png">` | `![](media/<新文件名>)`，新文件名由调用方传入的映射给出（见第三步）；映射里没有就丢掉这张图 |
| `[sound:x.mp3]` | 去掉 |
| `\(…\)` | `$…$` |
| `\[…\]` | `$$…$$`（单独成段） |
| `&nbsp;` `&lt;` `&gt;` `&amp;` `&quot;` `&#39;` 以及 `&#数字;` | 解码成字符 |
| 其他标签（`span`、`font`、`a` 等） | 去掉标签，保留文字 |

签名实际是 `ankiToMarkdown(html: string, mediaMap: Map<string, string>): string`（原文件名 → `media/xxx.png`）。结果去掉首尾空白。

测试：上表每一行至少一条用例；组合用例 `<div><b>{{c1::进程}}</b>是资源分配的单位</div><div>见&nbsp;<img src="a.png"></div>` → `**{{进程}}**是资源分配的单位\n见 ![](media/h.png)`（映射 `a.png → media/h.png`）。

## 第三步：接口 `POST /api/import/apkg`

multipart，字段 `file`，查询参数 `deckId`。卡片集不存在 404；没有文件或 `readApkg` 失败 400；没有笔记 400 `没有解析出卡片`。

1. 媒体：每个文件按 `routes/media.ts` 的规则存（内容 sha256 前 16 位作文件名，扩展名按原文件名，已存在就不重复写，写 `media` 表），得到原文件名 → `media/<hash>.<ext>` 的映射。只存扩展名是 png/jpg/jpeg/gif/webp/svg 的；`mime` 按扩展名给。
2. 目录：所有笔记的 `deckPath` 如果第一级都相同，去掉第一级。剩下的路径按顺序展开成目录：路径变化时，从第一个不同的层级开始，为每一级插一个目录（`level` = 层级，从 1 开始，超过 5 的都算 5；`title` = 那一级的名字）。路径为空的笔记放在最前面、不属于任何目录。
3. 卡片：
   - 第一个字段转换后含 `{{` 挖空的 → 笔记卡 `note`：`front` = 第一个字段；第二个字段非空时追加 `\n\n` + 第二个字段。
   - 否则 → 问答卡 `qa`：`front` = 第一个字段；`back` = 其余非空字段用 `\n\n` 连接。
   - 都是新卡（不导入复习记录），`hint` 为空串，追加到卡片集末尾（`position` 接着现有最大值往后排），每张卡片写一条 `edit_logs`（`action = 'create'`），照 `routes/io.ts` 的 `/api/import/text` 的写法；全部插入放在一个事务里；最后更新卡片集 `updated_at`。
4. 返回 `{ cards, sections }`。

测试（`routes/apkg.test.ts`，`buildApp({ dataDir: <临时目录>, memory: true })`，用 `app.inject` 发 multipart 请求，请求体自己拼 `multipart/form-data` 边界）：用 `buildApkg` 造一个包：牌组 `根`、`根::第一章`、`根::第一章::1.1`、`根::第二章`；一条基础笔记（2 个字段）在 `根::第一章`，一条挖空笔记 `{{c1::进程}}是单位` 在 `根::第一章::1.1`，一条带图片的基础笔记在 `根::第二章`。断言：返回 `{ cards: 3, sections: 3 }`；items 按 position 依次是 目录 第一章(1)、问答卡、目录 1.1(2)、笔记卡（`front` 是 `{{进程}}是单位`）、目录 第二章(1)、问答卡（`front` 含 `![](media/`）；`ctx.mediaDir` 里有那张图片。卡片集不存在 → 404；上传非 zip → 400。

```sh
npx vitest run --project server src/apkg src/routes/apkg.test.ts
```

## 最后一步：收尾检查

```sh
npx vitest run --project server && npx tsc -p server --noEmit
```

通过的标准：server 下全部测试通过；类型检查没有错误（如果类型错误只出在本任务以外的文件里，在结果里写明是哪个文件）；只改了上面列出的文件。全部通过后最后一行输出 `DONE`。
