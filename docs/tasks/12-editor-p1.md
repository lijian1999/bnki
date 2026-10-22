# 任务 12：编辑器 P1——格式刷、`[[` 插入卡片链接

先读 `AGENTS.md`，再读 `docs/contracts.md`（3.10 搜索、第 4 节的链接一行）、`docs/design.md` §1.3 和 §3（卡片链接 `[显示文字](bnki://card/<id>)`）。再读现有的 `web/src/editor/` 全部文件，弄清楚字段编辑器（`fields.tsx`）、工具栏（`Toolbar.tsx`）、命令（`commands.ts`）和弹窗（`EditorModal.tsx`）怎么连在一起。

本任务只改这些文件：

- 修改：`web/src/editor/Toolbar.tsx`、`web/src/editor/commands.ts`、`web/src/editor/fields.tsx`、`web/src/editor/EditorModal.tsx`。
- 新建：`web/src/editor/painter.ts`、`web/src/editor/painter.test.ts`、`web/src/editor/CardLinkPicker.tsx`、`web/src/editor/CardLinkPicker.test.tsx`。
- 样式写进 `web/src/styles/editor.css`（在已有内容后面追加，不改已有规则）。

不要改 `schema.ts`（`StarterKit` 的 link 已经配置了 `protocols: ['bnki']`，`bnki://card/<id>` 的链接能存进文档、`docToMarkdown` 能原样输出）。`web/src/api.ts` 已有 `api.search(q, limit)`，返回 `SearchHit[]`（`{ id, deckId, deckTitle, cardType, front, text }`）。

## 第一步：格式刷的纯函数 `painter.ts`

文档里的“格式”指这几种 mark：`bold`、`italic`、`underline`、`strike`、`highlight`、`textColor`、`fontSize`（名字见 `schema.ts` 和 StarterKit）。`cloze`、`link`、`code` 不算格式，格式刷不读也不改它们。

导出：

```ts
import type { Editor } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';

export const PAINT_MARKS: readonly string[]; // 上面 7 个名字
/** 取选区起点处的格式 mark（选区为空时取光标处的 storedMarks 或 $from.marks()）。 */
export function captureFormat(ed: Editor): Mark[];
/** 把选区 [from, to) 里的 7 种格式 mark 全部去掉，再加上 marks；选区为空时什么都不做，返回 false。 */
export function applyFormat(ed: Editor, marks: Mark[]): boolean;
```

`applyFormat` 用一个事务完成（`tr.removeMark` 每种格式，再 `tr.addMark` 每个 mark），这样撤销一次就回到原样。

测试 `painter.test.ts`（照 `roundtrip.test.ts` 用 `new Editor({ extensions: editorExtensions(), content: renderMarkdown(src, { editor: true }) })` 建编辑器，用 `docToMarkdown` 断言结果）：

- 源 `**粗** 普通`：光标放在“粗”里 capture，选中“普通”apply → `**粗** **普通**`。
- 源 `<span data-fs="22">大</span> ==黄== 字`：capture 选“大”，apply 到“黄”→“黄”不再有马克笔、变成 `<span data-fs="22">黄</span>`（断言输出里没有 `==黄==`、有 `<span data-fs="22">黄</span>`）。
- 带挖空：源 `**a** {{b}}`，capture “a”，apply 到“b”→ 输出里 `b` 仍在 `{{…}}` 里且加粗（断言包含 `{{` 和 `**b**`，两者顺序不限）。
- 空选区 apply 返回 `false`，文档不变。

```sh
npx vitest run --project web src/editor/painter.test.ts
```

## 第二步：格式刷按钮

在工具栏“清除格式”按钮后面加格式刷按钮：`label="🖌"`，`title="格式刷（单击用一次，双击连续用）"`，处于刷子状态时 `on` 高亮。`EditorApi` 加两个方法 `painter(sticky: boolean): void` 和只读状态（按你的连线方式，可以是 `Toolbar` 新增的 prop `painting: boolean`）。

行为（状态放在 `EditorModal.tsx`，作用于当前聚焦的字段编辑器）：

- 单击按钮：从当前字段的选区 capture 格式，进入刷子状态（一次性）。再单击一次（已在刷子状态）= 退出。
- 双击按钮：进入连续刷子状态。（单击和双击区分：`onClick` 里用 `e.detail`，`detail === 2` 时改成连续模式，不要另加计时器。）
- 刷子状态下，在任一字段里松开鼠标（`mouseup`）且选区非空 → `applyFormat`；一次性模式随后退出刷子状态，连续模式保持。
- 刷子状态下按 Esc：只退出刷子状态，不关闭编辑器（在 `Modal` 的 `onKeyDown`/关闭逻辑里先判断刷子状态）。
- 刷子状态下字段区域的鼠标指针是 `cursor: copy`（给编辑器根元素加类 `.painting`，样式写在 `editor.css`）。
- Markdown 源码模式下按钮禁用（`disabled` 或点了没反应都可以）。

在 `EditorModal.test.tsx` 现有风格之外，不需要为按钮写 jsdom 测试（jsdom 的选区和 mouseup 不可靠）；第一步的纯函数测试覆盖规则。

## 第三步：`[[` 插入卡片链接

新建 `CardLinkPicker.tsx`：

```ts
export interface CardLinkPickerProps {
  onPick(hit: { id: string; label: string }): void;
  onClose(): void;
}
export default function CardLinkPicker(props: CardLinkPickerProps): JSX.Element;
```

- 用 `Modal light`（`web/src/ui/Modal.tsx`），`className="card-link-dialog"`（宽 480px），`DialogHead` 标题 `插入卡片链接`。
- 一个自动聚焦的输入框 `.text-input`，placeholder `搜索卡片内容`。输入后防抖 200ms 调 `api.search(q, 20)`；空串不请求、列表清空。
- 结果列表：每项 `.cl-hit`，第一行是 `hit.front` 的纯文本（`plainText`，取第一行，最多 40 字），第二行灰字是 `hit.deckTitle`。当前项有 `.on`，↑/↓ 移动，Enter 或点击选中。没有结果且输入非空时显示灰字 `没有找到`。
- 选中时 `onPick({ id: hit.id, label })`，`label` 就是第一行显示的那段文字（为空时用 `卡片`）。

`fields.tsx` 里给 WYSIWYG 字段加触发：用户在编辑器里输入第二个 `[`，光标前两个字符是 `[[` 时，打开 `CardLinkPicker`（不要在代码块、行内公式、源码模式里触发）。

- 选中：删掉那两个 `[`，在原位置插入文本 `label`，带 link mark `{ href: 'bnki://card/' + id }`，光标放在链接后面，并让编辑器重新聚焦。
- 关闭（Esc、×、点遮罩）：保留已输入的 `[[`，编辑器重新聚焦。
- Esc 只关闭选择框，不能把整个编辑器弹窗也关掉（`Modal` 栈只让最上层响应键盘，正常使用即可）。

测试 `CardLinkPicker.test.tsx`（`vi.stubGlobal('fetch', …)` 按 URL 返回 JSON，`vi.useFakeTimers({ shouldAdvanceTime: true })` 或真实等待都行）：

- 输入 `进程` → 请求的 URL 含 `/api/search?q=%E8%BF%9B%E7%A8%8B`（或解码后 `q=进程`），列表出现两条结果。
- 按 ↓ 再按 Enter → `onPick` 收到第二条的 `{ id, label }`，`label` 是它 `front` 的纯文本第一行。
- 后端返回 `[]` 时显示 `没有找到`。

```sh
npx vitest run --project web src/editor/CardLinkPicker.test.tsx
```

## 最后一步：收尾检查

```sh
npx vitest run --project web src/editor && npx tsc -p web --noEmit
```

通过的标准：`src/editor` 下全部测试通过（包括已有的 `schema.test.ts`、`roundtrip.test.ts`、`EditorModal.test.tsx`）；类型检查没有错误；只改了上面列出的文件。全部通过后最后一行输出 `DONE`。
