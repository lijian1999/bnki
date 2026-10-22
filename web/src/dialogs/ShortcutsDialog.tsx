// 快捷键对话框：三张表照原型 shortcutsDialog；非 Mac 把 ⌘ 显示成 Ctrl。
import type { JSX } from 'react';
import { Modal, DialogHead } from '../ui/Modal';
import '../styles/pages.css';

export interface DeckDialogProps {
  deckId: string;
  onClose: () => void;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

/** Windows / Linux 上 Command 键显示为 Ctrl。 */
function keyName(k: string): string {
  return IS_MAC ? k : k.replace(/⌘/g, 'Ctrl');
}

type Rows = [string, string][];

function Table(props: { rows: Rows }): JSX.Element {
  return (
    <table className="kbd-table">
      <tbody>
        {props.rows.map(([name, keys]) => (
          <tr key={name}>
            <td>{name}</td>
            <td>{keys.split(' ').map((k) => <kbd key={k}>{keyName(k)}</kbd>)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ShortcutsDialog(props: DeckDialogProps): JSX.Element {
  const { onClose } = props;
  return (
    <Modal light onClose={onClose}>
      <DialogHead title="快捷键与操作" onClose={onClose} />
      <div className="dialog-body">
        <h4 className="kbd-group">卡片管理</h4>
        <Table
          rows={[
            ['新建卡片 / 新建目录', 'C D'],
            ['在选中项后面添加卡片 / 目录', '⌥C ⌥D'],
            ['编辑', 'E'],
            ['打开（全部卡片模式）', 'Enter'],
            ['删除（可撤销）', '⌫'],
            ['移动选择 / 扩展选择', '↑↓←→ ⇧+方向键'],
            ['全选 / 多选', '⌘A ⌘+点击'],
            ['搜索', '⌘F'],
            ['拖动排序；⌥+拖动只移动目录标题', '拖动'],
          ]}
        />
        <h4 className="kbd-group">学习</h4>
        <Table
          rows={[
            ['忘记了 / 模糊 / 记住了', '1 2 3'],
            ['显示 / 隐藏答案', '空格'],
            ['显示下一个挖空 / 全部', 'V ⇧V'],
            ['显示提示', 'H'],
            ['上一张 / 下一张', '← →'],
            ['编辑 / 朗读 / 关闭', 'E R Esc'],
          ]}
        />
        <h4 className="kbd-group">编辑器</h4>
        <Table
          rows={[
            ['挖空', '⌘E'],
            ['挖空（另一个键）', '⌘K'],
            ['加粗 / 斜体 / 下划线', '⌘B ⌘I ⌘U'],
            ['列表缩进', 'Tab ⇧Tab'],
            ['切换正面 / 背面', '⌥↩'],
            ['完成（连续新建）', '⌘↩'],
            ['保存并关闭', 'Esc'],
          ]}
        />
      </div>
    </Modal>
  );
}
