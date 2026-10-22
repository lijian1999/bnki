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

export default function App() {
  useTheme();
  return (
    <>
      <Sidebar />
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
