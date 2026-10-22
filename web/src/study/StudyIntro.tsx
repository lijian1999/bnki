// 首次学习说明：第一次打开学习时弹一次，记在本机 localStorage。
import { useState, type JSX } from 'react';
import { Modal, DialogHead } from '../ui/Modal';

const KEY = 'bnki.studyIntroSeen';

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // 存不了就下次再弹
  }
}

export default function StudyIntro(): JSX.Element | null {
  const [open, setOpen] = useState(() => !seen());
  if (!open) return null;
  const close = (): void => {
    markSeen();
    setOpen(false);
  };
  return (
    <Modal light onClose={close} onKeyDown={(e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        close();
      }
    }}>
      <DialogHead title="学习说明" onClose={close} />
      <div className="dialog-body study-intro">
        <p>每张卡片看完后按记忆情况评分，系统用 FSRS 记忆算法算出下次复习的时间：</p>
        <ul>
          <li><b style={{ color: 'var(--red)' }}>忘记了</b>（1）：本轮稍后再练一次，明天再复习。</li>
          <li><b style={{ color: 'var(--orange)' }}>模糊</b>（2）：间隔变短一些。</li>
          <li><b style={{ color: 'var(--green)' }}>记住了</b>（3）：间隔逐次拉长。</li>
        </ul>
        <p>评分按钮下方显示的就是这次评分后的下次间隔。</p>
        <ul>
          <li>笔记卡：点蓝色空白揭示挖空，V 揭示下一个，⇧V 全部显示。</li>
          <li>问答卡：空格显示答案，H 显示提示。</li>
          <li>← → 切换卡片，E 编辑，R 朗读，Esc 关闭。</li>
        </ul>
      </div>
      <div className="dialog-foot">
        <button className="btn primary" onClick={close}>开始学习</button>
      </div>
    </Modal>
  );
}
