import { Route, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import HomePage from './pages/HomePage';
import DeckPage from './pages/DeckPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import EditorModal from './editor/EditorModal';
import StudyModal from './study/StudyModal';
import DeckDialogs from './dialogs/DeckDialogs';
import Overlays from './ui/Overlays';
import { useTheme } from './components/useTheme';
import { useCardLinks } from './components/useCardLinks';
import { useSidebar } from './components/useSidebar';

export default function App() {
  useTheme();
  useCardLinks();
  const side = useSidebar();
  return (
    <>
      {side.hidden ? (
        <div className="sidebar-rail">
          <button className="sidebar-toggle" title="展开侧边栏（⌘\）" onClick={side.toggle}>
            »
          </button>
        </div>
      ) : (
        <Sidebar onHide={side.toggle} />
      )}
      <main className="main" id="main">
        <Routes>
          <Route path="/" element={<HomePage view="all" />} />
          <Route path="/recent" element={<HomePage view="recent" />} />
          <Route path="/trash" element={<HomePage view="trash" />} />
          <Route path="/folder/:folderId" element={<HomePage view="folder" />} />
          <Route path="/deck/:deckId" element={<DeckPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      <EditorModal />
      <StudyModal />
      <DeckDialogs />
      <Overlays />
    </>
  );
}
