# 任务 16：朗读偏好（范围、语言筛选、语速、模式）

先读 `AGENTS.md`，再读 `docs/design.md` §1.2、§1.7 里朗读的几行。再读 `web/src/study/StudyModal.tsx`（`speak`、按键 `R`、`go`）、`web/src/pages/DeckPage.tsx`（“朗读”一节：`speakText`、`speakFrom`、`toggleSpeak`）、`web/src/pages/SettingsPage.tsx`（“朗读偏好”一组）、`web/src/study/studyMenus.tsx`、`web/src/deck/menus.tsx`、`web/src/dialogs/DeckDialogs.tsx`。

`Settings` 已经有这些字段（`shared/src/types.ts`，默认值在 `shared/src/constants.ts`，后端已校验）：

```ts
ttsRate: number;                         // 语速，默认 1
ttsLang: string;                         // 朗读语言，'' = 自动
ttsScope: 'visible' | 'card';            // 朗读范围：当前可见 / 整张卡，默认 'visible'
ttsLangFilter: 'all' | 'foreign';        // 全部语言 / 只读外语，默认 'all'
ttsMode: 'once' | 'continuous' | 'loop'; // 单次 / 连续 / 单卡循环，默认 'once'
```

`store.ts` 和 `deck/menus.tsx` 的 `DeckDialogKind` 已经加了 `'ttsPrefs'`。

本任务只改这些文件：

- 新建：`web/src/tts.ts`、`web/src/tts.test.ts`、`web/src/dialogs/TtsPrefsDialog.tsx`、`web/src/dialogs/TtsPrefsDialog.test.tsx`。
- 修改：`web/src/pages/SettingsPage.tsx`、`web/src/dialogs/DeckDialogs.tsx`、`web/src/deck/menus.tsx`、`web/src/study/studyMenus.tsx`、`web/src/study/StudyModal.tsx`、`web/src/pages/DeckPage.tsx`；`web/src/study/StudyModal.test.tsx`、`web/src/pages/DeckPage.test.tsx` 只加用例，不删改已有的。

## 第一步：纯函数 `web/src/tts.ts`

```ts
import type { Settings } from '@bnki/shared';

/** 把 Markdown 里没揭示的挖空 `{{…}}` 换成“空白”。挖空按出现顺序从 0 编号；`revealed` 里的编号保留原文（去掉花括号）。 */
export function hideClozes(src: string, revealed: ReadonlySet<number>): string;
/** 只读外语：去掉汉字（Unicode Script=Han）和全角标点（U+3000–U+303F、U+FF00–U+FFEF），连续空白压成一个空格，首尾去空白。 */
export function foreignOnly(text: string): string;
/** 按设置做最后处理：先 plainText（从 '@bnki/shared/markdown' 导入），ttsLangFilter 是 'foreign' 时再 foreignOnly，最后 trim。 */
export function ttsText(src: string, s: Pick<Settings, 'ttsLangFilter'>): string;
/** 建一条语音：rate = s.ttsRate，s.ttsLang 非空时设 lang。 */
export function utter(text: string, s: Pick<Settings, 'ttsRate' | 'ttsLang'>): SpeechSynthesisUtterance;
/** 浏览器有没有朗读：window.speechSynthesis 存在且 SpeechSynthesisUtterance 有定义。 */
export function canSpeak(): boolean;
```

`hideClozes` 的挖空规则和渲染一致：`{{` 到同一行里最近的 `}}`，内容不能为空（`{{}}` 不算挖空、原样保留）。可以用 `/\{\{([^\n]+?)\}\}/g`。

测试 `tts.test.ts`：
- `hideClozes('a {{x}} b {{y}}', new Set([1]))` → `'a 空白 b y'`；空集合两个都换；`{{}}` 不算。
- `foreignOnly('苹果 apple，香蕉 banana。')` → `'apple banana'`；全是汉字时得到 `''`。
- `ttsText('**粗** text', { ttsLangFilter: 'all' })` → `'粗 text'`（以 `plainText` 实际输出为准，断言里没有 `*`）；`foreign` 时得到 `'text'`。

```sh
npx vitest run --project web src/tts.test.ts
```

## 第二步：朗读偏好的界面

`TtsPrefsDialog.tsx`（`export default function TtsPrefsDialog(props: { deckId: string; onClose: () => void })`，`deckId` 不用）：`Modal light` + `DialogHead` 标题 `朗读偏好`，内容就是下面这组设置行；改动立即保存（用 `SettingsPage` 里现有的保存方式：同一个 mutation / `api.settings.put`，并让设置查询刷新）。

把这组设置行抽成同一个组件（放在 `TtsPrefsDialog.tsx` 里导出 `TtsPrefsRows`），`SettingsPage` 的“朗读偏好”一组也改成用它，两处显示一致。各行（行的结构、`Seg` 分段按钮、`select-input` 沿用 `SettingsPage` 现有写法，需要的话把 `Row`、`Seg` 从 `SettingsPage` 导出复用）：

| 标题 | 灰字说明 | 控件 |
|---|---|---|
| 朗读方式 | 使用系统自带的语音 | 灰字 `系统朗读`（不可选） |
| 朗读范围 | 当前可见：只读已经显示出来的内容；整张卡：正面和背面都读 | 分段：`当前可见` / `整张卡` |
| 语言 | （无） | 现有的语言下拉，不变 |
| 语言筛选 | 只读外语时跳过汉字 | 分段：`全部语言` / `只读外语` |
| 语速 | （无） | 分段：`0.8` / `0.9` / `1.0` / `1.1` / `1.2` |
| 朗读模式 | 单次：读完停止；连续：读完自动下一张；单卡循环：反复读当前卡片 | 分段：`单次` / `连续` / `单卡循环` |

接入：
- `DeckDialogs.tsx` 的表里加 `ttsPrefs: TtsPrefsDialog`。
- 卡片集 ⋯ 菜单（`deck/menus.tsx`）在 `学习设置` 后面加 `{ label: '朗读偏好', icon: '🔈', onClick: () => a.openDialog('ttsPrefs', a.deckId) }`。
- 学习弹窗 ⋮ 菜单（`studyMenus.tsx`）在 `学习设置` 后面加同样一项（`useUI.getState().openDialog('ttsPrefs', ops.deckId)`）。

测试 `TtsPrefsDialog.test.tsx`（`fetch` 按 URL 返回，`GET /api/settings` 返回 `DEFAULT_SETTINGS`）：点 `整张卡` → 发出 `PUT /api/settings`，body 含 `"ttsScope":"card"`；点 `单卡循环` → body 含 `"ttsMode":"loop"`；点 `只读外语` → body 含 `"ttsLangFilter":"foreign"`。

## 第三步：学习弹窗按设置朗读

`StudyModal.tsx` 的 `speak` 改成：

- 不支持：`toast('浏览器不支持朗读')`（用 `canSpeak()`）。
- 文本（再经过 `ttsText`）：
  - `ttsScope === 'card'`：问答卡 `正面 + '。' + 背面`；笔记卡、主题卡 `正面`，背面非空时再加 `'。' + 背面`。挖空全部原文读出。
  - `ttsScope === 'visible'`：只读界面上已显示的部分。问答卡没显示答案时只读题目那一面（现有的 `qSrc`），显示答案后两面都读；笔记卡读 `hideClozes(正面, view.revealed)`，背面在界面上显示出来时（现有的显示背面的那个条件）才加；主题卡同理。
  - 文本为空：不读，`toast('没有可朗读的内容')`。
- 模式（朗读中 🔈 按钮加类 `on`，`title` 改成 `停止朗读`；朗读中再按 `R` 或再点 🔈 = 停止，调用 `speechSynthesis.cancel()`）：
  - `once`：读完停止。
  - `loop`：读完这张再读一遍，直到停止、换卡（`go` / 评分后进入下一张）或关闭弹窗。
  - `continuous`：读完这张后，如果还停在这张卡，就切到下一张（和按 → 一样）并朗读它；没有下一张时停止。手动换卡不停，从新卡接着读；关闭弹窗停止。
- 关闭学习弹窗（组件卸载）时 `speechSynthesis.cancel()`。
- 读的时候用 `utter(text, settings)` 建语音；每次开始新的一条前先 `speechSynthesis.cancel()`。用一个递增的 ref 序号判断 `onend` 是否还属于当前这次朗读，过期的 `onend` 直接忽略。

测试（加在 `StudyModal.test.tsx`，沿用已有的 mock；`vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn() })`，stub 一个记录 `text`、有 `onend` 属性的最小 `SpeechSynthesisUtterance` 类）：
- 设置 `ttsScope: 'visible'`，问答卡未显示答案按 `r` → `speak` 收到的 `text` 只有题目；`ttsScope: 'card'` 时含题目和答案。
- `ttsMode: 'loop'`：按 `r` 后手动调用第一条语音的 `onend()` → `speak` 被调用第二次，`text` 相同。
- `ttsLangFilter: 'foreign'`：卡片正面 `苹果 apple` → `text` 是 `apple`。

## 第四步：卡片集页按设置朗读

`DeckPage.tsx` 现有的整集朗读改成：

- 不支持时提示改用 `canSpeak()`。
- 每张卡的文本（再经过 `ttsText`，空文本的卡跳过）：
  - `ttsScope === 'card'`：问答卡 `正面 + '。' + 背面`，其他卡 `正面`（背面非空再加 `'。' + 背面`）。
  - `ttsScope === 'visible'`：看卡片集“显示选项 → 答案内容”（`display.showAnswer`）：关着时问答卡只读正面；开着时同 `card`。笔记卡的挖空在卡片网格里是显示的，原文读出。
- 模式：`once`、`continuous` 都是按顺序读完列表后停止；`loop` 读完最后一张后从第一张重新开始，直到再点 🔈 或离开页面。
- 语音用 `utter(text, settings)`。

测试（加在 `DeckPage.test.tsx`）：`ttsMode: 'loop'`、两张卡时，依次调用前两条语音的 `onend()` → 第三条 `speak` 的 `text` 等于第一张卡的文本；`ttsScope: 'visible'` 且 `showAnswer: false` 时问答卡的 `text` 不含背面。

## 最后一步：收尾检查

```sh
npx vitest run --project web && npx tsc -p web --noEmit
```

通过的标准：web 全部测试通过（含原有用例）；类型检查没有错误；只改了上面列出的文件。全部通过后最后一行输出 `DONE`。
