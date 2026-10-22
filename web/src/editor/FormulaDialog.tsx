// 插入公式：输入 LaTeX，下面实时出 KaTeX 预览。
import { useMemo, useState } from 'react';
import katex from 'katex';
import { Modal, DialogHead } from '../ui/Modal';
import type { JSX } from 'react';

export default function FormulaDialog(props: { onDone(tex: string | null): void }): JSX.Element {
  const [tex, setTex] = useState('');
  const done = props.onDone;
  const html = useMemo(
    () => (tex.trim() ? katex.renderToString(tex.trim(), { throwOnError: false }) : ''),
    [tex],
  );
  const ok = (): void => {
    const v = tex.trim();
    done(v ? v : null);
  };
  const cancel = (): void => done(null);
  return (
    <Modal light onClose={cancel}>
      <DialogHead title="插入公式（LaTeX）" onClose={cancel} />
      <div className="dialog-body">
        <input
          className="text-input"
          style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}
          placeholder="例：x^2+y^2=z^2"
          value={tex}
          autoFocus
          onChange={(e) => setTex(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.stopPropagation();
              ok();
            }
          }}
        />
        <div style={{ minHeight: 44, padding: '12px 4px', textAlign: 'center' }} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={cancel}>取消</button>
        <button className="btn primary" onClick={ok}>确定</button>
      </div>
    </Modal>
  );
}
