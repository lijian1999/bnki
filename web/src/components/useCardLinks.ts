// 卡片链接：渲染出的 `<a href="#" data-card-link="<id>">` 点击后跳到所在卡片集并定位这张卡。
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { toast } from '../ui/toast';
import { useUI } from '../store';

export function useCardLinks(): void {
  const navigate = useNavigate();
  const closeStudy = useUI((s) => s.closeStudy);
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const t = e.target as Element | null;
      if (!t || typeof t.closest !== 'function') return;
      if (t.closest('.ProseMirror')) return; // 编辑器里的链接交给编辑器
      const a = t.closest('a[data-card-link]');
      const id = a?.getAttribute('data-card-link');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      api.items
        .get(id)
        .then((item) => {
          if (useUI.getState().study) closeStudy();
          navigate(`/deck/${item.deckId}?card=${id}`);
        })
        .catch(() => toast('卡片不存在或已删除'));
    };
    // 按下时就截住：否则卡片网格先把这张卡选中、重渲染换掉了 <a>，click 落不到链接上
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Element | null;
      if (!t || typeof t.closest !== 'function' || t.closest('.ProseMirror')) return;
      if (t.closest('a[data-card-link]')) e.stopPropagation();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('click', onClick, true);
    };
  }, [navigate, closeStudy]);
}
