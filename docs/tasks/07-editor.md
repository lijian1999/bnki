# 任务 07：卡片编辑器弹窗

先读 `AGENTS.md`，再读接口约定 `docs/contracts.md`（3.3、3.7、第 4 节、第 5 节）和设计文档 `docs/design.md` 的 §1.3、§3.2–§3.4。本任务只改这些文件：

- 替换空壳：`web/src/editor/EditorModal.tsx`。
- 新建：`web/src/editor/` 目录下的其他文件（工具栏、字段组件、公式对话框、命令函数等，怎么拆由你定）和测试 `web/src/editor/EditorModal.test.tsx`。
- 需要新样式时追加到 `web/src/styles/app.css` 末尾（不改已有规则）。

不要改别的文件，**`web/src/editor/schema.ts` 和 `schema.test.ts` 只读**。

## 背景

界面照原型还原：`prototype/app.js` 第 918–1418 行（`openEditor` 到 `editorDone`），样式类名已在 `app.css` 里（`.editor-dialog`、`.editor-head`、`.editor-toolbar`、`.tb`、`.field`、`.wysiwyg`、`textarea.src`、`.editor-foot`、`.md-help`、`.add-hint` 等）。原型用 `contenteditable` + `execCommand` 手写；正式版用 **Tiptap**（`@tiptap/react` 的 `useEditor` / `EditorContent`）。原型里这些**不要搬**：字段底部的录音、附件按钮，工具栏的格式刷按钮，类型菜单上的 `P1` 标签，标题菜单里的 `字号（P1）` 字样（字号本任务要做，见下）。

已经写好、验证过的部分在 `web/src/editor/schema.ts`：

- `editorExtensions()`：全部 Tiptap 扩展（StarterKit、带高亮的代码块、挖空 `cloze`、马克笔 `highlight`（属性 `c`、`s`）、文字颜色 `textColor`（属性 `tc`）、字号 `fontSize`（属性 `fs`）、行内公式 `mathInline` / 公式块 `mathBlock`（属性 `tex`，KaTeX 显示）、行内图片 `image`、表格、任务列表）。`{{文字}}`、`==文字==` 的输入规则已经在里面；`# `、`- `、`1. `、`> `、```` ``` ````、`**x**`、`*x*`、`` `x` `` 由 StarterKit 自带。
- `docToMarkdown(doc)`：编辑器文档 → Markdown。

Markdown → 编辑器：`editor.commands.setContent(renderMarkdown(md, { editor: true }))`（或作为 `useEditor` 的 `content`），`renderMarkdown` 从 `@bnki/shared/markdown` 导入。编辑器 → Markdown：`docToMarkdown(editor.state.doc)`。

用到的现成模块：`web/src/store.ts`（`useUI().editor`：`{ deckId, cardId?, afterId? } | null`，`closeEditor`）、`web/src/api.ts`、`web/src/queries.ts`（`useItems`、`useSettings`、`useSaveSettings`、`invalidateDeck`）、`web/src/ui/`（`Modal`、`DialogHead`、`toast`、`openMenu`、`confirmDialog`、`promptDialog`、`Swatches`）、`@bnki/shared`（`CARD_TYPE_NAMES`、`CARD_COLORS`、`MARK_COLORS`、`TEXT_COLORS`、`FONT_SIZES`）。占位文字用 `@tiptap/extensions` 的 `Placeholder`。

## 第一步：弹窗骨架和状态

`useUI().editor` 不为 null 时渲染 `<Modal className="editor-dialog" …>`（遮罩点击和 Esc 都是“保存并关闭”）。状态：

- `type`：编辑已有卡片时用卡片的 `cardType`；新建时用设置的 `lastCardType`。
- `color`：同上，新建时用 `lastCardColor`。
- `md: { front, hint, back }`：已有卡片从 `useItems(deckId)` 的数据里按 `cardId` 找；新建时为空串。
- `showHint`：已有卡片 `hint` 非空时为 true。
- `src: { front?: boolean; hint?: boolean; back?: boolean }`：哪些字段处在源码模式。
- `dirty`、`help`（是否显示 Markdown 语法说明）。

结构照原型 `buildEditor`：

- 头部：类型按钮 `笔记卡片 ▾`（菜单：笔记卡片、问答卡片、主题卡片，当前的打勾）、颜色按钮（色块 + `颜色`，菜单里放 `<Swatches>`）、灰字 `编辑卡片` / `新建卡片`（新建且设置 `continuousNew` 为 true 时加 ` · 连续新建`）、`Markdown 语法` 按钮（切换 `.md-help` 说明，文案照原型 `mdHelpHTML`）、`×`。
- 工具栏（主题卡没有）。
- 字段：笔记卡一个字段 `内容`（占位 `输入内容。选中文字按 ⌘E 挖空，或直接输入 {{答案}}`）；问答卡 `问题`（占位 `输入问题，⌘E 挖空，支持 Markdown`）→ `＋ 提示` 按钮（点开后变成 `提示` 字段，较小，占位 `可填写口诀、速记、关键词或易错提醒，学习时先于答案显示`，并聚焦）→ `答案`（占位 `输入答案`）；主题卡是 `标题` 单行输入框（占位 `主题标题`）+ `内容（纯文本，无样式）` 文本域。
- 每个富文本字段：`.field` 里有 `.field-label`、右上角 `M↓ 源码` 按钮（源码模式时加 `on`）、内容区（所见即所得时是 Tiptap 的 `EditorContent`，外层带 `wysiwyg md` 类；源码模式时是 `textarea.src`，自动增高，最小 110px）、底部 `.field-foot` 只有一个图片按钮。聚焦的字段加 `focus` 类。
- 底部：提示 `⌘E 挖空 · ⌥↩ 切换正反面 · ⌘↩ 完成 · Esc 保存并关闭`、`完成 ⌘↩` 按钮。
- 打开时聚焦第一个字段，光标放到末尾。

切换源码模式：先把当前内容同步到 `md`（所见即所得 → `docToMarkdown`），再切换显示；切回所见即所得时用 `md` 重新 `setContent`。同一字段来回切换不改变 Markdown 内容。

切换类型：切到主题卡先 `confirmDialog('切换为主题卡片', '主题卡片只有标题和纯文本内容，样式和图片会被清除。', '切换')`，确认后 `front = plainText(front).slice(0, 60)`、`back = plainText(back)`（`plainText` 从 `@bnki/shared/markdown` 导入）。

## 第二步：工具栏和快捷键

工具栏照原型 `toolbarHTML` 的顺序（去掉格式刷）：`T ▾`、`🖍 ▾`、分隔、B、I、U、`[ 挖空 ]`（`cloze-btn`）、分隔、清除格式（原型里的 SVG 图标）、链接、撤销、恢复、分隔、无序列表、有序列表、引用、代码块、公式、图片。按钮用 `onMouseDown={e => e.preventDefault()}` 防止编辑器失焦。光标所在格式对应的按钮加 `on` 类（加粗、斜体、下划线、挖空、列表、引用、代码块）。

工具栏作用于**最后一个获得焦点的字段**。该字段在源码模式时：加粗、斜体、挖空、下划线分别在文本域选区两侧插入 `**`、`*`、`{{ }}`、`<u> </u>`（照原型 `wrapTextarea`）；其余按钮 toast `源码模式下请直接写 Markdown`。还没有聚焦过任何字段时 toast `先点一下要编辑的输入框`。

各命令（`editor.chain().focus()…`）：

- 加粗 / 斜体 / 下划线：`toggleBold` / `toggleItalic` / `toggleUnderline`。
- **挖空**（按钮、⌘E、⌘K）：
  - 选区跨了不同的块（`$from.parent !== $to.parent`）→ toast `挖空不能跨行，请分别选中每一行`。
  - 光标（无选区）在挖空里 → `extendMarkRange('cloze').unsetMark('cloze')`（整个挖空取消）。
  - 其余 → `toggleMark('cloze')`（有选区时加上或去掉；无选区时之后输入的文字是挖空）。
- 清除格式：`unsetAllMarks()`。
- 链接：`promptDialog('添加链接', 'https://', '输入网址')`；有选区时 `setLink({ href })`，否则插入链接文字为网址本身的链接。
- 撤销 / 恢复、无序列表、有序列表、引用、代码块：`undo` / `redo` / `toggleBulletList` / `toggleOrderedList` / `toggleBlockquote` / `toggleCodeBlock`。
- `T ▾` 菜单：正文（`setParagraph`）、一级标题 / 二级标题 / 三级标题（`toggleHeading({ level })`，`kbd` 显示 `# ` 等）、分隔线、`{ header: '字号' }`、小号 12 / 中号 16 / 大号 22 / 特大 26（`setMark('fontSize', { fs: '12' })` 等）、默认字号（`unsetMark('fontSize')`）。
- `🖍 ▾` 菜单照原型 `markerMenu`：用 `{ render }` 菜单项画三行——马克笔 5 色（黄 = `setMark('highlight', {})`，绿 / 蓝 / 红 / 紫 = `{ c: 'green' }` 等）、划线（下划线 `{ s: 'line' }`、波浪线 `{ s: 'wavy' }`）、文字颜色 4 种（`setMark('textColor', { tc: 'red' })` 等，颜色值见原型）；点色块后关闭菜单。再加一项“清除马克笔和颜色”（`unsetMark('highlight').unsetMark('textColor')`）。没有选区时 toast `请先选中文字`。
- 公式：打开一个小对话框（`Modal light` + `DialogHead`，标题 `插入公式（LaTeX）`），输入框（等宽字体，占位 `例：x^2+y^2=z^2`）下方实时显示 KaTeX 预览（`katex.renderToString(tex, { throwOnError: false })`）；确定（或 Enter）后在原光标处插入 `mathInline` 节点（`insertContent({ type: 'mathInline', attrs: { tex } })`），取消（或 Esc）什么都不做。
- 图片：弹出文件选择（`input type=file accept=image/*`），选中后 `api.media.upload(file)` 得到 `{ path }`，插入 `setImage({ src: '/' + path })`。

快捷键（在 Tiptap 的 `editorProps.handleKeyDown` 或弹窗 `onKeyDown` 里处理；⌘ 在 Windows 上是 Ctrl）：

- ⌘E、⌘K：挖空（同上）。
- ⌘Enter：完成（见第三步）。
- Esc：保存并关闭（`Modal` 已经把 Esc 交给 `onClose`）。输入法组字中（`isComposing`）的 Esc 不处理。
- ⌥Enter：焦点移到下一个字段（问题 → 提示 → 答案 → 问题，依次循环；主题卡在两个输入框之间），光标放末尾。
- ⌘B / ⌘I / ⌘U / ⌘Z / ⌘⇧Z、列表里的 Tab / ⇧Tab 由 Tiptap 自带。

## 第三步：粘贴、拖入图片

在每个 Tiptap 编辑器的 `editorProps` 里：

- `handlePaste`：剪贴板里有图片文件时，逐个 `api.media.upload` 后插入图片，返回 true。否则剪贴板只有 `text/plain`（没有 `text/html`）且文字像 Markdown（原型的判断：`/(^|\n)\s*([-*] |\d+\. |#{1,6} |> |```)|\{\{|\*\*|==|\$/`）时，`insertContent(renderMarkdown(text, { editor: true }))`，返回 true。其余交给 Tiptap 默认处理（网页 HTML 会按扩展的解析规则清洗）。
- `handleDrop`：拖入的文件里有图片时上传并插入到放下的位置，返回 true。

## 第四步：保存

- 取出当前内容：所见即所得字段 `docToMarkdown`，源码字段取文本域，主题卡取两个输入框。
- 内容为空（`front`、`back` 去掉空白后都为空）时不保存。
- 新建：`api.items.create({ deckId, kind: 'card', afterId, cardType: type, color, front, hint: type === 'qa' ? hint : '', back: type === 'note' ? '' : back })`。`afterId` 是 `undefined` 时不传（= 末尾）。
- 编辑：内容、类型或颜色有变化时 `api.items.update(cardId, { cardType, color, front, hint, back })`（同样的 hint / back 规则）。
- 保存成功后 `invalidateDeck(qc, deckId)`，并 `useSaveSettings()({ lastCardType: type, lastCardColor: color })`（和当前设置相同时不调）。
- **保存并关闭**（Esc、点遮罩）：保存后 `closeEditor()`。
- **完成**（按钮、⌘Enter）：新建且设置 `continuousNew` 为 true 时——内容为空 toast `卡片是空的` 并留在编辑器；否则保存，`afterId` 改成新卡片的 id，清空所有字段（类型、颜色不变）并聚焦第一个字段，toast `已保存，继续新建下一张`。其余情况等同保存并关闭。
- **×**：有未保存的修改时 `confirmDialog('放弃修改？', '关闭后，本次修改不会保存。', '放弃修改', true)`，确认才关闭（不保存）；没有修改直接关闭。
- 保存出错时 toast `保存失败`，不关闭。

## 第五步：测试 `web/src/editor/EditorModal.test.tsx`

用 `vi.stubGlobal('fetch', …)` 按 URL 和方法返回数据并记录调用：`/api/settings` 返回 `{ ...DEFAULT_SETTINGS, lastCardType: 'qa' }`，`/api/decks/d1/items` 返回一张笔记卡 `c1`（`front: '进程是 {{**资源**分配}} 的单位'`），`POST /api/items` 返回一张新卡片（id `n1`），`PATCH /api/items/c1` 返回更新后的卡片。渲染 `QueryClientProvider` 包住的 `<EditorModal />` 和 `<Overlays />`，用 `useUI.getState().openEditor(...)` 打开（放在 `act` 里）。

- 编辑 c1：内容区里有 `.cloze`，其中有 `strong`；点 `M↓ 源码` 后文本域的值等于 `进程是 {{**资源**分配}} 的单位`；再切回来 `.cloze` 还在。
- 编辑 c1：切到源码模式，把文本域改成 `新内容 {{x}}`，按 Esc（在弹窗上 `keyDown`）→ 收到 `PATCH /api/items/c1`，body 的 `front` 是 `新内容 {{x}}`，弹窗关闭（`useUI.getState().editor` 为 null）。
- 新建（`openEditor({ deckId: 'd1' })`）：默认是问答卡（有 `问题`、`答案` 两个标签和 `＋ 提示` 按钮）；点 `＋ 提示` 出现 `提示` 字段。
- 新建、`continuousNew` 为 true：问题字段切源码填 `Q1`，点 `完成` → 收到 `POST /api/items`（`cardType: 'qa'`、`front: 'Q1'`），弹窗没关，出现 `已保存，继续新建下一张`。
- 新建时什么都不填直接按 Esc → 没有 `POST /api/items`，弹窗关闭。
- 改了内容后点 `×` → 出现 `放弃修改？`。

```sh
npx vitest run --project web src/editor/EditorModal.test.tsx
```

## 最后一步：收尾检查

```sh
npx vitest run --project web && npx tsc -p web --noEmit
```

通过的标准：web 下全部测试通过；类型检查没有错误（如果类型错误只出在本任务以外的文件里，在结果里写明是哪个文件）；只改了上面列出的文件。全部通过后最后一行输出 `DONE`。
