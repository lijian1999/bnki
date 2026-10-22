// 导出对话框：格式 / 挖空 / 范围三个选项，下面是导出内容的预览，底部复制、下载或调起打印。接口 GET /api/export/:deckId。
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import type { SectionItem } from '@bnki/shared';
import { api } from '../api';
import { useItems } from '../queries';
import { Modal, DialogHead } from '../ui/Modal';
import { toast } from '../ui/toast';
import '../styles/export.css';

export interface DeckDialogProps {
  deckId: string;
  onClose: () => void;
}

type Format = 'md' | 'html' | 'csv' | 'json';
type Cloze = 'keep' | 'answer';
type Scope = 'all' | 'sections';

const FORMATS: [Format, string][] = [
  ['md', 'Markdown'],
  ['html', 'HTML'],
  ['csv', 'CSV'],
  ['json', 'JSON'],
];

export default function ExportDialog(props: DeckDialogProps): JSX.Element {
  const { deckId, onClose } = props;
  const [format, setFormat] = useState<Format>('md');
  const [cloze, setCloze] = useState<Cloze>('keep');
  const [scope, setScope] = useState<Scope>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const { data } = useItems(deckId);

  const sections: SectionItem[] = useMemo(() => (data ?? []).filter((it) => it.kind === 'section') as SectionItem[], [data]);

  // 选中的目录一个都没勾上时没什么可导的
  const params = { format, cloze, ...(scope === 'sections' ? { sections: picked.join(',') } : {}) };
  const url = api.io.exportUrl(deckId, params);
  const canDownload = scope === 'all' || picked.length > 0;

  // 预览就是将要下载的文件内容（inline=1 让后端不带附件头）
  const previewUrl = api.io.exportUrl(deckId, { ...params, inline: 1 });
  const preview = useQuery({
    queryKey: ['export-preview', previewUrl],
    queryFn: async () => {
      const r = await fetch(previewUrl);
      if (!r.ok) throw new Error(String(r.status));
      return r.text();
    },
    enabled: canDownload,
  });
  const text = canDownload ? (preview.data ?? '') : '';

  const box = useRef<HTMLTextAreaElement>(null);
  // 剪贴板 API 没有权限时（嵌入页面、非安全上下文）退回到选中文本框再执行复制
  const copyBySelection = (): boolean => {
    const el = box.current;
    if (!el) return false;
    el.focus();
    el.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  };
  const copy = (): void => {
    const fallback = (): void => toast(copyBySelection() ? '已复制' : '复制失败，请手动选择');
    if (!navigator.clipboard) {
      fallback();
      return;
    }
    navigator.clipboard.writeText(text).then(() => toast('已复制'), fallback);
  };

  const download = (): void => {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    onClose();
  };

  const print = (): void => {
    window.open(previewUrl, '_blank');
  };

  const toggle = (id: string): void => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  return (
    <Modal light className="export-dialog" onClose={onClose}>
      <DialogHead title="导出" onClose={onClose} />
      <div className="dialog-body">
        <div className="form-row">
          <label>格式</label>
          <div className="seg">
            {FORMATS.map(([v, name]) => (
              <button key={v} className={format === v ? 'on' : ''} onClick={() => setFormat(v)}>
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className="form-row">
          <label>挖空</label>
          <div className="seg">
            <button className={cloze === 'keep' ? 'on' : ''} onClick={() => setCloze('keep')}>
              保留挖空
            </button>
            <button className={cloze === 'answer' ? 'on' : ''} onClick={() => setCloze('answer')}>
              显示答案
            </button>
          </div>
        </div>
        <div className="form-row">
          <label>范围</label>
          <div className="seg">
            <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
              全部
            </button>
            <button className={scope === 'sections' ? 'on' : ''} onClick={() => setScope('sections')}>
              选中目录
            </button>
          </div>
          {scope === 'sections' && (
            <div className="opt-list export-sections">
              {sections.length === 0 ? (
                <span className="hint-text">这个卡片集还没有目录</span>
              ) : (
                sections.map((s) => (
                  <span key={s.id} className={'opt' + (picked.includes(s.id) ? ' on' : '')} onClick={() => toggle(s.id)}>
                    {'　'.repeat(s.level - 1)}
                    {s.title}
                  </span>
                ))
              )}
            </div>
          )}
        </div>
        <textarea ref={box} className="text-input export-out" rows={12} readOnly value={text} />
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={onClose}>
          关闭
        </button>
        {format === 'html' && (
          <button className="btn" onClick={print}>
            打印 / 存为 PDF
          </button>
        )}
        <button className="btn" disabled={!text} onClick={copy}>
          复制
        </button>
        <button className="btn primary" disabled={!canDownload} onClick={download}>
          下载
        </button>
      </div>
    </Modal>
  );
}
