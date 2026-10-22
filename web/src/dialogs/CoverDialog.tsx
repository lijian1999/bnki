// 设置封面：上传图片（存进 media）或填 URL；照原型 coverDialog。
import { useRef, useState, type JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { invalidateDeck, useDeck } from '../queries';
import { Modal, DialogHead } from '../ui/Modal';
import { toast } from '../ui/toast';

export interface DeckDialogProps {
  deckId: string;
  onClose: () => void;
}

export default function CoverDialog(props: DeckDialogProps): JSX.Element | null {
  const { deckId, onClose } = props;
  const qc = useQueryClient();
  const deck = useDeck(deckId).data;
  const cover = deck?.cover ?? null;
  // 上传的图片是 media/ 路径，不回填到 URL 框
  const [url, setUrl] = useState(cover && /^https?:/.test(cover) ? cover : '');
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async (next: string | null): Promise<void> => {
    try {
      await api.decks.update(deckId, { cover: next });
      invalidateDeck(qc, deckId);
      onClose();
    } catch {
      toast('保存失败');
    }
  };

  const onFile = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    try {
      const { path } = await api.media.upload(f, f.name);
      await save(path);
    } catch {
      toast('上传失败');
    }
  };

  if (!deck) return null;
  return (
    <Modal light onClose={onClose}>
      <DialogHead title="设置卡片集封面" onClose={onClose} />
      <div className="dialog-body">
        <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => fileRef.current?.click()}>
          上传封面图片
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        <div className="form-row">
          <input className="text-input" placeholder="或输入图片 URL" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="hint-text">图片显示比例 3:2</div>
      </div>
      <div className="dialog-foot">
        {cover && <button className="btn danger" onClick={() => void save(null)}>移除封面</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={() => void save(url.trim() || cover)}>确定</button>
      </div>
    </Modal>
  );
}
