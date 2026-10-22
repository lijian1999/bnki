// 卡片集相关的对话框：按 useUI().dialog.kind 显示其中一个。每个对话框组件的 props 都是 { deckId, onClose }。
import { useUI } from '../store';
import StudySettingsDialog from '../study/StudySettingsDialog';
import ImportDialog from './ImportDialog';
import ShortcutsDialog from './ShortcutsDialog';
import ExportDialog from './ExportDialog';
import MindmapDialog from './MindmapDialog';
import CoverDialog from './CoverDialog';

const DIALOGS = {
  studySettings: StudySettingsDialog,
  import: ImportDialog,
  shortcuts: ShortcutsDialog,
  export: ExportDialog,
  mindmap: MindmapDialog,
  cover: CoverDialog,
};

export default function DeckDialogs() {
  const dialog = useUI((s) => s.dialog);
  const close = useUI((s) => s.closeDialog);
  if (!dialog) return null;
  const C = DIALOGS[dialog.kind];
  return <C key={dialog.kind + dialog.deckId} deckId={dialog.deckId} onClose={close} />;
}
