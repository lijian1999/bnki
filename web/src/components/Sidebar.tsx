// 侧边栏：品牌、新建卡片集、导航、分类列表（含编辑模式）。结构、类名照原型 sidebarHTML。
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Folder } from '@bnki/shared';
import { api } from '../api';
import { invalidateDeck, useDecks, useFolders } from '../queries';
import { promptDialog, confirmDialog } from '../ui/dialogs';
import { toast } from '../ui/toast';

function errText(e: unknown): string {
  return typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' && e.message ? e.message : '操作失败';
}

export default function Sidebar(props: { onHide: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { data: folders = [] } = useFolders();
  const { data: decks = [] } = useDecks({});
  const [folderEdit, setFolderEdit] = useState(false);

  const path = location.pathname;
  const onFolder = path.startsWith('/folder/');
  const currentFolderId = onFolder ? decodeURIComponent(path.slice('/folder/'.length)) : undefined;

  const navItem = (to: string, ico: string, label: string, extra?: React.ReactNode) => (
    <div
      className={`nav-item${path === to ? ' active' : ''}`}
      key={to}
      onClick={() => navigate(to)}
    >
      <span className="ico">{ico}</span>
      <span className="grow">{label}</span>
      {extra}
    </div>
  );

  const newDeck = async (): Promise<void> => {
    try {
      const d = await api.decks.create(currentFolderId ? { folderId: currentFolderId } : {});
      invalidateDeck(qc, d.id);
      navigate(`/deck/${d.id}`, { state: { focusTitle: true } });
    } catch (e) {
      toast(errText(e));
    }
  };

  const newFolder = async (): Promise<void> => {
    const name = await promptDialog('新建分类', '', '分类名称');
    if (!name || !name.trim()) return;
    try {
      await api.folders.create(name.trim());
      invalidateDeck(qc);
    } catch (e) {
      toast(errText(e));
    }
  };

  const renameFolder = async (f: Folder): Promise<void> => {
    const name = await promptDialog('重命名分类', f.name);
    if (!name || !name.trim()) return;
    try {
      await api.folders.update(f.id, { name: name.trim() });
      invalidateDeck(qc);
    } catch (e) {
      toast(errText(e));
    }
  };

  const deleteFolder = async (f: Folder): Promise<void> => {
    const count = decks.filter((d) => d.folderId === f.id).length;
    const ok = await confirmDialog(
      '删除分类',
      count ? `分类「${f.name}」下的 ${count} 个卡片集会一起移到回收站。确定删除吗？` : `确定删除分类「${f.name}」吗？`,
      '删除',
      true,
    );
    if (!ok) return;
    try {
      // 服务端负责把分类下的卡片集移进回收站
      await api.folders.remove(f.id);
      invalidateDeck(qc);
      if (currentFolderId === f.id) navigate('/');
    } catch (e) {
      toast(errText(e));
    }
  };

  const goHomeWithFolderBtn = (
    <span className="nav-actions">
      <button
        className="mini-btn"
        title="新建分类"
        onClick={(e) => {
          e.stopPropagation();
          void newFolder();
        }}
      >
        ＋
      </button>
      <button
        className={`mini-btn${folderEdit ? ' on' : ''}`}
        title="编辑分类"
        onClick={(e) => {
          e.stopPropagation();
          setFolderEdit((v) => !v);
        }}
      >
        ✎
      </button>
    </span>
  );

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">b</div>
        bnki <span className="tag-p">本地</span>
        <button className="sidebar-toggle" title="收起侧边栏（⌘\）" onClick={props.onHide}>
          «
        </button>
      </div>
      <button className="btn-new-deck" onClick={() => void newDeck()}>
        ＋ 新建卡片集
      </button>
      {navItem('/', '⌂', '全部卡片集', goHomeWithFolderBtn)}
      {folders.map((f) => (
        <div
          key={f.id}
          className={`nav-item nav-folder${currentFolderId === f.id ? ' active' : ''}`}
          onClick={() => navigate(`/folder/${f.id}`)}
        >
          <span className="grow">📁 {f.name}</span>
          {folderEdit && (
            <span className="folder-edit-btns">
              <button
                title="重命名"
                onClick={(e) => {
                  e.stopPropagation();
                  void renameFolder(f);
                }}
              >
                ✎
              </button>
              <button
                title="删除"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteFolder(f);
                }}
              >
                🗑
              </button>
            </span>
          )}
        </div>
      ))}
      <div className="nav-sep" />
      {navItem('/recent', '◷', '最近使用')}
      {navItem('/trash', '🗑', '回收站')}
      <div className="nav-sep" />
      {navItem('/stats', '▤', '我的统计')}
      {navItem('/settings', '⚙', '系统设置')}
      <div style={{ flex: 1 }} />
    </aside>
  );
}
