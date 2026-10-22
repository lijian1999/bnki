// 导入对话框：文本 / 表格（TSV、CSV）与 Markdown 文件、Anki 牌组三种入口，照原型 importDialog。
import { useRef, useState } from 'react';
import type { JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { parseImportText } from '@bnki/shared/importText';
import { api } from '../api';
import { invalidateDeck } from '../queries';
import { Modal, DialogHead } from '../ui/Modal';
import { toast } from '../ui/toast';
import { xlsxToRows, rowsToTsv } from '../import/xlsx';
import '../styles/pages.css';

export interface DeckDialogProps {
  deckId: string;
  onClose: () => void;
}

const PLACEHOLDER = 'TCP 第二次握手发送什么？\tSYN+ACK\n进程是 {{资源分配}} 的基本单位';
type Tab = 'text' | 'md' | 'apkg';
type Split = 'item' | 'paragraph' | 'hr';

function errText(e: unknown): string {
  return typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' && e.message ? e.message : '导入失败';
}

export default function ImportDialog(props: DeckDialogProps): JSX.Element {
  const { deckId, onClose } = props;
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('text');
  const [text, setText] = useState('');
  const [mdText, setMdText] = useState('');
  const [format, setFormat] = useState<'tsv' | 'csv'>('tsv');
  const [firstSec, setFirstSec] = useState(false);
  const [split, setSplit] = useState<Split>('item');
  const [apkgFile, setApkgFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const csvInput = useRef<HTMLInputElement>(null);
  const mdInput = useRef<HTMLInputElement>(null);
  const apkgInput = useRef<HTMLInputElement>(null);

  const rows = parseImportText(text, format, firstSec);
  const preview = rows.slice(0, 5);

  const readFile = (el: HTMLInputElement, onText: (t: string, name: string) => void): void => {
    const f = el.files?.[0];
    if (!f) return;
    void f.text().then((t) => onText(t, f.name), () => toast('读取文件失败'));
    el.value = '';
  };

  const readXlsx = (el: HTMLInputElement): void => {
    const f = el.files?.[0];
    if (!f) return;
    const name = f.name;
    if (/\.xls$/i.test(name)) {
      toast('只支持 .xlsx，请在 Excel 里另存为 .xlsx');
    } else {
      void f.arrayBuffer().then((buf) => {
        try {
          const rows = xlsxToRows(new Uint8Array(buf));
          setText(rowsToTsv(rows));
          setFormat('tsv');
        } catch {
          toast('读取 Excel 失败');
        }
      }, () => toast('读取 Excel 失败'));
    }
    el.value = '';
  };

  const finish = (r: { cards: number; sections: number }): void => {
    toast(r.sections > 0 ? `已导入 ${r.cards} 张卡片、${r.sections} 个目录` : `已导入 ${r.cards} 张卡片`);
    invalidateDeck(qc, deckId);
    onClose();
  };

  const run = (req: Promise<{ cards: number; sections: number }>): void => {
    void req.then(finish, (e) => toast(`导入失败：${errText(e)}`));
  };

  return (
    <Modal light className="wide-dialog" onClose={onClose}>
      <DialogHead title="导入卡片" onClose={onClose} />
      <div className="dialog-body">
        <div className="seg seg-tabs">
          <button className={tab === 'text' ? 'on' : ''} onClick={() => setTab('text')}>
            文本 / 表格
          </button>
          <button className={tab === 'md' ? 'on' : ''} onClick={() => setTab('md')}>
            Markdown 文件
          </button>
          <button className={tab === 'apkg' ? 'on' : ''} onClick={() => setTab('apkg')}>
            Anki 牌组（.apkg）
          </button>
        </div>

        {tab === 'text' && (
          <>
            <div className="hint-text">
              每行一张卡片；用 Tab 分隔正面和背面（有背面 → 问答卡，没有 → 笔记卡）。可以直接从 Excel 复制粘贴。正文里的 <code>{'{{挖空}}'}</code> 和 Markdown
              会保留。
            </div>
            <textarea
              className="text-input imp-text"
              rows={8}
              placeholder={PLACEHOLDER}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setFormat('tsv'); // 手工输入 / 粘贴按分隔符文本处理
              }}
            />
            <div className="file-row">
              <button className="btn sm" onClick={() => csvInput.current?.click()}>
                上传 Excel / CSV 文件
              </button>
              <input
                ref={csvInput}
                type="file"
                accept=".xlsx,.csv,.tsv,.txt,.xls"
                hidden
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f && /\.xlsx?$/i.test(f.name)) {
                    readXlsx(e.currentTarget);
                  } else {
                    readFile(e.currentTarget, (t, name) => {
                      setText(t);
                      setFormat(/\.csv$/i.test(name) ? 'csv' : 'tsv');
                    });
                  }
                }}
              />
            </div>
            <div className="form-row row-between">
              <span>第一列是目录（相同目录名的卡片会归到同一个目录下）</span>
              <Switch on={firstSec} onToggle={() => setFirstSec((v) => !v)} />
            </div>
            <div className="hint-text">
              识别到 <b>{rows.length}</b> 张卡片{rows.length ? '，预览前 5 张：' : ''}
            </div>
            {preview.map((r, i) => (
              <div className="imp-row" key={i}>
                {r.section && <span className="tag-p imp-sec">{r.section}</span>}
                {r.front}
                {r.back && <span style={{ color: 'var(--text-3)' }}> ⇥ {r.back}</span>}
              </div>
            ))}
          </>
        )}

        {tab === 'md' && (
          <>
            <div className="hint-text">一级到五级标题（#～#####）会变成目录，标题之间的内容按下面的规则切成卡片（都是笔记卡）。</div>
            <div className="file-row">
              <button className="btn sm" onClick={() => mdInput.current?.click()}>
                选择 .md 文件
              </button>
              <input
                ref={mdInput}
                type="file"
                accept=".md,.markdown,.txt"
                hidden
                onChange={(e) => readFile(e.currentTarget, (t) => setMdText(t))}
              />
            </div>
            <textarea
              className="text-input imp-text"
              rows={8}
              placeholder="选择文件或直接粘贴 Markdown 内容"
              value={mdText}
              onChange={(e) => setMdText(e.target.value)}
            />
            <div className="seg seg-tabs">
              {(
                [
                  ['item', '每个列表项一张'],
                  ['paragraph', '每段一张'],
                  ['hr', '用 --- 分隔'],
                ] as [Split, string][]
              ).map(([v, label]) => (
                <button key={v} className={split === v ? 'on' : ''} onClick={() => setSplit(v)}>
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'apkg' && (
          <>
            <div className="hint-text">
              问答模板 → 问答卡，填空模板 → 笔记卡（{'{{c1::x}}'} 变成 {'{{x}}'}），子牌组 → 目录，图片一起导入。学习进度不导入。
            </div>
            <div className="file-row">
              <button className="btn sm" onClick={() => apkgInput.current?.click()}>
                选择 .apkg 文件
              </button>
              <input
                ref={apkgInput}
                type="file"
                accept=".apkg"
                hidden
                onChange={(e) => {
                  setApkgFile(e.currentTarget.files?.[0] ?? null);
                  e.currentTarget.value = '';
                }}
              />
              {apkgFile && (
                <span className="apkg-file-info">
                  {apkgFile.name}（{(apkgFile.size / 1024 >= 1024 ? apkgFile.size / (1024 * 1024) : apkgFile.size / 1024).toFixed(1)}{' '}
                  {apkgFile.size / 1024 >= 1024 ? 'MB' : 'KB'}）
                </span>
              )}
            </div>
          </>
        )}
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={onClose}>
          取消
        </button>
        {tab === 'apkg' ? (
          <button
            className="btn primary"
            disabled={!apkgFile || importing}
            onClick={() => {
              if (!apkgFile) return;
              setImporting(true);
              void api.io
                .importApkg(deckId, apkgFile)
                .then(finish, (e) => toast(`导入失败：${errText(e)}`))
                .finally(() => setImporting(false));
            }}
          >
            {importing ? '导入中…' : '导入'}
          </button>
        ) : tab === 'text' ? (
          <button className="btn primary" disabled={!rows.length} onClick={() => run(api.io.importText({ deckId, text, format, firstColumnIsSection: firstSec }))}>
            导入到末尾
          </button>
        ) : (
          <button className="btn primary" disabled={!mdText.trim()} onClick={() => run(api.io.importMarkdown({ deckId, text: mdText, split }))}>
            导入到末尾
          </button>
        )}
      </div>
    </Modal>
  );
}

function Switch(props: { on: boolean; onToggle: () => void }): JSX.Element {
  return <button className={'switch' + (props.on ? ' on' : '')} onClick={props.onToggle} />;
}
