# 任务 01：共享 Markdown 渲染（挖空、马克笔、公式、白名单 HTML）

先读 `AGENTS.md`，再读接口约定 `docs/contracts.md` 第 4 节。本任务只新建这些文件：`shared/src/markdown/index.ts`、`shared/src/markdown/plugins.ts`、`shared/src/markdown/text.ts`、`shared/src/markdown/markdown.test.ts`。不要改别的文件。

## 背景

卡片内容存 Markdown。网格预览、学习页、导出都用这个模块把 Markdown 渲染成 HTML；编辑器用 `renderMarkdown(src, { editor: true })` 把 Markdown 转成 HTML 再载入。扩展语法见 `docs/design.md` §3.2、§3.3；原型的实现在 `prototype/md.js`（渲染部分可以参考，规则以本说明为准）。

## 第一步：`shared/src/markdown/plugins.ts`

导出 `export function bnkiPlugin(md: MarkdownIt): void`，给 markdown-it 实例加上以下规则：

1. **挖空 `{{内容}}`**：行内规则，加在 `emphasis` 之前。
   - 从 `{{` 开始向后找 `}}`：遇到换行就失败；遇到 `$` 或 `` ` `` 时，如果同一行后面还有一个相同字符，就跳过这一段（公式和行内代码里经常有 `}}`）。
   - `{{}}`（空内容）不算挖空，按普通文本输出。
   - 内部继续做行内解析（加粗、斜体、行内代码、马克笔、公式都可以套在里面）。
   - token：`cloze_open` / `cloze_close`。渲染 `cloze_open` 为 `<span class="cloze" data-i="N">`，N 取 `env.clozeIndex`（没有就从 0 开始），每输出一个加一。
   - `\{{x}}` 输出字面的 `{{x}}`（markdown-it 自带的反斜杠转义规则已经能做到，写测试确认）。
2. **马克笔 `==x==`**：行内规则，加在 `emphasis` 之前，`==` 和 `==` 之间不能为空，内部继续行内解析，渲染成 `<mark>…</mark>`。
3. **行内公式 `$x$`**：行内规则，加在 `escape` 之后。开头 `$` 后面不能是空白或 `$`，结尾 `$` 前面不能是空白，内容不能跨行。渲染成 `<span class="math" data-tex="<转义后的原文>" data-display="0">` + `katex.renderToString(tex, { throwOnError: false })` + `</span>`。
4. **块公式**：块规则，加在 `fence` 之前。行首是 `$$`：同一行以 `$$` 结尾就是单行公式；否则一直读到某一行 `trim()` 后以 `$$` 结尾；找不到结尾就不匹配。渲染成 `<div class="math-block"><span class="math" data-tex="…" data-display="1">` + `katex.renderToString(tex, { displayMode: true, throwOnError: false })` + `</span></div>`。
5. **任务列表**：core 规则。列表项里第一段文字以 `[ ] `、`[x] `、`[X] ` 开头时，给 `list_item_open` 加 `class="task"`，去掉这个前缀，并在这一段内容最前面输出 `<input type="checkbox" disabled> `（勾选的是 `<input type="checkbox" disabled checked> `）。
6. **图片**：覆盖 `image` 渲染规则：`src` 以 `media/` 开头时改成 `/media/…`；输出 `<img src="…" alt="…">`（alt 为图片文字，可以为空）。
7. **链接**：覆盖 `link_open` 渲染规则：`href` 以 `bnki://card/` 开头时输出 `<a href="#" data-card-link="<id>">`；其余链接加 `target="_blank" rel="noopener"`。
8. **白名单 HTML**：覆盖 `html_inline` 渲染规则。token 内容匹配下面任意一个正则就原样输出，否则用 `md.utils.escapeHtml` 转义后输出：
   ```
   ^<\/?u>$
   ^<br\s*\/?>$
   ^<mark(?: data-c="(?:yellow|green|blue|red|purple)")?(?: data-s="(?:line|wavy)")?>$
   ^<\/mark>$
   ^<span data-tc="(?:red|blue|green|grey)">$
   ^<span data-fs="(?:12|16|22|26)">$
   ^<\/span>$
   ```

## 第二步：`shared/src/markdown/text.ts`

- `export function plainText(md: MarkdownIt, src: string): string`：用 `md.parse(src, {})` 遍历 token 取文字：inline token 的 children 里 `text`、`code_inline` 的内容，`math_inline` 的 tex；块级 `fence`、`code_block` 的内容、块公式的 tex；`image` 输出 `[图片]`；`softbreak`、`hardbreak` 和块之间都当作一个空格。白名单 HTML 标签不输出。最后把连续空白合成一个空格并 `trim()`。
- `export function countCloze(md: MarkdownIt, src: string): number`：同样遍历 `md.parse` 的结果，数 `cloze_open` 的个数。

## 第三步：`shared/src/markdown/index.ts`

按 `docs/contracts.md` 第 4 节导出这五个函数：

- `createMd(opts?: { highlight?: boolean })`：`new MarkdownIt({ html: true, linkify: true, breaks: true })`，`md.disable('html_block')`，`md.use(bnkiPlugin)`。`highlight` 默认 true：用 highlight.js，代码块写了语言且 `hljs.getLanguage(lang)` 存在就 `hljs.highlight(code, { language: lang }).value`，否则 `hljs.highlightAuto(code).value`，出错返回 `''`；`highlight: false` 时不设高亮函数。highlight.js 用 `import hljs from 'highlight.js'`。
- 模块内缓存两个实例：带高亮的、不带高亮的。
- `renderMarkdown(src, opts?)`：`opts.editor` 为 true 用不带高亮的实例，否则用带高亮的。`env = { clozeIndex: 0 }`。`src` 为空时返回 `''`。
- `renderInline(src)`：带高亮实例的 `renderInline`，同样传 `env`。
- `plainText(src)`、`countCloze(src)`：用不带高亮的实例调用第二步的函数。

KaTeX 用 `import katex from 'katex'`。

## 第四步：测试 `shared/src/markdown/markdown.test.ts`

每条一个用例，断言输出里包含（或不包含）指定的 HTML 片段：

1. `TCP 的第二步是 {{SYN+ACK}}。` → 含 `<span class="cloze" data-i="0">SYN+ACK</span>`。
2. 一段里两个挖空 → `data-i="0"` 和 `data-i="1"` 都出现；连续两次调用 `renderMarkdown` 编号都从 0 开始。
3. `{{**volatile**}}` → 含 `<span class="cloze" data-i="0"><strong>volatile</strong></span>`。
4. ``{{`HashMap`}}`` → 挖空里是 `<code>HashMap</code>`。
5. `{{$x=\frac{1}{2}$}}` → 一个挖空，里面有 `class="math"`，`countCloze` 为 1。
6. `{{}}` 不产生挖空；`{{a\nb}}`（跨行）不产生挖空；`\{{x}}` 输出含 `{{x}}` 且不含 `class="cloze"`。
7. 代码块和行内代码里的 `{{x}}` 不产生挖空；`countCloze` 不计入。
8. `- 进程是 {{资源分配}} 的基本单位` → `<li>` 里有挖空（挖空在列表项、标题里都能用，标题也测一条 `### {{x}}`）。
9. `==重点==` → `<mark>重点</mark>`；`{{==x==}}` → 挖空里是 `<mark>x</mark>`。
10. `<mark data-c="red" data-s="wavy">x</mark>`、`<u>x</u>`、`<span data-tc="blue">x</span>`、`<span data-fs="22">x</span>` 原样保留。
11. `<script>alert(1)</script>`、`<img src=x onerror=1>`、`<span style="color:red">x</span>`、`<mark data-c="black">x</mark>` 都被转义（输出里不含 `<script`、`<img src=x`、`<span style`，含 `&lt;`）。单独一行的 `<div>x</div>` 也被转义。
12. `$x^2$` → 含 `class="math"`、`data-tex="x^2"`、`data-display="0"`、`katex`；`$5 和 $6` 不产生公式。
13. `$$\ne^{i\pi}+1=0\n$$` 和单行 `$$x$$` → 含 `<div class="math-block">`、`data-display="1"`。
14. 代码块 ```` ```java ```` → 含 `<pre><code class="language-java">` 和 `hljs-` 开头的类名；`editor: true` 时不含 `hljs-`，含转义后的原文。
15. `![](media/ab12.png)` → 含 `<img src="/media/ab12.png" alt="">`；`![x](https://a.com/b.png)` src 不变。
16. `[a](https://x.com)` → 含 `target="_blank"`；`[卡](bnki://card/abc)` → 含 `data-card-link="abc"`。
17. `- [ ] 待办` 和 `- [x] 完成` → 含 `class="task"`、`<input type="checkbox" disabled>`、`<input type="checkbox" disabled checked>`，输出里不再有 `[ ]`。
18. GFM 表格 → 含 `<table>`；`~~删除~~` → 含 `<s>删除</s>`。
19. 单个换行 → `<br>`（breaks 开启）。
20. `plainText`：`'**进程**是 {{资源分配}} 的单位\n- a\n- b'` → `'进程是 资源分配 的单位 a b'`；含图片的 → 含 `[图片]`；代码块的代码文字保留。
21. `countCloze('{{a}} {{b}}\n- {{c}}')` → 3。
22. `renderInline('**x** {{y}}')` → 含 `<strong>x</strong>` 和 `class="cloze"`，不含 `<p>`。

```sh
npx vitest run --project shared
```

应全部通过（含已有的 `scheduler.test.ts`）。

## 最后一步：收尾检查

```sh
npx vitest run --project shared && npx tsc -p shared --noEmit
```

通过的标准：测试全部通过；类型检查没有错误；只新建了上面列出的四个文件。全部通过后最后一行输出 `DONE`。
