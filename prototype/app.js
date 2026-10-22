/* bnki 原型：界面逻辑（纯前端，数据存 localStorage）。
 * 只用于确认交互和视觉；正式实现见 docs/design.md。
 */
(function () {
  'use strict';
  const STORE_KEY = 'bnki-proto-v3';
  const DAY = FSRS.DAY;

  // ---------------------------------------------------------------- 数据
  let S = load();
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const v = JSON.parse(raw);
        if (v.version === SEED.version) return v;
      }
    } catch (e) { /* 隐私模式等情况下忽略 */ }
    return fresh();
  }
  function fresh() {
    const s = JSON.parse(JSON.stringify(SEED));
    s.decks.forEach((d) => { d.study = d.study || {}; d.display = d.display || {}; });
    s.ui = { lastType: 'qa', lastColor: 'default', sort: 'updatedAt' };
    return s;
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* 忽略 */ }
    }, 150);
  }

  // ---------------------------------------------------------------- 界面状态
  const U = {
    route: { name: 'home' },
    homeQ: '',
    deckQ: '',
    deckSearchOpen: false,
    folderEdit: false,
    sel: new Set(),
    anchor: null,
    renaming: null,
    menu: null,
    modals: [],
    drag: null,
    ed: null,
    study: null,
  };

  // ---------------------------------------------------------------- 工具
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const uid = () => Math.random().toString(36).slice(2, 10);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtDate = (t) => { if (!t) return '—'; const d = new Date(t); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };
  const fmtMD = (t) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const isMac = /Mac/.test(navigator.platform);
  const mod = (e) => (isMac ? e.metaKey : e.ctrlKey);

  const COLORS = [
    ['default', '白色', '#ffffff'], ['light-yellow', '浅黄', '#fff3c4'], ['light-blue', '浅蓝', '#dbe9ff'],
    ['light-green', '浅绿', '#d8f3e2'], ['light-red', '浅红', '#fbdcdc'],
    ['grey', '灰色', '#c9cdd3'], ['yellow', '黄色', '#f7d774'], ['blue', '蓝色', '#a9c8f5'],
    ['green', '绿色', '#a8dcbb'], ['red', '红色', '#eba48d'],
  ];
  const colorHex = (c) => (COLORS.find((x) => x[0] === c) || COLORS[0])[2];
  const TYPE_NAMES = { note: '笔记卡片', qa: '问答卡片', topic: '主题卡片' };
  const CONTENT_NAMES = { recommend: '系统推荐', new: '仅未学习', review: '仅复习', all: '全部卡片' };

  const deckById = (id) => S.decks.find((d) => d.id === id);
  const liveDecks = () => S.decks.filter((d) => !d.deletedAt);
  const cardsOf = (d) => d.items.filter((i) => i.kind === 'card');
  const itemById = (d, id) => d.items.find((i) => i.id === id);

  function planOf(d) {
    const p = (d.study && d.study.plan) || {};
    return {
      mode: p.mode || S.settings.defaultMode,
      examDate: p.examDate || null,
      newPerDay: p.newPerDay ?? S.settings.newPerDay,
      reviewPerDay: p.reviewPerDay ?? S.settings.reviewPerDay,
    };
  }
  function fsrsCfg(d) {
    const p = planOf(d);
    return { mode: p.mode, examDate: p.examDate, retention: S.settings.retention, maxIvl: S.settings.maxIvl, dayHour: S.settings.dayHour, steps: S.settings.steps };
  }
  const todayStart = () => FSRS.dayStart(Date.now(), S.settings.dayHour);
  function dueCutoff(d) { return planOf(d).mode === 'flexible' ? Date.now() : todayStart() + DAY; }
  const stOf = (id) => S.states[id];
  const isNew = (id) => { const s = stOf(id); return !s || (!s.state && !s.mastered); };
  const isDue = (id, d) => { const s = stOf(id); return !!s && !s.mastered && s.state > 0 && s.due <= dueCutoff(d); };
  function counts(d) {
    const cs = cardsOf(d);
    const total = cs.length;
    const fresh = cs.filter((c) => isNew(c.id)).length;
    const due = cs.filter((c) => isDue(c.id, d)).length;
    const learned = total - fresh;
    return { total, fresh, due, learned, pct: total ? Math.round((learned / total) * 100) : 0 };
  }
  function nextDue(d) {
    let m = Infinity;
    cardsOf(d).forEach((c) => { const s = stOf(c.id); if (s && !s.mastered && s.state > 0) m = Math.min(m, s.due); });
    return m;
  }
  // 卡片 → 所在的各级目录
  function sectionPaths(d) {
    const stack = [], map = {};
    d.items.forEach((it) => {
      if (it.kind === 'section') {
        while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
        stack.push(it);
      } else map[it.id] = stack.map((s) => s.id);
    });
    return map;
  }
  // 目录块：目录本身 + 直到下一个同级或更高级目录之前的内容
  function sectionBlock(d, id) {
    const i = d.items.findIndex((x) => x.id === id);
    const sec = d.items[i];
    let j = i + 1;
    while (j < d.items.length && !(d.items[j].kind === 'section' && d.items[j].level <= sec.level)) j++;
    return [i, j];
  }
  function touch(d) { d.updatedAt = Date.now(); }
  function logEdit(cardId, action) { S.edits.push({ at: Date.now(), cardId, action }); }

  // ---------------------------------------------------------------- 提示、菜单、弹窗
  let toastTimer;
  function toast(msg, action) {
    $$('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span>${esc(msg)}</span>`;
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.onclick = () => { t.remove(); action.run(); };
      t.appendChild(b);
    }
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), action ? 5000 : 2200);
  }

  function closeMenu() { if (U.menu) { U.menu.remove(); U.menu = null; } }
  function openMenu(anchor, items, opt = {}) {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'menu';
    items.forEach((it) => {
      if (!it) return;
      if (it === '-') { m.insertAdjacentHTML('beforeend', '<div class="ms"></div>'); return; }
      if (it.header) { m.insertAdjacentHTML('beforeend', `<div class="mh">${esc(it.header)}</div>`); return; }
      if (it.el) { m.appendChild(it.el()); return; }
      const row = document.createElement('div');
      row.className = 'mi' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : '') + (it.disabled ? ' disabled' : '');
      row.innerHTML = `${it.icon ? `<span style="width:16px;text-align:center">${it.icon}</span>` : ''}<span>${esc(it.label)}</span>` +
        (it.tag ? ` <span class="tag-p">${it.tag}</span>` : '') +
        (it.kbd ? `<span class="kbd">${esc(it.kbd)}</span>` : '') + (it.sub ? '<span class="kbd">›</span>' : '');
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (it.disabled) return;
        if (it.sub) { openMenu(anchor, it.sub(), opt); return; }
        closeMenu();
        it.onClick && it.onClick();
      });
      m.appendChild(row);
    });
    m.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let x = opt.alignRight ? r.right - mw : r.left;
    let y = r.bottom + 6;
    if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 6);
    x = Math.max(8, Math.min(x, innerWidth - mw - 8));
    m.style.left = x + 'px';
    m.style.top = y + 'px';
    U.menu = m;
  }
  document.addEventListener('mousedown', (e) => { if (U.menu && !U.menu.contains(e.target)) closeMenu(); }, true);

  function swatchesEl(current, onPick) {
    return () => {
      const box = document.createElement('div');
      box.className = 'swatches';
      COLORS.forEach(([k, name, hex]) => {
        const s = document.createElement('span');
        s.className = 'swatch' + (k === current ? ' on' : '');
        s.title = name;
        s.style.background = hex;
        s.addEventListener('mousedown', (e) => e.preventDefault());
        s.addEventListener('click', () => { closeMenu(); onPick(k); });
        box.appendChild(s);
      });
      return box;
    };
  }

  function openModal(inner, opt = {}) {
    closeMenu();
    const mask = document.createElement('div');
    mask.className = 'mask' + (opt.light ? ' light' : '');
    mask.innerHTML = opt.raw ? inner : `<div class="dialog ${opt.cls || ''}">${inner}</div>`;
    document.body.appendChild(mask);
    const m = { mask, el: mask.firstElementChild, onKey: opt.onKey, onClose: opt.onClose, onMask: opt.onMask };
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask) { m.onMask ? m.onMask() : closeModal(m); }
    });
    U.modals.push(m);
    return m;
  }
  function closeModal(m) {
    m = m || U.modals[U.modals.length - 1];
    if (!m) return;
    m.mask.remove();
    U.modals = U.modals.filter((x) => x !== m);
    m.onClose && m.onClose();
  }
  function dialogHTML(title, body, foot) {
    return `<div class="dialog-head"><h3>${title}</h3><button class="icon-btn" data-act="modal-close">×</button></div>
      <div class="dialog-body">${body}</div>${foot ? `<div class="dialog-foot">${foot}</div>` : ''}`;
  }
  function confirmDialog(title, text, ok = '确定', danger = false) {
    return new Promise((res) => {
      const m = openModal(dialogHTML(title, `<p style="margin:4px 0;color:var(--text-2)">${text}</p>`,
        `<button class="btn" data-x="no">取消</button><button class="btn ${danger ? 'primary danger' : 'primary'}" data-x="ok">${ok}</button>`),
      { light: true, onClose: () => res(false) });
      m.el.addEventListener('click', (e) => {
        const x = e.target.closest('[data-x]');
        if (!x) return;
        m.onClose = null; closeModal(m); res(x.dataset.x === 'ok');
      });
    });
  }
  function promptDialog(title, value = '', ph = '', extra = '') {
    return new Promise((res) => {
      const m = openModal(dialogHTML(title, `<input class="text-input" id="pd-in" value="${esc(value)}" placeholder="${esc(ph)}">${extra}`,
        '<button class="btn" data-x="no">取消</button><button class="btn primary" data-x="ok">确定</button>'),
      { light: true, onClose: () => res(null) });
      const inp = $('#pd-in', m.el);
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
      const done = (ok) => { m.onClose = null; closeModal(m); res(ok ? inp.value : null); };
      m.el.addEventListener('click', (e) => { const x = e.target.closest('[data-x]'); if (x) done(x.dataset.x === 'ok'); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); done(true); } });
      m.onKey = (e) => { if (e.key === 'Escape') done(false); };
    });
  }

  // ---------------------------------------------------------------- 路由与总渲染
  function route() {
    const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
    const name = parts[0] || 'home';
    if (U.route.name !== name || U.route.arg !== parts[1]) { U.sel.clear(); U.deckQ = ''; U.deckSearchOpen = false; U.renaming = null; }
    U.route = { name, arg: parts[1] };
    if (name === 'deck') { const d = deckById(parts[1]); if (d) { d.openedAt = Date.now(); save(); } }
    render();
  }
  window.addEventListener('hashchange', route);

  function applyTheme() {
    const t = S.settings.theme;
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  function render() {
    applyTheme();
    const main = $('#main');
    const keepScroll = main && U.route.name === 'deck' ? main.scrollTop : 0;
    $('#app').innerHTML = `<aside class="sidebar">${sidebarHTML()}</aside><main class="main" id="main">${mainHTML()}</main>`;
    $('#main').scrollTop = keepScroll;
    afterRender();
  }
  function mainHTML() {
    const r = U.route.name;
    if (r === 'deck') { const d = deckById(U.route.arg); return d ? deckPageHTML(d) : '<div class="empty">卡片集不存在</div>'; }
    if (r === 'stats') return statsHTML();
    if (r === 'settings') return settingsHTML();
    return homeHTML();
  }
  function afterRender() {
    if (U.route.name === 'deck') placeFloatToolbar();
    if (U.route.name === 'stats') bindStats();
    const ti = $('#deck-title');
    if (ti && U.focusTitle) { ti.focus(); ti.select(); U.focusTitle = false; }
    const ri = $('#rename-input');
    if (ri) { ri.focus(); ri.select(); }
    const ds = $('#deck-search');
    if (ds && U.focusSearch) { ds.focus(); ds.setSelectionRange(ds.value.length, ds.value.length); U.focusSearch = false; }
    if (U.deckQ) highlightHits();
  }

  // ---------------------------------------------------------------- 侧边栏
  function sidebarHTML() {
    const r = U.route;
    const nav = (href, ico, label, active, extra = '') => `<div class="nav-item ${active ? 'active' : ''}" data-act="go" data-href="${href}"><span class="ico">${ico}</span><span class="grow">${label}</span>${extra}</div>`;
    const folders = S.folders.map((f) => `<div class="nav-item nav-folder ${r.name === 'folder' && r.arg === f.id ? 'active' : ''}" data-act="go" data-href="#/folder/${f.id}">
        <span class="grow">📁 ${esc(f.name)}</span>
        ${U.folderEdit ? `<span class="folder-edit-btns"><button data-act="folder-rename" data-id="${f.id}" title="重命名">✎</button><button data-act="folder-del" data-id="${f.id}" title="删除">🗑</button></span>` : ''}
      </div>`).join('');
    return `
      <div class="brand"><div class="brand-logo">b</div>bnki <span class="tag-p">本地</span></div>
      <button class="btn-new-deck" data-act="new-deck">＋ 新建卡片集</button>
      ${nav('#/', '⌂', '全部卡片集', r.name === 'home', `<span class="nav-actions"><button class="mini-btn" data-act="folder-new" title="新建分类">＋</button><button class="mini-btn ${U.folderEdit ? 'on' : ''}" data-act="folder-edit" title="编辑分类">✎</button></span>`)}
      ${folders}
      <div class="nav-sep"></div>
      ${nav('#/recent', '◷', '最近使用', r.name === 'recent')}
      ${nav('#/trash', '🗑', '回收站', r.name === 'trash')}
      <div class="nav-sep"></div>
      ${nav('#/stats', '▤', '我的统计', r.name === 'stats')}
      ${nav('#/settings', '⚙', '系统设置', r.name === 'settings')}
      <div style="flex:1"></div>
      <div class="hint-text" style="padding:6px 10px">学习小组、社区、收藏、下载 App、帮助中心已砍掉</div>`;
  }

  // ---------------------------------------------------------------- 首页
  const SORTS = [
    ['name', '按名称'], ['updatedAt', '按编辑时间'], ['createdAt', '按创建时间'], ['studiedAt', '按学习时间'],
    ['nextDue', '按下次复习时间'], ['cardCount', '按卡片数量'], ['newCount', '按待学习卡片数量'],
  ];
  function homeHTML() {
    const r = U.route.name;
    let list, title;
    if (r === 'trash') { list = S.decks.filter((d) => d.deletedAt); title = '回收站'; }
    else if (r === 'recent') { list = liveDecks().filter((d) => d.openedAt && !d.hideRecent).sort((a, b) => b.openedAt - a.openedAt); title = '最近使用'; }
    else if (r === 'folder') { list = liveDecks().filter((d) => d.folderId === U.route.arg); const f = S.folders.find((x) => x.id === U.route.arg); title = f ? f.name : '分类'; }
    else { list = liveDecks(); title = '全部卡片集'; }
    if (r !== 'recent') list = sortDecks(list);
    const q = U.homeQ.trim().toLowerCase();
    if (q) list = list.filter((d) => d.title.toLowerCase().includes(q));
    const sortName = (SORTS.find((s) => s[0] === S.ui.sort) || SORTS[1])[1];
    const grid = list.length ? `<div class="deck-grid">${list.map(deckCardHTML).join('')}</div>`
      : `<div class="empty">${r === 'trash' ? '回收站是空的' : q ? '没有匹配的卡片集' : '还没有卡片集，点左上角“新建卡片集”'}</div>`;
    return `<div class="page">
      <div class="page-head">
        <h1 class="page-title">${esc(title)}</h1>
        ${r !== 'recent' ? `<span class="chip" data-act="sort-menu">⇅ ${sortName}</span>` : ''}
        <div class="search"><span style="color:var(--text-3)">⌕</span><input id="home-search" placeholder="搜索卡片集" value="${esc(U.homeQ)}"></div>
      </div>
      ${r === 'trash' && list.length ? '<p class="hint-text" style="margin:-8px 0 14px">删除的卡片集会保留在这里，可以恢复或彻底删除</p>' : ''}
      ${grid}
    </div>`;
  }
  function sortDecks(list) {
    const k = S.ui.sort;
    const by = {
      name: (a, b) => a.title.localeCompare(b.title, 'zh'),
      updatedAt: (a, b) => b.updatedAt - a.updatedAt,
      createdAt: (a, b) => b.createdAt - a.createdAt,
      studiedAt: (a, b) => (b.studiedAt || 0) - (a.studiedAt || 0),
      nextDue: (a, b) => nextDue(a) - nextDue(b),
      cardCount: (a, b) => cardsOf(b).length - cardsOf(a).length,
      newCount: (a, b) => counts(b).fresh - counts(a).fresh,
    }[k] || ((a, b) => b.updatedAt - a.updatedAt);
    return [...list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || by(a, b));
  }
  function deckCardHTML(d) {
    const c = counts(d);
    const f = S.folders.find((x) => x.id === d.folderId);
    return `<div class="deck-card" data-act="open-deck" data-id="${d.id}">
      ${d.cover ? `<div class="cover" style="background-image:url('${esc(d.cover)}')"></div>` : ''}
      ${d.pinned ? '<span class="pin" title="已置顶">📌</span>' : ''}
      <button class="more" data-act="deck-card-menu" data-id="${d.id}">···</button>
      <div class="title">${esc(d.title)}</div>
      <div class="meta">卡片 ${c.total}</div>
      <div class="foot">
        <span>◷ 未学习 ${c.fresh}</span>
        ${c.due ? `<span class="due">需复习 ${c.due}</span>` : ''}
        ${f ? `<span class="folder-tag">${esc(f.name)}</span>` : ''}
      </div>
    </div>`;
  }
  function newDeck() {
    const d = {
      id: 'd' + uid(), title: '无标题卡片集', description: '', folderId: U.route.name === 'folder' ? U.route.arg : null,
      createdAt: Date.now(), updatedAt: Date.now(), openedAt: Date.now(), studiedAt: null, items: [], study: {}, display: {},
    };
    S.decks.push(d);
    save();
    U.focusTitle = true;
    location.hash = '#/deck/' + d.id;
  }
  function duplicateDeck(d) {
    const copy = JSON.parse(JSON.stringify(d));
    copy.id = 'd' + uid();
    copy.title = d.title + ' 副本';
    copy.createdAt = copy.updatedAt = Date.now();
    copy.pinned = false;
    copy.items.forEach((it) => { it.id = (it.kind === 'card' ? 'c' : 's') + uid(); });
    S.decks.push(copy);
    save(); render();
    toast('已创建副本（学习进度不复制）');
  }

  // ---------------------------------------------------------------- 卡片集页
  function dispOf(d) {
    return Object.assign({ layout: 'auto', answer: true, progress: true, mindmap: true, toc: true }, d.display || {});
  }
  function deckPageHTML(d) {
    const c = counts(d);
    const disp = dispOf(d);
    const secs = d.items.filter((i) => i.kind === 'section');
    const toc = disp.toc ? `<nav class="toc">
        <div class="toc-head"><span>☰</span><b>目录</b>
          <button class="icon-btn" style="width:24px;height:24px;font-size:13px" data-act="toc-add" title="新建一级目录">＋</button>
          <button class="icon-btn" style="width:24px;height:24px;font-size:13px" data-act="toc-fold" title="全部折叠 / 展开">⇕</button>
        </div>
        ${secs.length ? secs.map((s) => `<div class="toc-item ${s.level === 1 ? 'l1' : ''}" style="padding-left:${6 + (s.level - 1) * 14}px" data-act="toc-jump" data-id="${s.id}">${esc(s.title)}</div>`).join('') : '<div class="hint-text" style="padding:4px 6px">还没有目录</div>'}
      </nav>` : '';
    return `
      <div class="deck-top">
        <button class="icon-btn" data-act="go" data-href="#/" title="返回">‹</button>
        <div style="flex:1"></div>
        ${U.deckSearchOpen || U.deckQ ? `<div class="search" style="width:240px;margin:0"><span style="color:var(--text-3)">⌕</span><input id="deck-search" placeholder="搜索卡片内容" value="${esc(U.deckQ)}"><button class="icon-btn" style="width:22px;height:22px" data-act="deck-search-close">×</button></div>`
          : '<button class="icon-btn" data-act="deck-search" title="搜索">⌕</button>'}
        <button class="icon-btn" data-act="speak-deck" title="朗读（P1）">🔈</button>
        <button class="icon-btn" data-act="deck-menu" title="更多">⋯</button>
      </div>
      <div class="deck-layout">
        ${toc}
        <div class="deck-body" id="deck-body">
          ${d.cover ? `<div style="height:150px;border-radius:14px;margin-bottom:14px;background:url('${esc(d.cover)}') center/cover"></div>` : ''}
          <input class="deck-title" id="deck-title" value="${esc(d.title)}" maxlength="200">
          <div class="deck-dates">创建 ${fmtDate(d.createdAt)} · 更新 ${fmtDate(d.updatedAt)}</div>
          ${d.description ? `<div class="deck-desc">${esc(d.description)}</div>` : ''}
          ${disp.progress && c.total ? progressHTML(d, c, disp) : ''}
          ${itemsHTML(d, disp)}
        </div>
      </div>
      <div class="fab-group">
        <button class="btn" data-act="new-section">☰ 新建目录</button>
        <button class="btn primary" data-act="new-card">＋ 新建卡片</button>
      </div>`;
  }
  function progressHTML(d, c, disp) {
    return `<div class="progress-panel">
      <div class="pp-row">
        <span class="pp-pct">${c.pct}%</span><span class="pp-learned">已学 ${c.learned}/${c.total}</span>
        <div class="pp-stats">
          <span data-act="study" data-content="new"><i class="dot" style="background:var(--accent)"></i>未学 ${c.fresh} 学习 ›</span>
          <span data-act="study" data-content="review"><i class="dot" style="background:var(--orange)"></i>待复习 <b style="color:var(--orange)">${c.due}</b> 复习 ›</span>
        </div>
      </div>
      <div class="pp-bar"><i style="width:${c.pct}%"></i></div>
      <div class="pp-btns">
        <span class="btn-split"><button class="btn primary" data-act="study" data-content="">继续学习 · ${CONTENT_NAMES[(d.study && d.study.content) || 'recommend']}</button><button class="btn primary" data-act="study-settings" title="学习设置">⚙</button></span>
        <button class="btn" data-act="quiz">✓ 测验 <span class="soon">P2</span></button>
        ${disp.mindmap ? '<button class="btn" data-act="mindmap">⌘ 导图</button>' : ''}
        <span style="margin-left:auto" class="hint-text">${planLabel(d)}</span>
      </div>
    </div>`;
  }
  function planLabel(d) {
    const p = planOf(d);
    const m = { daily: '按天模式', flexible: '灵活模式', sprint: '冲刺模式' }[p.mode];
    return `${m} · 每日新学 ${p.newPerDay} / 复习 ${p.reviewPerDay}${p.mode === 'sprint' && p.examDate ? ' · 考试 ' + p.examDate : ''}`;
  }
  function itemsHTML(d, disp) {
    if (!d.items.length) {
      return `<div class="empty-deck"><h3>开始搭建你的卡片集</h3><p>可以先用目录把内容分好章节，也可以直接写卡片</p>
        <button class="btn" data-act="new-section">先新建目录</button> <button class="btn primary" data-act="new-card">新建第一张卡片</button>
        <p class="hint-text" style="margin-top:14px">也可以 <a href="#" data-act="import">导入文本</a></p></div>`;
    }
    const q = U.deckQ.trim().toLowerCase();
    const cols = disp.layout === 'auto' ? '' : 'cols-' + disp.layout;
    let html = '', grid = [], hideLevel = null, shown = 0;
    const flush = () => { if (grid.length) { html += `<div class="card-grid ${cols}">${grid.join('')}</div>`; grid = []; } };
    d.items.forEach((it, idx) => {
      if (it.kind === 'section') {
        if (!q && hideLevel !== null && it.level > hideLevel) return;
        hideLevel = null;
        flush();
        let n = 0;
        for (let j = idx + 1; j < d.items.length; j++) { const x = d.items[j]; if (x.kind === 'section' && x.level <= it.level) break; if (x.kind === 'card') n++; }
        html += sectionHTML(it, n);
        if (it.collapsed && !q) hideLevel = it.level;
      } else {
        if (hideLevel !== null) return;
        if (q && !MD.plain([it.front, it.hint, it.back].join(' ')).toLowerCase().includes(q)) return;
        shown++;
        grid.push(cardHTML(it, d, disp));
      }
    });
    flush();
    if (q && !shown) html += '<div class="empty">没有匹配的卡片</div>';
    return html;
  }
  function sectionHTML(s, n) {
    const sel = U.sel.has(s.id);
    const title = U.renaming === s.id ? `<input id="rename-input" data-id="${s.id}" value="${esc(s.title)}">` : `<span class="t">${esc(s.title)}</span>`;
    return `<div class="section-h l${s.level} ${s.collapsed ? 'collapsed' : ''} ${sel ? 'sel' : ''}" data-item="${s.id}" draggable="true">
      <span class="caret" data-act="sec-toggle" data-id="${s.id}">▼</span>${title}<span class="count">${n}</span></div>`;
  }
  function cardHTML(it, d, disp) {
    let inner;
    if (it.type === 'qa') {
      inner = `<div class="q">${MD.render(it.front)}</div>` +
        (it.hint ? `<div class="hint-prev">${MD.render(it.hint)}</div>` : '') +
        (disp.answer && it.back ? `<div class="a">${MD.render(it.back)}</div>` : '');
    } else if (it.type === 'topic') {
      inner = `<div class="topic-t">${esc(it.front)}</div><div style="color:var(--text-2);margin-top:6px">${esc(it.back || '')}</div>`;
    } else inner = MD.render(it.front);
    const s = stOf(it.id);
    let badge = '';
    if (s && s.mastered) badge = '<span class="state-dot">已掌握</span>';
    else if (isDue(it.id, d)) badge = '<span class="state-dot due">需复习</span>';
    return `<div class="mini-card col-${it.color || 'default'} ${U.sel.has(it.id) ? 'sel' : ''}" data-item="${it.id}" draggable="true">
      <div class="md">${inner}</div>${badge}</div>`;
  }
  function highlightHits() {
    const q = U.deckQ.trim();
    if (!q) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    $$('.mini-card .md').forEach((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((n) => {
        if (!re.test(n.data)) return;
        re.lastIndex = 0;
        const span = document.createElement('span');
        span.innerHTML = esc(n.data).replace(re, (m) => `<mark class="hit">${m}</mark>`);
        n.replaceWith(...span.childNodes);
      });
    });
  }

  // 选中卡片 / 目录后的浮动工具栏
  function placeFloatToolbar() {
    const main = $('#main');
    $$('.float-toolbar').forEach((x) => x.remove());
    if (!U.sel.size) return;
    const d = deckById(U.route.arg);
    const ids = [...U.sel];
    const el = $(`[data-item="${ids[0]}"]`);
    if (!el) return;
    const it = itemById(d, ids[0]);
    const bar = document.createElement('div');
    bar.className = 'float-toolbar';
    if (ids.length > 1) {
      bar.innerHTML = `<span style="padding:0 8px;font-size:12px">已选 ${ids.length} 项</span><span class="sep"></span>
        <button data-act="tb-color" title="颜色"><span class="swatch" style="background:#fff"></span></button>
        <button data-act="tb-move" title="移动到目录">⇥</button>
        <button data-act="tb-delete" title="删除">🗑</button>`;
    } else if (it.kind === 'card') {
      bar.innerHTML = `<button data-act="tb-open" title="展开（Enter）">⤢</button>
        <button data-act="tb-edit" title="编辑（E）">✎</button>
        <button data-act="tb-color" title="卡片颜色"><span class="swatch" style="background:${colorHex(it.color)}"></span></button>
        <button data-act="tb-delete" title="删除（⌫）">🗑</button><span class="sep"></span>
        <button data-act="tb-more" title="更多">⋯</button>`;
    } else {
      bar.innerHTML = `<button data-act="tb-rename" title="编辑标题">✎</button>
        <button data-act="tb-level" title="目录级别">H${it.level} ${['一', '二', '三', '四', '五'][it.level - 1]}级目录 ▾</button>
        <button data-act="tb-delete" title="删除目录">🗑</button><span class="sep"></span>
        <button data-act="tb-more" title="更多">⋯</button>`;
    }
    main.appendChild(bar);
    const r = el.getBoundingClientRect(), mr = main.getBoundingClientRect();
    bar.style.top = (r.top - mr.top + main.scrollTop) + 'px';
    bar.style.left = Math.max(8, r.left - mr.left + r.width / 2 - bar.offsetWidth / 2) + 'px';
  }

  function visibleItemIds() { return $$('[data-item]').map((e) => e.dataset.item); }
  function selectItem(id, e) {
    if (e && mod(e)) { U.sel.has(id) ? U.sel.delete(id) : U.sel.add(id); U.anchor = id; }
    else if (e && e.shiftKey && U.anchor) {
      const ids = visibleItemIds();
      const a = ids.indexOf(U.anchor), b = ids.indexOf(id);
      U.sel = new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else { U.sel = new Set([id]); U.anchor = id; }
    refreshSelection();
  }
  // 只改选中样式和浮动工具栏，不重绘整页：重绘会换掉被点的元素，双击就收不到了
  function refreshSelection() {
    $$('[data-item]').forEach((el) => el.classList.toggle('sel', U.sel.has(el.dataset.item)));
    placeFloatToolbar();
  }
  function insertAfter(d, newItems, afterId) {
    let idx = afterId ? d.items.findIndex((x) => x.id === afterId) : d.items.length - 1;
    if (afterId) {
      const after = itemById(d, afterId);
      if (after && after.kind === 'section' && after.collapsed) idx = sectionBlock(d, afterId)[1] - 1;
    }
    d.items.splice(idx + 1, 0, ...newItems);
    touch(d);
  }
  function newSection(d, afterId) {
    const after = afterId ? itemById(d, afterId) : null;
    const s = { id: 's' + uid(), kind: 'section', level: after && after.kind === 'section' ? after.level : 1, title: '新目录' };
    insertAfter(d, [s], afterId);
    U.sel = new Set([s.id]);
    U.renaming = s.id;
    save(); render();
  }
  function deleteItems(d, ids) {
    const removed = [];
    ids.forEach((id) => {
      const i = d.items.findIndex((x) => x.id === id);
      if (i >= 0) { removed.push({ item: d.items[i], index: i }); d.items.splice(i, 1); if (d.items.length >= 0 && removed[removed.length - 1].item.kind === 'card') logEdit(id, 'delete'); }
    });
    U.sel.clear(); touch(d); save(); render();
    const nCards = removed.filter((r) => r.item.kind === 'card').length;
    const nSecs = removed.length - nCards;
    toast(`已删除${nCards ? ` ${nCards} 张卡片` : ''}${nSecs ? ` ${nSecs} 个目录（目录下的卡片保留）` : ''}`, {
      label: '撤销',
      run: () => { removed.sort((a, b) => a.index - b.index).forEach((r) => d.items.splice(r.index, 0, r.item)); save(); render(); },
    });
  }
  function moveItem(d, dragId, targetId, after, onlyHeading) {
    const it = itemById(d, dragId);
    let [i, j] = it.kind === 'section' && !onlyHeading ? sectionBlock(d, dragId) : [d.items.findIndex((x) => x.id === dragId), 0];
    if (!(it.kind === 'section' && !onlyHeading)) j = i + 1;
    const block = d.items.slice(i, j);
    if (block.some((x) => x.id === targetId)) return;
    d.items.splice(i, j - i);
    let t = d.items.findIndex((x) => x.id === targetId);
    if (after) {
      const tgt = d.items[t];
      t = tgt.kind === 'section' && tgt.collapsed ? sectionBlock(d, targetId)[1] : t + 1;
    }
    d.items.splice(t, 0, ...block);
    touch(d); save(); render();
  }
  function moveToSection(d, ids, secId) {
    const moving = ids.map((id) => itemById(d, id)).filter((x) => x && x.kind === 'card');
    d.items = d.items.filter((x) => !moving.includes(x));
    const end = sectionBlock(d, secId)[1];
    d.items.splice(end, 0, ...moving);
    touch(d); save(); render();
    toast(`已移动 ${moving.length} 张卡片`);
  }
  function moveToDeck(d, ids, target) {
    const moving = ids.map((id) => itemById(d, id)).filter((x) => x && x.kind === 'card');
    d.items = d.items.filter((x) => !moving.includes(x));
    target.items.push(...moving);
    touch(d); touch(target); U.sel.clear(); save(); render();
    toast(`已移动 ${moving.length} 张卡片到「${target.title}」`);
  }

  function cardMenuItems(d, it) {
    const s = stOf(it.id);
    const secs = d.items.filter((x) => x.kind === 'section');
    return [
      { label: '创建副本', icon: '⧉', onClick: () => { const c = JSON.parse(JSON.stringify(it)); c.id = 'c' + uid(); insertAfter(d, [c], it.id); logEdit(c.id, 'create'); save(); render(); } },
      { label: '移动到指定目录', icon: '⇥', disabled: !secs.length, sub: () => secs.map((x) => ({ label: '　'.repeat(x.level - 1) + x.title, onClick: () => moveToSection(d, [it.id], x.id) })) },
      { label: '移动到卡片集', icon: '⇄', sub: () => liveDecks().filter((x) => x.id !== d.id).map((x) => ({ label: x.title, onClick: () => moveToDeck(d, [it.id], x) })) },
      '-',
      { label: '在后面添加卡片', icon: '＋', kbd: '⌥C', onClick: () => openEditor({ deckId: d.id, afterId: it.id }) },
      { label: '在后面添加目录', icon: '☰', kbd: '⌥D', onClick: () => newSection(d, it.id) },
      '-',
      s && s.mastered
        ? { label: '恢复学习', icon: '↺', onClick: () => { s.mastered = false; save(); render(); toast('已恢复学习'); } }
        : { label: '完成学习（标记已掌握）', icon: '✓', onClick: () => { S.states[it.id] = Object.assign(s || { state: 2, S: 30, D: 5, reps: 0, lapses: 0, due: Date.now() }, { mastered: true }); save(); render(); toast('已标记为掌握，不再出现在学习中'); } },
      { label: '彻底忘记（重置为新卡）', icon: '⟲', disabled: !s, onClick: () => { delete S.states[it.id]; save(); render(); toast('已重置为新卡'); } },
    ];
  }
  function sectionMenuItems(d, it) {
    const secs = d.items.filter((x) => x.kind === 'section' && x.id !== it.id);
    return [
      { label: '在后面添加卡片', icon: '＋', kbd: '⌥C', onClick: () => openEditor({ deckId: d.id, afterId: it.id }) },
      { label: '在后面添加目录', icon: '☰', kbd: '⌥D', onClick: () => newSection(d, it.id) },
      '-',
      { label: '移动到指定目录之后', icon: '⇥', disabled: !secs.length, sub: () => secs.map((x) => ({ label: '　'.repeat(x.level - 1) + x.title, onClick: () => { const [, end] = sectionBlock(d, x.id); const last = d.items[end - 1]; moveItem(d, it.id, last.id, true, false); } })) },
      { label: '移动到卡片集（含目录内容）', icon: '⇄', tag: 'P1', disabled: true },
      { label: '从这里开始学习', icon: '▶', onClick: () => { d.study = Object.assign({}, d.study, { sections: [it.id] }); save(); startStudy(d, 'recommend'); } },
    ];
  }

  function deckMenu(anchor, d) {
    const disp = dispOf(d);
    const setDisp = (k, v) => { d.display = Object.assign({}, d.display, { [k]: v }); save(); render(); };
    openMenu(anchor, [
      { label: '设置封面', icon: '▣', onClick: () => coverDialog(d) },
      { label: '编辑介绍', icon: '✎', onClick: async () => { const v = await promptDialog('编辑介绍', d.description, '一句话介绍这个卡片集'); if (v !== null) { d.description = v; touch(d); save(); render(); } } },
      '-',
      { label: '导入卡片', icon: '⇪', onClick: () => importDialog(d) },
      { label: '导出', icon: '⇩', onClick: () => exportDialog(d) },
      '-',
      { label: '学习设置', icon: '⚙', onClick: () => studySettingsDialog(d) },
      { label: '朗读偏好', icon: '🔈', tag: 'P1', disabled: true },
      { label: '重新开始学习', icon: '⟲', onClick: () => resetProgress(d) },
      '-',
      { label: '卡片布局', icon: '▦', sub: () => [
        { header: '卡片布局' },
        ...[['auto', '自动适应屏幕'], ['1', '每行 1 张'], ['2', '每行 2 张'], ['3', '每行 3 张']].map(([k, l]) => ({ label: l, checked: String(disp.layout) === k, onClick: () => setDisp('layout', k) })),
      ] },
      { label: '显示选项', icon: '◐', sub: () => [
        { header: '显示选项' },
        { label: '答案内容', checked: disp.answer, onClick: () => setDisp('answer', !disp.answer) },
        { label: '学习进度', checked: disp.progress, onClick: () => setDisp('progress', !disp.progress) },
        { label: '思维导图', checked: disp.mindmap, onClick: () => setDisp('mindmap', !disp.mindmap) },
        { label: '卡片目录', checked: disp.toc, onClick: () => setDisp('toc', !disp.toc) },
        { label: '测验进度', tag: 'P2', disabled: true },
      ] },
      '-',
      { label: '快捷键与操作', icon: '⌨', onClick: shortcutsDialog },
      { label: '分享 / 创建学习小组', icon: '↗', tag: '砍', disabled: true },
    ], { alignRight: true });
  }
  async function resetProgress(d) {
    const ids = cardsOf(d).map((c) => c.id).filter((id) => S.states[id]);
    if (!ids.length) { toast('当前卡片集还没有可重置的学习进度'); return; }
    if (!(await confirmDialog('重新开始学习', `将清空「${esc(d.title)}」中 ${ids.length} 张卡片的学习进度，所有卡片回到“未学习”。复习记录会保留在统计里。`, '确认重置', true))) return;
    ids.forEach((id) => delete S.states[id]);
    save(); render(); toast('已重置学习进度');
  }

  // ---------------------------------------------------------------- 点击事件（统一委托）
  const ACT = {
    'go': (t) => { location.hash = t.dataset.href; },
    'modal-close': () => closeModal(),
    'p2': (t) => toast((t.title || '该功能') + ' —— MVP 不做'),
    'new-deck': newDeck,
    'open-deck': (t, e) => { if (U.route.name === 'trash') return ACT['deck-card-menu'](t.querySelector('.more'), e); location.hash = '#/deck/' + t.dataset.id; },
    'deck-card-menu': (t, e) => {
      e.stopPropagation();
      const d = deckById(t.dataset.id);
      if (U.route.name === 'trash') {
        openMenu(t, [
          { label: '恢复', icon: '↺', onClick: () => { d.deletedAt = null; save(); render(); toast('已恢复'); } },
          { label: '彻底删除', icon: '✕', danger: true, onClick: async () => { if (await confirmDialog('彻底删除', `「${esc(d.title)}」及其所有卡片将被永久删除，无法恢复。`, '彻底删除', true)) { S.decks = S.decks.filter((x) => x !== d); save(); render(); } } },
        ]);
        return;
      }
      openMenu(t, [
        { label: '打开', onClick: () => { location.hash = '#/deck/' + d.id; } },
        { label: '在新标签页打开', onClick: () => window.open(location.pathname + '#/deck/' + d.id, '_blank') },
        { label: d.pinned ? '取消置顶' : '置顶', onClick: () => { d.pinned = !d.pinned; save(); render(); } },
        U.route.name === 'recent' ? { label: '从最近列表中删除', onClick: () => { d.hideRecent = true; save(); render(); } } : null,
        '-',
        { label: '移动到分类', sub: () => [{ label: '不分类', checked: !d.folderId, onClick: () => { d.folderId = null; save(); render(); } },
          ...S.folders.map((f) => ({ label: f.name, checked: d.folderId === f.id, onClick: () => { d.folderId = f.id; save(); render(); } }))] },
        { label: '创建副本', onClick: () => duplicateDeck(d) },
        '-',
        { label: '删除', danger: true, onClick: () => { d.deletedAt = Date.now(); save(); render(); toast('已移到回收站', { label: '撤销', run: () => { d.deletedAt = null; save(); render(); } }); } },
      ], { alignRight: true });
    },
    'sort-menu': (t) => openMenu(t, SORTS.map(([k, l]) => ({ label: l, checked: S.ui.sort === k, onClick: () => { S.ui.sort = k; save(); render(); } }))),
    'folder-new': async (t, e) => { e.stopPropagation(); const n = await promptDialog('新建分类', '', '分类名称'); if (n && n.trim()) { S.folders.push({ id: 'f' + uid(), name: n.trim() }); save(); render(); } },
    'folder-edit': (t, e) => { e.stopPropagation(); U.folderEdit = !U.folderEdit; render(); },
    'folder-rename': async (t, e) => { e.stopPropagation(); const f = S.folders.find((x) => x.id === t.dataset.id); const n = await promptDialog('重命名分类', f.name); if (n && n.trim()) { f.name = n.trim(); save(); render(); } },
    'folder-del': async (t, e) => {
      e.stopPropagation();
      const f = S.folders.find((x) => x.id === t.dataset.id);
      const ds = liveDecks().filter((d) => d.folderId === f.id);
      if (!(await confirmDialog('删除分类', ds.length ? `分类「${esc(f.name)}」下的 ${ds.length} 个卡片集会一起移到回收站。确定删除吗？` : `确定删除分类「${esc(f.name)}」吗？`, '删除', true))) return;
      ds.forEach((d) => { d.deletedAt = Date.now(); d.folderId = null; });
      S.folders = S.folders.filter((x) => x !== f);
      if (U.route.arg === f.id) location.hash = '#/';
      save(); render();
    },
    // 卡片集页
    'deck-menu': (t) => deckMenu(t, deckById(U.route.arg)),
    'deck-search': () => { U.deckSearchOpen = true; U.focusSearch = true; render(); },
    'deck-search-close': () => { U.deckSearchOpen = false; U.deckQ = ''; render(); },
    'speak-deck': () => toast('朗读放在 P1：用系统 TTS 朗读卡片'),
    'new-card': () => { const d = deckById(U.route.arg); openEditor({ deckId: d.id, afterId: [...U.sel].pop() }); },
    'new-section': () => { const d = deckById(U.route.arg); newSection(d, [...U.sel].pop()); },
    'toc-add': () => { const d = deckById(U.route.arg); newSection(d, null); },
    'toc-fold': () => { const d = deckById(U.route.arg); const secs = d.items.filter((x) => x.kind === 'section'); const any = secs.some((s) => !s.collapsed); secs.forEach((s) => { s.collapsed = any; }); save(); render(); },
    'toc-jump': (t) => { const d = deckById(U.route.arg); const s = itemById(d, t.dataset.id); if (s.collapsed) { s.collapsed = false; render(); } const el = $(`[data-item="${t.dataset.id}"]`); el && el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    'sec-toggle': (t, e) => { e.stopPropagation(); const d = deckById(U.route.arg); const s = itemById(d, t.dataset.id); s.collapsed = !s.collapsed; save(); render(); },
    'study': (t) => { const d = deckById(U.route.arg); startStudy(d, t.dataset.content || null); },
    'study-settings': () => studySettingsDialog(deckById(U.route.arg)),
    'quiz': () => toast('测验需要 AI 出题，放在 P2'),
    'mindmap': () => mindmapDialog(deckById(U.route.arg)),
    'import': (t, e) => { e.preventDefault(); importDialog(deckById(U.route.arg)); },
    'tb-open': () => openViewer(deckById(U.route.arg), [...U.sel][0]),
    'tb-edit': () => openEditor({ deckId: U.route.arg, cardId: [...U.sel][0] }),
    'tb-color': (t) => { const d = deckById(U.route.arg); const first = itemById(d, [...U.sel][0]); openMenu(t, [{ el: swatchesEl(first.color, (k) => { U.sel.forEach((id) => { const x = itemById(d, id); if (x.kind === 'card') x.color = k; }); S.ui.lastColor = k; touch(d); save(); render(); }) }]); },
    'tb-delete': () => { const d = deckById(U.route.arg); deleteItems(d, [...U.sel]); },
    'tb-move': (t) => { const d = deckById(U.route.arg); openMenu(t, d.items.filter((x) => x.kind === 'section').map((x) => ({ label: '　'.repeat(x.level - 1) + x.title, onClick: () => moveToSection(d, [...U.sel], x.id) }))); },
    'tb-more': (t) => { const d = deckById(U.route.arg); const it = itemById(d, [...U.sel][0]); openMenu(t, it.kind === 'card' ? cardMenuItems(d, it) : sectionMenuItems(d, it)); },
    'tb-rename': () => { U.renaming = [...U.sel][0]; render(); },
    'tb-level': (t) => { const d = deckById(U.route.arg); const it = itemById(d, [...U.sel][0]); openMenu(t, [1, 2, 3, 4, 5].map((l) => ({ label: `${['一', '二', '三', '四', '五'][l - 1]}级目录`, checked: it.level === l, onClick: () => { it.level = l; touch(d); save(); render(); } }))); },
  };
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (t && ACT[t.dataset.act]) { ACT[t.dataset.act](t, e); return; }
    // 卡片集页：点卡片 / 目录选中
    if (U.route.name === 'deck' && !e.target.closest('.mask, .menu')) {
      const item = e.target.closest('[data-item]');
      if (item && !e.target.closest('input')) {
        const d = deckById(U.route.arg);
        const it = itemById(d, item.dataset.item);
        // 已选中的目录再点一次 = 折叠 / 展开（原版：点按目录标题即可展开或收起）
        // 稍等一下再折叠，双击（改标题）时取消
        if (it.kind === 'section' && U.sel.size === 1 && U.sel.has(it.id) && !mod(e) && !e.shiftKey) {
          clearTimeout(U.secTimer);
          if (e.detail === 1) U.secTimer = setTimeout(() => { it.collapsed = !it.collapsed; save(); render(); }, 250);
          return;
        }
        selectItem(item.dataset.item, e);
      } else if (!e.target.closest('.float-toolbar, .fab-group, .deck-top, .progress-panel, .toc, #deck-title') && U.sel.size) {
        U.sel.clear(); refreshSelection();
      }
    }
  });
  document.addEventListener('dblclick', (e) => {
    if (U.route.name !== 'deck' || e.target.closest('.mask')) return;
    const item = e.target.closest('[data-item]');
    if (!item) return;
    const d = deckById(U.route.arg);
    const it = itemById(d, item.dataset.item);
    clearTimeout(U.secTimer);
    getSelection().removeAllRanges(); // 双击会顺带选中一个词，清掉
    if (it.kind === 'section') { U.renaming = it.id; render(); } else openViewer(d, it.id);
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'home-search') { U.homeQ = e.target.value; const pos = e.target.selectionStart; render(); const i = $('#home-search'); i.focus(); i.setSelectionRange(pos, pos); }
    if (e.target.id === 'deck-search') { U.deckQ = e.target.value; U.focusSearch = true; render(); }
    if (e.target.id === 'deck-title') { const d = deckById(U.route.arg); d.title = e.target.value; touch(d); save(); }
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.id === 'rename-input') commitRename(e.target);
  });
  function commitRename(inp) {
    if (!U.renaming) return;
    const d = deckById(U.route.arg);
    const s = itemById(d, inp.dataset.id);
    if (s) { s.title = inp.value.trim().slice(0, 200) || '新目录'; touch(d); }
    U.renaming = null; save(); render();
  }

  // 拖拽排序
  document.addEventListener('dragstart', (e) => {
    const it = e.target.closest && e.target.closest('[data-item]');
    if (!it || U.route.name !== 'deck') return;
    U.drag = { id: it.dataset.item, alt: e.altKey };
    it.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  document.addEventListener('dragend', () => { U.drag = null; $$('.dragging').forEach((x) => x.classList.remove('dragging')); clearDrop(); });
  function clearDrop() { $$('[data-item]').forEach((x) => { x.style.boxShadow = ''; }); }
  function dropPos(el, e) {
    const r = el.getBoundingClientRect();
    return el.classList.contains('mini-card') ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
  }
  document.addEventListener('dragover', (e) => {
    if (!U.drag) return;
    const el = e.target.closest('[data-item]');
    if (!el) return;
    e.preventDefault();
    clearDrop();
    const after = dropPos(el, e);
    const card = el.classList.contains('mini-card');
    el.style.boxShadow = card ? (after ? '4px 0 0 var(--accent)' : '-4px 0 0 var(--accent)') : (after ? '0 3px 0 var(--accent)' : '0 -3px 0 var(--accent)');
  });
  document.addEventListener('drop', (e) => {
    if (!U.drag) return;
    const el = e.target.closest('[data-item]');
    if (!el) return;
    e.preventDefault();
    const d = deckById(U.route.arg);
    if (el.dataset.item !== U.drag.id) moveItem(d, U.drag.id, el.dataset.item, dropPos(el, e), U.drag.alt || e.altKey);
    U.drag = null;
  });

  // ---------------------------------------------------------------- 卡片集页快捷键
  function deckKeys(e) {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) {
      if (e.target.id === 'rename-input') {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.target.blur(); }
        if (e.key === 'Escape') { U.renaming = null; render(); }
      }
      if (e.target.id === 'deck-title' && e.key === 'Enter') e.target.blur();
      if (e.target.id === 'deck-search' && e.key === 'Escape') ACT['deck-search-close']();
      return;
    }
    const d = deckById(U.route.arg);
    if (!d) return;
    const sel = [...U.sel];
    const one = sel.length === 1 ? itemById(d, sel[0]) : null;
    if (e.altKey && e.code === 'KeyC') { e.preventDefault(); openEditor({ deckId: d.id, afterId: sel.pop() }); return; }
    if (e.altKey && e.code === 'KeyD') { e.preventDefault(); newSection(d, sel.pop()); return; }
    if (mod(e) && e.key.toLowerCase() === 'a') { e.preventDefault(); U.sel = new Set(visibleItemIds()); refreshSelection(); return; }
    if (mod(e) && e.key.toLowerCase() === 'f') { e.preventDefault(); ACT['deck-search'](); return; }
    if (mod(e) || e.altKey) return;
    switch (e.key) {
      case 'c': case 'C': e.preventDefault(); openEditor({ deckId: d.id, afterId: sel.pop() }); break;
      case 'd': case 'D': e.preventDefault(); newSection(d, sel.pop()); break;
      case 'e': case 'E': if (one) { e.preventDefault(); one.kind === 'card' ? openEditor({ deckId: d.id, cardId: one.id }) : (U.renaming = one.id, render()); } break;
      case 'Enter': if (one && one.kind === 'card') { e.preventDefault(); openViewer(d, one.id); } break;
      case 'Backspace': case 'Delete': if (sel.length) { e.preventDefault(); deleteItems(d, sel); } break;
      case 'Escape': if (sel.length) { U.sel.clear(); refreshSelection(); } break;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        const ids = visibleItemIds();
        if (!ids.length) break;
        e.preventDefault();
        let i = U.anchor ? ids.indexOf(U.anchor) : -1;
        const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
        i = Math.max(0, Math.min(ids.length - 1, i + step));
        if (e.shiftKey) { U.sel.add(ids[i]); U.anchor = ids[i]; refreshSelection(); } else selectItem(ids[i]);
        $(`[data-item="${ids[i]}"]`).scrollIntoView({ block: 'nearest' });
        break;
      }
      default: break;
    }
  }

  document.addEventListener('keydown', (e) => {
    if (U.menu && e.key === 'Escape') { closeMenu(); return; }
    const top = U.modals[U.modals.length - 1];
    if (top) {
      if (top.onKey) top.onKey(e);
      else if (e.key === 'Escape') closeModal(top);
      return;
    }
    if (U.route.name === 'deck') deckKeys(e);
  });

  // ================================================================ 编辑器
  function openEditor({ deckId, cardId, afterId }) {
    const d = deckById(deckId);
    const card = cardId ? itemById(d, cardId) : null;
    U.ed = {
      deckId, cardId, afterId,
      type: card ? card.type : S.ui.lastType || 'qa',
      color: card ? card.color : S.ui.lastColor || 'default',
      md: { front: card ? card.front : '', hint: card ? card.hint || '' : '', back: card ? card.back || '' : '' },
      showHint: !!(card && card.hint),
      src: {},
      dirty: false,
      active: null,
      help: false,
    };
    const m = openModal('', { cls: 'editor-dialog', onKey: editorKeys, onMask: () => editorSave(true) });
    U.ed.modal = m;
    buildEditor();
  }
  function buildEditor() {
    const ed = U.ed, el = ed.modal.el;
    const field = (f, label, ph, small) => `<div class="field" data-field="${f}">
        <span class="field-label">${label}</span>
        <div class="field-tools"><button data-ed="src" data-f="${f}" class="${ed.src[f] ? 'on' : ''}" title="切换 Markdown 源码">M↓ 源码</button></div>
        ${ed.src[f] ? `<textarea class="src" data-f="${f}" spellcheck="false" placeholder="${esc(ph)}">${esc(ed.md[f])}</textarea>`
          : `<div class="wysiwyg md ${small ? 'small' : ''}" contenteditable="true" data-f="${f}" data-ph="${esc(ph)}"></div>`}
        <div class="field-foot"><button data-ed="img" data-f="${f}" title="插入图片（也可以直接粘贴、拖入）">🖼</button><button data-act="p2" title="录音">🎙</button><button data-act="p2" title="附件">📎</button></div>
      </div>`;
    let fields;
    if (ed.type === 'topic') {
      fields = `<div class="field"><span class="field-label">标题</span><input class="text-input" style="border:0;font-size:17px;font-weight:600;height:48px;padding:0 14px" data-topic="front" value="${esc(ed.md.front)}" placeholder="主题标题"></div>
        <div class="field"><span class="field-label">内容（纯文本，无样式）</span><textarea class="src" style="font-family:inherit;font-size:14px;background:none" data-topic="back" placeholder="内容">${esc(ed.md.back)}</textarea></div>`;
    } else if (ed.type === 'qa') {
      fields = field('front', '问题', '输入问题，⌘E 挖空，支持 Markdown') +
        (ed.showHint ? field('hint', '提示', '可填写口诀、速记、关键词或易错提醒，学习时先于答案显示', true) : '<button class="add-hint" data-ed="add-hint">＋ 提示</button>') +
        field('back', '答案', '输入答案');
    } else {
      fields = field('front', '内容', '输入内容。选中文字按 ⌘E 挖空，或直接输入 {{答案}}');
    }
    el.innerHTML = `
      <div class="editor-head">
        <button class="btn sm" data-ed="type">${TYPE_NAMES[ed.type]} ▾</button>
        <button class="btn sm" data-ed="color" title="卡片颜色"><span class="swatch" style="background:${colorHex(ed.color)}"></span> 颜色</button>
        <span class="hint-text" style="margin-left:6px">${ed.cardId ? '编辑卡片' : '新建卡片'}${!ed.cardId && S.settings.continuousNew ? ' · 连续新建' : ''}</span>
        <div style="flex:1"></div>
        <button class="btn sm ghost" data-ed="help">Markdown 语法</button>
        <button class="icon-btn" data-ed="close" title="关闭（不保存）">×</button>
      </div>
      ${ed.type === 'topic' ? '' : toolbarHTML()}
      <div class="editor-scroll">
        ${ed.help ? mdHelpHTML() : ''}
        ${fields}
      </div>
      <div class="editor-foot">
        <span class="tip">⌘E 挖空 · ⌥↩ 切换正反面 · ⌘↩ 完成 · Esc 保存并关闭</span>
        <div style="flex:1"></div>
        <button class="btn primary" data-ed="done">完成 ⌘↩</button>
      </div>`;
    $$('.wysiwyg', el).forEach((w) => {
      const f = w.dataset.f;
      w.innerHTML = ed.md[f] ? MD.render(ed.md[f]) : '';
      bindWysiwyg(w);
    });
    $$('textarea.src[data-f]', el).forEach((t) => {
      autoGrow(t);
      t.addEventListener('input', () => { ed.dirty = true; autoGrow(t); });
      t.addEventListener('focus', () => { ed.active = t; markFocus(t); });
      t.addEventListener('keydown', fieldKeys);
    });
    $$('[data-topic]', el).forEach((t) => t.addEventListener('input', () => { ed.dirty = true; }));
    el.onclick = editorClick;
    el.onmousedown = (e) => { if (e.target.closest('.editor-toolbar .tb')) e.preventDefault(); };
    const first = $('.wysiwyg, textarea.src, [data-topic]', el);
    if (first && !ed.active) setTimeout(() => { first.focus(); placeCaretEnd(first); }, 0);
  }
  function autoGrow(t) { t.style.height = 'auto'; t.style.height = Math.max(110, t.scrollHeight + 4) + 'px'; }
  function markFocus(node) { $$('.field', U.ed.modal.el).forEach((f) => f.classList.toggle('focus', f.contains(node))); }
  function placeCaretEnd(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') { el.setSelectionRange(el.value.length, el.value.length); return; }
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function toolbarHTML() {
    const b = (cmd, label, title, cls = '') => `<button class="tb ${cls}" data-tb="${cmd}" title="${esc(title)}">${label}</button>`;
    return `<div class="editor-toolbar">
      ${b('heading', 'T ▾', '正文 / 标题')}
      ${b('marker', '🖍 ▾', '马克笔、划线、文字颜色')}
      <span class="tb-sep"></span>
      ${b('bold', '<b>B</b>', '加粗 ⌘B')}${b('italic', '<i>I</i>', '斜体 ⌘I')}${b('underline', '<u>U</u>', '下划线 ⌘U')}
      ${b('cloze', '[ 挖空 ]', '挖空 ⌘E（也可以直接输入 {{答案}}）', 'cloze-btn')}
      <span class="tb-sep"></span>
      ${b('clear', '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 3h8M6.5 3v10M10.5 10l3.5 3.5M14 10l-3.5 3.5"/></svg>', '清除格式')}${b('brush', '🖌', '格式刷（P1）')}${b('link', '🔗', '链接')}
      ${b('undo', '↶', '撤销 ⌘Z')}${b('redo', '↷', '恢复 ⌘⇧Z')}
      <span class="tb-sep"></span>
      ${b('ul', '•≡', '无序列表（输入“- ”）')}${b('ol', '1≡', '有序列表（输入“1. ”）')}${b('quote', '❝', '引用（输入“> ”）')}
      ${b('code', '&lt;/&gt;', '代码块（输入 ```）')}${b('formula', '∑', '插入公式（LaTeX）')}${b('image', '🖼', '插入图片')}
    </div>`;
  }
  function mdHelpHTML() {
    return `<div class="md-help">
      <b>挖空</b>：选中文字按 <code>⌘E</code>，或直接输入 <code>{{答案}}</code>（一行内，可以套加粗等格式）<br>
      <b>标题</b> <code># </code> <code>## </code> <code>### </code> · <b>列表</b> <code>- </code> <code>1. </code>（Tab 缩进） · <b>引用</b> <code>&gt; </code> · <b>代码块</b> <code>\`\`\`</code><br>
      <b>加粗</b> <code>**x**</code> · <b>马克笔</b> <code>==x==</code> · <b>行内代码</b> <code>\`x\`</code> · <b>公式</b> <code>$x^2$</code><br>
      粘贴 Markdown 文本会自动转成格式；右上角“M↓ 源码”可以直接改 Markdown。
    </div>`;
  }
  function bindWysiwyg(w) {
    const ed = U.ed;
    w.addEventListener('focus', () => { ed.active = w; markFocus(w); });
    w.addEventListener('input', (e) => { ed.dirty = true; if (e.inputType === 'insertText' && !e.isComposing) inputRules(w, e.data); });
    w.addEventListener('compositionend', (e) => inputRules(w, e.data));
    w.addEventListener('keydown', fieldKeys);
    w.addEventListener('paste', (e) => {
      const cd = e.clipboardData;
      const img = [...cd.items].find((i) => i.type.startsWith('image/'));
      if (img) { e.preventDefault(); readImage(img.getAsFile()).then((url) => document.execCommand('insertHTML', false, `<img src="${url}">`)); return; }
      const text = cd.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      if (/(^|\n)\s*([-*] |\d+\. |#{1,6} |> |```)|\{\{|\*\*|==|\$/.test(text)) document.execCommand('insertHTML', false, MD.render(text));
      else document.execCommand('insertText', false, text);
    });
    w.addEventListener('drop', (e) => {
      const f = [...(e.dataTransfer.files || [])].find((x) => x.type.startsWith('image/'));
      if (!f) return;
      e.preventDefault();
      readImage(f).then((url) => document.execCommand('insertHTML', false, `<img src="${url}">`));
    });
  }
  function readImage(file) {
    return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
  }

  // 输入规则：行首 # / - / 1. / > / ```，行内 {{x}} / **x** / ==x== / `x`
  const BLOCK_TAGS = /^(P|DIV|LI|H1|H2|H3|H4|BLOCKQUOTE|PRE)$/;
  function blockOf(node, root) {
    let n = node.nodeType === 3 ? node.parentNode : node;
    while (n && n !== root && !BLOCK_TAGS.test(n.nodeName)) n = n.parentNode;
    return n || root;
  }
  function isFirstText(block, node) {
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) { if (w.currentNode.data.replace(/​/g, '').length || w.currentNode === node) return w.currentNode === node; }
    return false;
  }
  // data：这次插入的文字。逐字输入时是一个字符；输入法上屏、自动补全时是一整段
  function inputRules(root, data) {
    if (!data) return;
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    if (node.nodeType !== 3) return;
    if (node.parentElement.closest('pre, code')) return;
    const off = r.startOffset;
    const raw = node.data.slice(0, off);
    const z = raw.length - raw.replace(/^​+/, '').length;
    const before = raw.slice(z).replace(/\u00A0/g, ' '); // 行尾空格在 contenteditable 里是 &nbsp;
    const fresh = before.length - data.length; // 新插入的文字从这里开始
    const block = blockOf(node, root);
    if (isFirstText(block, node)) {
      const rules = [['### ', 'h3'], ['## ', 'h2'], ['# ', 'h1'], ['- ', 'ul'], ['* ', 'ul'], ['1. ', 'ol'], ['> ', 'blockquote'], ['```', 'pre']];
      const hit = rules.find(([p]) => before.startsWith(p) && p.length > fresh);
      if (hit) {
        const dr = document.createRange(); dr.setStart(node, 0); dr.setEnd(node, z + hit[0].length); dr.deleteContents();
        if (hit[1] === 'pre') { makeCodeBlock(root); return; }
        if (hit[1] === 'ul') document.execCommand('insertUnorderedList');
        else if (hit[1] === 'ol') document.execCommand('insertOrderedList');
        else document.execCommand('formatBlock', false, hit[1]);
        $$('p > ul, p > ol', root).forEach((l) => { if (l.parentNode.childNodes.length === 1) l.parentNode.replaceWith(l); });
        // 光标放到行尾；一次插入了整段时，前缀之后的部分再走一遍行内规则
        const s2 = getSelection();
        if (s2.rangeCount) {
          const b = blockOf(s2.getRangeAt(0).startContainer, root);
          const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
          let last = null;
          while (w.nextNode()) last = w.currentNode;
          const nr = document.createRange();
          if (last) nr.setStart(last, last.data.length); else nr.selectNodeContents(b);
          nr.collapse(!last ? false : true);
          s2.removeAllRanges(); s2.addRange(nr);
        }
        const rest = data.length - (hit[0].length - fresh);
        if (rest > 0) inputRules(root, data.slice(-rest));
        return;
      }
    }
    const inl = [[/\{\{([^{}\n]+)\}\}/g, 'cloze'], [/\*\*([^*\n]+)\*\*/g, 'strong'], [/==([^=\n]+)==/g, 'mark'], [/`([^`\n]+)`/g, 'code']];
    for (const [re, tag] of inl) {
      // 只处理结尾落在新插入文字里的那一处，避免改动早就写好的内容
      const m = [...before.matchAll(re)].filter((x) => x.index + x[0].length > fresh).pop();
      if (!m) continue;
      const s0 = z + m.index, s1 = s0 + m[0].length;
      const tail = node.data.slice(s1, off);
      const rr = document.createRange(); rr.setStart(node, s0); rr.setEnd(node, off); rr.deleteContents();
      const el = document.createElement(tag === 'cloze' ? 'span' : tag);
      if (tag === 'cloze') el.className = 'cloze';
      el.textContent = m[1];
      rr.insertNode(el);
      caretAfter(el, tail);
      return;
    }
  }
  function caretAfter(el, tail = '') {
    const t = document.createTextNode(tail || '\u200B');
    el.after(t);
    const r = document.createRange(); r.setStart(t, t.data.length); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function makeCodeBlock(root) {
    const sel = getSelection();
    const block = blockOf(sel.getRangeAt(0).startContainer, root);
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = (block === root ? '' : block.textContent.replace(/​/g, '')) || '​';
    pre.appendChild(code);
    if (block === root) root.appendChild(pre); else block.replaceWith(pre);
    const r = document.createRange(); r.selectNodeContents(code); r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
  }

  function activeWysiwyg() { const a = U.ed && U.ed.active; return a && a.classList && a.classList.contains('wysiwyg') ? a : null; }
  function selInside(root) { const s = getSelection(); return s.rangeCount && root.contains(s.getRangeAt(0).commonAncestorContainer) ? s.getRangeAt(0) : null; }
  function unwrap(el) { const p = el.parentNode; while (el.firstChild) p.insertBefore(el.firstChild, el); p.removeChild(el); }
  function closestIn(node, sel, root) { const e = node.nodeType === 3 ? node.parentElement : node; const c = e && e.closest(sel); return c && root.contains(c) ? c : null; }

  function toggleCloze() {
    const ed = U.ed;
    if (ed.active && ed.active.tagName === 'TEXTAREA') { wrapTextarea(ed.active, '{{', '}}'); return; }
    const root = activeWysiwyg();
    if (!root) return;
    const r = selInside(root);
    if (!r) return;
    const inC = closestIn(r.startContainer, '.cloze', root);
    if (inC && (r.collapsed || closestIn(r.endContainer, '.cloze', root) === inC)) { unwrap(inC); ed.dirty = true; return; }
    if (r.collapsed) {
      const sp = document.createElement('span');
      sp.className = 'cloze';
      sp.textContent = '​';
      r.insertNode(sp);
      const nr = document.createRange(); nr.setStart(sp.firstChild, 1); nr.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(nr);
      ed.dirty = true;
      return;
    }
    if (blockOf(r.startContainer, root) !== blockOf(r.endContainer, root)) { toast('挖空不能跨行，请分别选中每一行'); return; }
    const sp = document.createElement('span');
    sp.className = 'cloze';
    sp.appendChild(r.extractContents());
    $$('.cloze', sp).forEach(unwrap);
    r.insertNode(sp);
    const nr = document.createRange(); nr.selectNodeContents(sp);
    const s = getSelection(); s.removeAllRanges(); s.addRange(nr);
    ed.dirty = true;
  }
  function wrapInline(el) {
    const root = activeWysiwyg();
    if (!root) { toast('源码模式下请直接写 Markdown'); return; }
    const r = selInside(root);
    if (!r || r.collapsed) { toast('请先选中文字'); return; }
    if (blockOf(r.startContainer, root) !== blockOf(r.endContainer, root)) { toast('请在一行内选择'); return; }
    el.appendChild(r.extractContents());
    r.insertNode(el);
    U.ed.dirty = true;
  }
  function wrapTextarea(t, a, b) {
    const s = t.selectionStart, e = t.selectionEnd, v = t.value;
    t.value = v.slice(0, s) + a + v.slice(s, e) + b + v.slice(e);
    t.setSelectionRange(s + a.length, e + a.length);
    U.ed.dirty = true;
  }

  function editorClick(e) {
    const ed = U.ed;
    const t = e.target.closest('[data-ed], [data-tb]');
    if (!t) return;
    if (t.dataset.tb) { toolbarCmd(t.dataset.tb, t); return; }
    const a = t.dataset.ed;
    if (a === 'close') {
      if (ed.dirty) confirmDialog('放弃修改？', '关闭后，本次修改不会保存。', '放弃修改', true).then((ok) => ok && closeModal(ed.modal));
      else closeModal(ed.modal);
    } else if (a === 'done') editorDone();
    else if (a === 'help') { syncEditor(); ed.help = !ed.help; buildEditor(); }
    else if (a === 'add-hint') { syncEditor(); ed.showHint = true; buildEditor(); setTimeout(() => { const h = $('[data-f="hint"]', ed.modal.el); h && h.focus(); }, 0); }
    else if (a === 'src') { syncEditor(); ed.src[t.dataset.f] = !ed.src[t.dataset.f]; ed.active = null; buildEditor(); setTimeout(() => { const x = $(`[data-f="${t.dataset.f}"].wysiwyg, textarea[data-f="${t.dataset.f}"]`, ed.modal.el); x && x.focus(); }, 0); }
    else if (a === 'img') { ed.active = $(`.wysiwyg[data-f="${t.dataset.f}"]`, ed.modal.el) || ed.active; pickImage(); }
    else if (a === 'type') {
      openMenu(t, ['note', 'qa', 'topic'].map((k) => ({
        label: TYPE_NAMES[k], checked: ed.type === k, tag: k === 'topic' ? 'P1' : '',
        onClick: async () => {
          if (k === ed.type) return;
          syncEditor();
          if (k === 'topic' && !(await confirmDialog('切换为主题卡片', '主题卡片只有标题和纯文本内容，样式和图片会被清除。', '切换'))) return;
          if (k === 'topic') { ed.md.front = MD.plain(ed.md.front).slice(0, 60); ed.md.back = MD.plain(ed.md.back); }
          ed.type = k; ed.active = null; buildEditor();
        },
      })));
    } else if (a === 'color') {
      openMenu(t, [{ el: swatchesEl(ed.color, (k) => { syncEditor(); ed.color = k; buildEditor(); }) }]);
    }
  }
  function pickImage() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    const saved = saveSel();
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      readImage(f).then((url) => {
        const w = activeWysiwyg();
        if (!w) return;
        w.focus(); restoreSel(saved);
        document.execCommand('insertHTML', false, `<img src="${url}">`);
        U.ed.dirty = true;
      });
    };
    inp.click();
  }
  function saveSel() { const s = getSelection(); return s.rangeCount ? s.getRangeAt(0).cloneRange() : null; }
  function restoreSel(r) { if (!r) return; const s = getSelection(); s.removeAllRanges(); s.addRange(r); }

  function toolbarCmd(cmd, btn) {
    const ed = U.ed;
    const w = activeWysiwyg();
    const ta = ed.active && ed.active.tagName === 'TEXTAREA' ? ed.active : null;
    if (ta) {
      const map = { bold: ['**', '**'], italic: ['*', '*'], cloze: ['{{', '}}'], underline: ['<u>', '</u>'] };
      if (map[cmd]) wrapTextarea(ta, ...map[cmd]); else toast('源码模式下请直接写 Markdown');
      return;
    }
    if (!w) { toast('先点一下要编辑的输入框'); return; }
    const exec = (c, v) => { document.execCommand(c, false, v); ed.dirty = true; };
    switch (cmd) {
      case 'bold': exec('bold'); break;
      case 'italic': exec('italic'); break;
      case 'underline': exec('underline'); break;
      case 'cloze': toggleCloze(); break;
      case 'undo': exec('undo'); break;
      case 'redo': exec('redo'); break;
      case 'ul': exec('insertUnorderedList'); break;
      case 'ol': exec('insertOrderedList'); break;
      case 'quote': exec('formatBlock', 'blockquote'); break;
      case 'code': makeCodeBlock(w); ed.dirty = true; break;
      case 'image': pickImage(); break;
      case 'brush': toast('格式刷放在 P1（单击用一次，双击连续用）'); break;
      case 'clear': {
        exec('removeFormat');
        const r = selInside(w);
        if (r) $$('.cloze, mark, [data-tc]', w).forEach((x) => { if (r.intersectsNode(x)) unwrap(x); });
        break;
      }
      case 'heading':
        openMenu(btn, [
          { label: '正文', onClick: () => exec('formatBlock', 'p') },
          { label: '一级标题', kbd: '# ', onClick: () => exec('formatBlock', 'h1') },
          { label: '二级标题', kbd: '## ', onClick: () => exec('formatBlock', 'h2') },
          { label: '三级标题', kbd: '### ', onClick: () => exec('formatBlock', 'h3') },
          '-',
          { header: '字号（P1）' },
          { label: '小号 12', disabled: true }, { label: '中号 16', disabled: true }, { label: '大号 22', disabled: true }, { label: '特大 26', disabled: true },
        ]);
        break;
      case 'marker': openMenu(btn, markerMenu()); break;
      case 'link': {
        const saved = saveSel();
        promptDialog('添加链接', 'https://', '输入网址').then((url) => {
          if (!url) return;
          w.focus(); restoreSel(saved);
          if (saved && !saved.collapsed) exec('createLink', url);
          else exec('insertHTML', `<a href="${esc(url)}">${esc(url)}</a>`);
        });
        break;
      }
      case 'formula': formulaDialog(w); break;
      default: break;
    }
  }
  function markerMenu() {
    const row = (title, items) => () => {
      const box = document.createElement('div');
      box.style.cssText = 'padding:4px 8px 6px';
      box.innerHTML = `<div class="hint-text" style="margin:0 0 4px">${title}</div>`;
      const line = document.createElement('div');
      line.style.cssText = 'display:flex;gap:6px;align-items:center';
      items.forEach(([html, tip, fn]) => {
        const b = document.createElement('span');
        b.innerHTML = html; b.title = tip; b.style.cursor = 'pointer';
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => { closeMenu(); fn(); });
        line.appendChild(b);
      });
      box.appendChild(line);
      return box;
    };
    const mk = (attrs) => () => { const m = document.createElement('mark'); Object.entries(attrs).forEach(([k, v]) => m.setAttribute(k, v)); wrapInline(m); };
    const sw = (c) => `<span class="swatch" style="width:22px;height:22px;background:${c}"></span>`;
    const tc = (k, c) => () => { const s = document.createElement('span'); s.setAttribute('data-tc', k); wrapInline(s); };
    return [
      { el: row('马克笔', [[sw('#fff1a8'), '黄（==x==）', mk({})], [sw('#c9f0d6'), '绿', mk({ 'data-c': 'green' })], [sw('#cfe2ff'), '蓝', mk({ 'data-c': 'blue' })], [sw('#ffd6d6'), '红', mk({ 'data-c': 'red' })], [sw('#e6d9ff'), '紫', mk({ 'data-c': 'purple' })]]) },
      { el: row('划线', [['<span class="chip" style="height:24px">▁ 下划线</span>', '马克笔下划线', mk({ 'data-s': 'line' })], ['<span class="chip" style="height:24px;text-decoration:underline wavy #e5484d">波浪线</span>', '波浪线', mk({ 'data-s': 'wavy' })]]) },
      { el: row('文字颜色', [['<b style="color:#e5484d">A</b>', '红', tc('red')], ['<b style="color:#2f6fe0">A</b>', '蓝', tc('blue')], ['<b style="color:#1f9d5c">A</b>', '绿', tc('green')], ['<b style="color:#a1a1a6">A</b>', '灰', tc('grey')]]) },
      '-',
      { label: '清除马克笔和颜色', onClick: () => { const w = activeWysiwyg(); const r = w && selInside(w); if (r) $$('mark, [data-tc]', w).forEach((x) => { if (r.intersectsNode(x)) unwrap(x); }); } },
    ];
  }
  function formulaDialog(w) {
    const saved = saveSel();
    const m = openModal(dialogHTML('插入公式（LaTeX）', `<input class="text-input" id="fx-in" placeholder="例：x^2+y^2=z^2" style="font-family:ui-monospace,Menlo,monospace">
        <div id="fx-prev" style="min-height:44px;padding:12px 4px;text-align:center"></div>`,
      '<button class="btn" data-x="no">取消</button><button class="btn primary" data-x="ok">确定</button>'), { light: true });
    const inp = $('#fx-in', m.el), prev = $('#fx-prev', m.el);
    inp.addEventListener('input', () => { prev.innerHTML = inp.value ? MD.renderInline('$' + inp.value + '$') : ''; });
    setTimeout(() => inp.focus(), 0);
    const done = (ok) => {
      closeModal(m);
      if (!ok || !inp.value.trim()) return;
      w.focus(); restoreSel(saved);
      document.execCommand('insertHTML', false, MD.renderInline('$' + inp.value.trim() + '$') + '​');
      U.ed.dirty = true;
    };
    m.el.addEventListener('click', (e) => { const x = e.target.closest('[data-x]'); if (x) done(x.dataset.x === 'ok'); });
    m.onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); };
  }

  function fieldKeys(e) {
    const ed = U.ed;
    if (mod(e) && (e.key.toLowerCase() === 'e' || e.key.toLowerCase() === 'k')) { e.preventDefault(); e.stopPropagation(); toggleCloze(); return; }
    if (e.key === 'Tab' && e.target.classList.contains('wysiwyg')) {
      const r = selInside(e.target);
      if (r && closestIn(r.startContainer, 'li', e.target)) { e.preventDefault(); document.execCommand(e.shiftKey ? 'outdent' : 'indent'); ed.dirty = true; }
      else if (r && closestIn(r.startContainer, 'pre', e.target)) { e.preventDefault(); document.execCommand('insertText', false, '    '); }
    }
    if (e.key === 'Enter' && !mod(e) && !e.altKey && e.target.classList.contains('wysiwyg')) {
      // 代码块里回车换行，不退出代码块
      const r = selInside(e.target);
      if (r && closestIn(r.startContainer, 'pre', e.target)) { e.preventDefault(); document.execCommand('insertText', false, '\n'); }
    }
  }
  function editorKeys(e) {
    const ed = U.ed;
    if (U.modals[U.modals.length - 1] !== ed.modal) return;
    if (mod(e) && e.key === 'Enter') { e.preventDefault(); editorDone(); return; }
    if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); editorSave(true); return; }
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      const fields = $$('.wysiwyg, textarea.src[data-f], [data-topic]', ed.modal.el);
      const i = fields.indexOf(document.activeElement);
      const next = fields[(i + 1) % fields.length];
      next.focus(); placeCaretEnd(next);
    }
  }
  function syncEditor() {
    const ed = U.ed;
    if (!ed || !ed.modal) return;
    $$('.wysiwyg', ed.modal.el).forEach((w) => { ed.md[w.dataset.f] = MD.toMarkdown(w.innerHTML); });
    $$('textarea.src[data-f]', ed.modal.el).forEach((t) => { ed.md[t.dataset.f] = t.value; });
    $$('[data-topic]', ed.modal.el).forEach((t) => { ed.md[t.dataset.topic] = t.value; });
  }
  function editorSave(close) {
    const ed = U.ed;
    syncEditor();
    const d = deckById(ed.deckId);
    const md = ed.md;
    const empty = !md.front.trim() && !md.back.trim();
    let id = ed.cardId;
    if (!empty) {
      if (id) {
        const c = itemById(d, id);
        Object.assign(c, { type: ed.type, color: ed.color, front: md.front, hint: ed.type === 'qa' ? md.hint : '', back: ed.type === 'note' ? '' : md.back, updatedAt: Date.now() });
        if (ed.dirty) logEdit(id, 'update');
      } else {
        id = 'c' + uid();
        insertAfter(d, [{ id, kind: 'card', type: ed.type, color: ed.color, front: md.front, hint: ed.type === 'qa' ? md.hint : '', back: ed.type === 'note' ? '' : md.back, createdAt: Date.now(), updatedAt: Date.now() }], ed.afterId);
        logEdit(id, 'create');
      }
      touch(d);
      S.ui.lastType = ed.type;
      S.ui.lastColor = ed.color;
      save();
    }
    if (close) {
      closeModal(ed.modal);
      U.ed = null;
      if (U.study) renderStudy(); else { if (id && !empty) U.sel = new Set([id]); render(); }
    }
    return { id, empty };
  }
  function editorDone() {
    const ed = U.ed;
    const creating = !ed.cardId;
    if (creating && S.settings.continuousNew) {
      const { id, empty } = editorSave(false);
      if (empty) { toast('卡片是空的'); return; }
      ed.afterId = id;
      ed.md = { front: '', hint: '', back: '' };
      ed.dirty = false; ed.active = null;
      buildEditor();
      render();
      toast('已保存，继续新建下一张');
    } else editorSave(true);
  }

  // ================================================================ 学习
  function studyCfg(d) {
    return Object.assign({ content: 'recommend', colors: [], sections: [], order: 'sequential', direction: 'front', clickBlank: S.settings.clickBlankRevealNext, size: 'default', fontSize: S.settings.fontSize }, d.study || {});
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function todayCount(d, wasNew) {
    const t0 = todayStart();
    return S.logs.filter((l) => l.deckId === d.id && l.at >= t0 && l.kind === 'grade' && !!l.wasNew === wasNew && !l.practice).length;
  }
  function buildQueue(d, content, cfg) {
    const paths = sectionPaths(d);
    let cards = cardsOf(d);
    if (cfg.sections.length) cards = cards.filter((c) => (paths[c.id] || []).some((s) => cfg.sections.includes(s)));
    if (cfg.colors.length) cards = cards.filter((c) => cfg.colors.includes(c.color || 'default'));
    const p = planOf(d);
    const freshLeft = Math.max(0, p.newPerDay - todayCount(d, true));
    const dueLeft = Math.max(0, p.reviewPerDay - todayCount(d, false));
    let due = cards.filter((c) => isDue(c.id, d));
    let fresh = cards.filter((c) => isNew(c.id));
    if (cfg.order === 'due_first') due.sort((a, b) => stOf(a.id).due - stOf(b.id).due);
    due = due.slice(0, dueLeft);
    fresh = fresh.slice(0, freshLeft);
    let list;
    if (content === 'new') list = fresh;
    else if (content === 'review') list = due;
    else if (content === 'all') list = cards.filter((c) => !(stOf(c.id) || {}).mastered);
    else list = [...due, ...fresh];
    if (cfg.order === 'random') shuffle(list);
    return list.map((c) => ({ id: c.id, rep: false }));
  }
  function startStudy(d, content) {
    const cfg = studyCfg(d);
    const c = content || cfg.content;
    const queue = buildQueue(d, c, cfg);
    if (!queue.length) {
      toast(c === 'review' ? '当前没有需要复习的卡片' : c === 'new' ? '今天的新卡已学完（或没有未学卡片）' : '当前待学卡片已清空 🎉');
      return;
    }
    openStudy(d, { label: CONTENT_NAMES[c], queue, idx: 0 });
  }
  function openViewer(d, cardId) {
    const queue = cardsOf(d).map((c) => ({ id: c.id, rep: false }));
    openStudy(d, { label: '全部卡片', queue, idx: Math.max(0, queue.findIndex((q) => q.id === cardId)), viewAll: true });
  }
  function openStudy(d, s) {
    const cfg = studyCfg(d);
    U.study = Object.assign({ deckId: d.id, results: { 1: 0, 2: 0, 3: 0, 4: 0 }, start: Date.now(), dir: {}, done: false, cfg }, s);
    resetView();
    U.study.modal = openModal('', { raw: true, onKey: studyKeys, onClose: () => { U.study = null; render(); } });
    renderStudy();
  }
  function resetView() { U.study.view = { revealed: new Set(), ans: false, hint: false, hideHint: false, topic: false }; U.study.cardStart = Date.now(); }
  function curCard() { const s = U.study; const d = deckById(s.deckId); const q = s.queue[s.idx]; return q ? { d, q, card: itemById(d, q.id) } : { d }; }

  function renderStudy() {
    const s = U.study;
    if (!s) return;
    const { d, q, card } = curCard();
    const cfg = studyCfg(d);
    if (s.done || !card) { s.modal.mask.innerHTML = studyDoneHTML(d); return; }
    const v = s.view;
    const st = stOf(card.id);
    // 出题方向（只对问答卡）
    if (!(card.id in s.dir)) s.dir[card.id] = cfg.direction === 'random' ? (Math.random() < 0.5 ? 'front' : 'back') : cfg.direction;
    const flip = card.type === 'qa' && s.dir[card.id] === 'back';
    const qSrc = flip ? card.back : card.front, aSrc = flip ? card.front : card.back;

    let content = '';
    if (card.type === 'topic') {
      content = `<div class="topic-title">${esc(card.front)}</div>` + (v.topic ? `<div style="margin-top:24px;white-space:pre-wrap">${esc(card.back)}</div>` : '<div class="show-ans"><button class="btn" data-st="topic">显示内容（空格）</button></div>');
    } else if (card.type === 'qa') {
      content = `<div class="q-part md">${MD.render(qSrc)}</div>`;
      if (card.hint && !flip) {
        content += `<div class="hint-box">${v.hint && !v.hideHint ? `<div class="hint-shown md">${MD.render(card.hint)}</div>` : '<button class="hint-btn" data-st="hint">💡 点击显示提示（H）</button>'}</div>`;
      }
      content += v.ans ? `<hr class="ans-sep"><div class="md">${MD.render(aSrc)}</div>` : '<div class="show-ans"><button class="btn primary" data-st="ans">显示答案（空格）</button></div>';
    } else {
      content = `<div class="md">${MD.render(card.front)}</div>`;
    }
    const preview = s.queue[s.idx].rep && S.settings.requeueNoReschedule ? null : FSRS.previews(st || { state: 0 }, Date.now(), fsrsCfg(d), S.settings.easyButton ? 4 : 3);
    const canGrade = card.type === 'note' || (card.type === 'qa' && v.ans) || (card.type === 'topic' && v.topic);
    const g = (n, name) => `<button class="grade g${n}" data-st="grade" data-g="${n}" ${canGrade ? '' : 'disabled'} title="快捷键 ${n}"><b>${name}</b><small>${preview ? preview[n] : '本轮练习'}</small></button>`;
    let stateLine = '';
    if (st && st.state > 0) {
      const now = Date.now();
      const dueTxt = st.mastered ? '<b>已掌握</b>' : st.due <= dueCutoff(d) ? `<b>${st.due < now - FSRS.HOUR ? FSRS.relTime(now - st.due) + '前' : '现在'}</b>` : `<b>${FSRS.relTime(st.due - now)}后</b>`;
      stateLine = `<div class="study-state"><span class="${!st.mastered && st.due <= dueCutoff(d) ? 'due' : ''}">${dueTxt}${st.due <= dueCutoff(d) ? '需复习' : '下次复习'}</span><span><b>${st.reps} 次</b>已复习</span><span><b>${st.last ? fmtMD(st.last) : '—'}</b>上次复习</span></div>`;
    } else stateLine = '<div class="study-state"><span><b style="color:var(--accent)">新卡片</b>第一次学习</span></div>';

    const sizeCls = `size-${cfg.size || 'default'} fs-${cfg.fontSize || 'default'}`;
    s.modal.mask.innerHTML = `
      <button class="study-close" data-st="close" title="关闭（Esc）">×</button>
      <div class="study-wrap">
        <button class="study-arrow" data-st="prev" title="上一张（←）">‹</button>
        <div class="study col-${card.color || 'default'} ${sizeCls}" style="background-color:var(--panel)">
          <div class="study-head">
            <span style="width:100px"></span>
            <span class="title">${esc(s.label)}（${s.idx + 1}/${s.queue.length}）· ${TYPE_NAMES[card.type]}</span>
            <span style="width:100px;display:flex;justify-content:flex-end">
              <button class="icon-btn" data-st="speak" title="朗读（R）">🔈</button>
              <button class="icon-btn" data-st="edit" title="编辑（E）">✎</button>
              <button class="icon-btn" data-st="menu" title="更多">⋮</button>
            </span>
          </div>
          ${stateLine}
          <div class="study-content" data-st="blank">${content}</div>
          <div class="study-foot">
            <div class="study-sub">
              <span class="toggles">${card.type === 'qa' && v.ans ? `${card.hint && !flip ? `<button data-st="toggle-hint">${v.hint && !v.hideHint ? '隐藏提示' : '显示提示'}</button>` : ''}<button data-st="hide-ans">隐藏内容</button>` : ''}</span>
              <span class="cloze-counter hidden" data-st="next-cloze" title="点挖空可直接显示；这里或按 V 显示下一个，⇧V 全部显示 / 隐藏"></span>
            </div>
            <div class="grade-row">
              ${g(1, '忘记了')}${g(2, '模糊')}${g(3, '记住了')}${S.settings.easyButton ? g(4, '很简单') : ''}
              <button class="grade more" data-st="more" title="自定义复习时间 / 完成学习 / 彻底忘记">⋯</button>
            </div>
          </div>
        </div>
        <button class="study-arrow" data-st="next" title="下一张（→）">›</button>
      </div>`;
    const panel = $('.study', s.modal.mask);
    panel.style.background = '';
    panel.classList.add('col-' + (card.color || 'default'));
    // 挖空：逐个编号，按 revealed 状态隐藏
    $$('.study-content .cloze', panel).forEach((c, i) => {
      c.dataset.ci = i;
      c.classList.add(v.revealed.has(i) ? 'shown' : 'hidden-c');
    });
    updateClozeCounter();
    s.modal.mask.onclick = studyClick;
  }
  function updateClozeCounter() {
    const s = U.study;
    const all = $$('.study-content .cloze', s.modal.mask);
    const cnt = $('.cloze-counter', s.modal.mask);
    if (!cnt) return;
    if (!all.length) { cnt.classList.add('hidden'); return; }
    cnt.classList.remove('hidden');
    cnt.textContent = `挖空 ${all.filter((c) => c.classList.contains('shown')).length}/${all.length}　V`;
  }
  function revealNext() {
    const s = U.study;
    const all = $$('.study-content .cloze', s.modal.mask);
    const next = all.find((c) => c.classList.contains('hidden-c'));
    if (next) { s.view.revealed.add(+next.dataset.ci); next.classList.replace('hidden-c', 'shown'); next.scrollIntoView({ block: 'nearest' }); }
    updateClozeCounter();
  }
  function toggleAllCloze() {
    const s = U.study;
    const all = $$('.study-content .cloze', s.modal.mask);
    const anyHidden = all.some((c) => c.classList.contains('hidden-c'));
    all.forEach((c) => {
      const i = +c.dataset.ci;
      if (anyHidden) { s.view.revealed.add(i); c.classList.replace('hidden-c', 'shown'); }
      else { s.view.revealed.delete(i); c.classList.replace('shown', 'hidden-c'); }
    });
    updateClozeCounter();
  }
  function studyClick(e) {
    const s = U.study;
    if (e.target === s.modal.mask) return;
    const cz = e.target.closest('.study-content .cloze');
    if (cz) {
      const i = +cz.dataset.ci;
      if (cz.classList.contains('hidden-c')) { s.view.revealed.add(i); cz.classList.replace('hidden-c', 'shown'); }
      else { s.view.revealed.delete(i); cz.classList.replace('shown', 'hidden-c'); }
      updateClozeCounter();
      return;
    }
    const t = e.target.closest('[data-st]');
    if (!t) return;
    const a = t.dataset.st;
    const { d, card } = curCard();
    switch (a) {
      case 'close': closeModal(s.modal); break;
      case 'prev': go(-1); break;
      case 'next': go(1); break;
      case 'ans': s.view.ans = true; renderStudy(); break;
      case 'hide-ans': s.view.ans = false; renderStudy(); break;
      case 'hint': s.view.hint = true; s.view.hideHint = false; renderStudy(); break;
      case 'toggle-hint': if (s.view.hint && !s.view.hideHint) s.view.hideHint = true; else { s.view.hint = true; s.view.hideHint = false; } renderStudy(); break;
      case 'topic': s.view.topic = true; renderStudy(); break;
      case 'grade': if (!t.disabled) grade(+t.dataset.g); break;
      case 'next-cloze': revealNext(); break;
      case 'blank': if (studyCfg(d).clickBlank && !e.target.closest('a, button, pre')) revealNext(); break;
      case 'edit': openEditor({ deckId: d.id, cardId: card.id }); break;
      case 'speak': speak(card); break;
      case 'more': openMenu(t, customTimeMenu(d, card), { alignRight: true }); break;
      case 'menu': openMenu(t, studyMenu(d, card), { alignRight: true }); break;
      case 'again': startStudy(d, null); closeModal(s.modal); break;
      default: break;
    }
  }
  function go(step) {
    const s = U.study;
    const n = s.idx + step;
    if (n < 0 || n >= s.queue.length) return;
    s.idx = n; resetView(); renderStudy();
  }
  function grade(g) {
    const s = U.study;
    const { d, q, card } = curCard();
    const now = Date.now();
    const practice = q.rep && S.settings.requeueNoReschedule;
    if (!practice) {
      const st = stOf(card.id);
      const wasNew = !st || !st.state;
      const r = FSRS.schedule(st || { state: 0 }, g, now, fsrsCfg(d));
      S.states[card.id] = Object.assign(r.state, { mastered: false });
      S.logs.push({ at: now, rating: g, kind: 'grade', cardId: card.id, deckId: d.id, wasNew, ms: now - s.cardStart });
    } else S.logs.push({ at: now, rating: g, kind: 'grade', cardId: card.id, deckId: d.id, practice: true });
    s.results[g]++;
    if (g === 1 && !s.viewAll) {
      s.queue.splice(Math.min(s.queue.length, s.idx + 4), 0, { id: card.id, rep: true });
      toast('已加入本轮稍后再练一次');
    }
    d.studiedAt = now;
    save();
    advance();
  }
  function advance() {
    const s = U.study;
    if (s.idx + 1 >= s.queue.length) s.done = true; else { s.idx++; resetView(); }
    renderStudy();
  }
  function customTimeMenu(d, card) {
    const set = (ms, label) => {
      const st = stOf(card.id) || { state: 2, S: Math.max(0.5, ms / DAY), D: 5, reps: 0, lapses: 0 };
      st.state = st.state || 2; st.due = Date.now() + ms; st.mastered = false;
      S.states[card.id] = st;
      S.logs.push({ at: Date.now(), kind: 'manual', cardId: card.id, deckId: d.id });
      save(); toast('下次复习：' + label); advance();
    };
    const H = FSRS.HOUR, M = FSRS.MIN;
    const opts = [['15分钟', 15 * M], ['1小时', H], ['6小时', 6 * H], ['明天', null], ['3天', 3 * DAY], ['7天', 7 * DAY], ['14天', 14 * DAY], ['30天', 30 * DAY], ['3个月', 90 * DAY]];
    return [
      { header: '自定义下次复习时间' },
      ...opts.map(([l, ms]) => ({ label: l, onClick: () => set(ms ?? (todayStart() + DAY - Date.now()), l) })),
      { label: 'N 天后…', onClick: async () => { const v = await promptDialog('几天后复习？', '10', '天数'); const n = parseFloat(v); if (n > 0) set(n * DAY, n + '天'); } },
      { label: '选择日期…', onClick: async () => { const v = await promptDialog('选择复习日期', new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10), 'YYYY-MM-DD'); const t = v && Date.parse(v + 'T04:00'); if (t) set(t - Date.now(), v); } },
      '-',
      { label: '完成学习（已掌握，不再出现）', icon: '✓', onClick: () => { S.states[card.id] = Object.assign(stOf(card.id) || { state: 2, S: 30, D: 5, reps: 0, lapses: 0, due: Date.now() }, { mastered: true }); save(); toast('已标记为掌握'); advance(); } },
      { label: '彻底忘记（重置为新卡）', icon: '⟲', danger: true, onClick: () => { delete S.states[card.id]; save(); toast('已重置为新卡'); advance(); } },
    ];
  }
  function studyMenu(d, card) {
    const cfg = studyCfg(d);
    const setCfg = (k, v) => { d.study = Object.assign({}, d.study, { [k]: v }); save(); renderStudy(); };
    return [
      { label: '学习设置', icon: '⚙', onClick: () => studySettingsDialog(d) },
      { label: '朗读偏好', icon: '🔈', tag: 'P1', disabled: true },
      '-',
      { label: '卡片颜色', icon: '●', sub: () => [{ el: swatchesEl(card.color, (k) => { card.color = k; touch(d); save(); renderStudy(); }) }] },
      { label: '卡片文字大小', icon: 'A', sub: () => [['small', '小'], ['default', '默认'], ['large', '大'], ['xlarge', '特大']].map(([k, l]) => ({ label: l, checked: (cfg.fontSize || 'default') === k, onClick: () => setCfg('fontSize', k) })) },
      { label: '卡片大小', icon: '▭', sub: () => [['default', '默认'], ['large', '放大'], ['wide', '宽屏'], ['full', '全屏']].map(([k, l]) => ({ label: l, checked: (cfg.size || 'default') === k, onClick: () => setCfg('size', k) })) },
      '-',
      { label: '创建副本', icon: '⧉', onClick: () => { const c = JSON.parse(JSON.stringify(card)); c.id = 'c' + uid(); insertAfter(d, [c], card.id); save(); toast('已创建副本'); } },
      { label: '移动到其他目录 / 卡片集', icon: '⇄', tag: 'P1', disabled: true },
      { label: '删除卡片', icon: '🗑', danger: true, onClick: async () => { if (await confirmDialog('删除卡片', '删除后可以在卡片集页撤销。', '删除', true)) { d.items = d.items.filter((x) => x !== card); save(); U.study.queue.splice(U.study.idx, 1); U.study.idx--; advance(); } } },
    ];
  }
  function speak(card) {
    if (!('speechSynthesis' in window)) { toast('浏览器不支持朗读'); return; }
    speechSynthesis.cancel();
    const v = U.study.view;
    const text = MD.plain(card.type === 'qa' && !v.ans ? card.front : [card.front, card.back].join('。'));
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }
  function studyDoneHTML(d) {
    const s = U.study;
    const r = s.results;
    const n = r[1] + r[2] + r[3] + r[4];
    const mins = Math.max(1, Math.round((Date.now() - s.start) / 60000));
    const more = buildQueue(d, 'recommend', studyCfg(d)).length;
    return `<div class="study" style="background:var(--panel)">
      <div class="study-done">
        <div class="big">🎉</div><h2>学习完成</h2>
        <div class="sum">${s.viewAll ? '已浏览到最后一张' : '本次学习已完成，当前待学卡片已清空'}</div>
        <div class="bars"><span>共 <b>${n}</b> 次评分</span><span>用时 <b>${mins}</b> 分钟</span></div>
        <div class="bars"><span style="color:var(--red)">忘记了 ${r[1]}</span><span style="color:var(--orange)">模糊 ${r[2]}</span><span style="color:var(--green)">记住了 ${r[3]}</span></div>
        <div style="display:flex;gap:10px">${more && !s.viewAll ? `<button class="btn" data-st="again">再学一组（${more}）</button>` : ''}<button class="btn primary" data-st="close">完成</button></div>
      </div></div>`;
  }
  function studyKeys(e) {
    const s = U.study;
    if (U.modals[U.modals.length - 1] !== s.modal) return;
    if (e.key === 'Escape') { closeModal(s.modal); return; }
    if (s.done) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeModal(s.modal); } return; }
    const { card } = curCard();
    const v = s.view;
    const k = e.key;
    if (mod(e) || e.altKey) return;
    if (k === '1' || k === '2' || k === '3' || (k === '4' && S.settings.easyButton)) {
      const b = $(`.grade[data-g="${k}"]`, s.modal.mask);
      if (b && !b.disabled) grade(+k);
      else if (b) toast(card.type === 'qa' ? '先按空格显示答案' : '先显示内容');
    } else if (k === ' ') {
      e.preventDefault();
      if (card.type === 'qa') { v.ans = !v.ans; renderStudy(); }
      else if (card.type === 'topic') { v.topic = !v.topic; renderStudy(); }
      else revealNext();
    } else if (k === 'v' || k === 'V') { e.shiftKey ? toggleAllCloze() : revealNext(); }
    else if (k === 'h' || k === 'H') { if (card.hint) { v.hint = true; v.hideHint = false; renderStudy(); } }
    else if (k === 'ArrowLeft') go(-1);
    else if (k === 'ArrowRight') go(1);
    else if (k === 'e' || k === 'E') openEditor({ deckId: s.deckId, cardId: card.id });
    else if (k === 'r' || k === 'R') speak(card);
  }

  // ================================================================ 学习设置
  function studySettingsDialog(d) {
    const cfg = JSON.parse(JSON.stringify(studyCfg(d)));
    const plan = Object.assign({}, (d.study && d.study.plan) || {});
    const secs = d.items.filter((x) => x.kind === 'section');
    const m = openModal('', { light: true, cls: '' });
    m.el.style.width = '520px';
    const draw = () => {
      const seg = (key, opts) => `<div class="seg">${opts.map(([k, l]) => `<button class="${cfg[key] === k ? 'on' : ''}" data-k="${key}" data-v="${k}">${l}</button>`).join('')}</div>`;
      const p = Object.assign(planOf(d), plan);
      m.el.innerHTML = dialogHTML('开始学习 · 学习设置', `
        <div class="form-row"><label>学习内容</label>${seg('content', [['recommend', '系统推荐'], ['new', '仅未学习'], ['review', '仅复习'], ['all', '全部卡片']])}
          <div class="hint-text">${{ recommend: '先复习到期卡片，再学新卡，受每日上限约束', new: '只学没学过的卡片', review: '只复习到期的卡片', all: '按顺序浏览全部卡片，也可以评分' }[cfg.content]}</div></div>
        <div class="form-row"><label>卡片颜色（不选 = 全部颜色）</label><div class="opt-list">${COLORS.map(([k, n, hex]) => `<span class="opt ${cfg.colors.includes(k) ? 'on' : ''}" data-color="${k}"><span class="swatch" style="background:${hex}"></span> ${n}</span>`).join('')}</div></div>
        <div class="form-row"><label>学习目录（不选 = 全部目录）</label><div class="opt-list">${secs.length ? secs.map((s) => `<span class="opt ${cfg.sections.includes(s.id) ? 'on' : ''}" data-sec="${s.id}">${'　'.repeat(s.level - 1)}${esc(s.title)}</span>`).join('') : '<span class="hint-text">这个卡片集还没有目录</span>'}</div></div>
        <div class="form-row"><label>卡片顺序</label>${seg('order', [['sequential', '按顺序'], ['due_first', '到期优先'], ['random', '随机']])}</div>
        <div class="form-row"><label>出题方向（问答卡）</label>${seg('direction', [['front', '问题优先'], ['back', '答案优先'], ['random', '随机']])}</div>
        <div class="form-row row-between"><span>点击卡片空白处，显示下一个挖空</span><button class="switch ${cfg.clickBlank ? 'on' : ''}" data-sw="clickBlank"></button></div>
        <div class="form-row" style="border-top:1px solid var(--line);padding-top:12px">
          <div class="row-between" style="cursor:pointer" data-plan="toggle"><span><b style="font-weight:500">复习计划与每日上限</b><br><span class="hint-text">${{ daily: '按天模式', flexible: '灵活模式', sprint: '冲刺模式' }[p.mode]} · 每日新学 ${p.newPerDay} · 每日复习 ${p.reviewPerDay}</span></span><span>${m.planOpen ? '▾' : '›'}</span></div>
          ${m.planOpen ? planEditorHTML(p) : ''}
        </div>`,
      '<button class="btn" data-x="save">仅保存</button><button class="btn primary" data-x="start">开始学习</button>');
    };
    m.planOpen = false;
    draw();
    m.el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-k],[data-color],[data-sec],[data-sw],[data-x],[data-plan],[data-mode]');
      if (!t) return;
      if (t.dataset.k) cfg[t.dataset.k] = t.dataset.v;
      else if (t.dataset.color) { const k = t.dataset.color; cfg.colors = cfg.colors.includes(k) ? cfg.colors.filter((x) => x !== k) : [...cfg.colors, k]; }
      else if (t.dataset.sec) { const k = t.dataset.sec; cfg.sections = cfg.sections.includes(k) ? cfg.sections.filter((x) => x !== k) : [...cfg.sections, k]; }
      else if (t.dataset.sw) cfg[t.dataset.sw] = !cfg[t.dataset.sw];
      else if (t.dataset.plan) m.planOpen = !m.planOpen;
      else if (t.dataset.mode) plan.mode = t.dataset.mode;
      else if (t.dataset.x) {
        d.study = Object.assign({}, d.study, cfg, { plan });
        save();
        closeModal(m);
        if (t.dataset.x === 'start') { if (U.study) closeModal(U.study.modal); startStudy(d, null); } else { render(); if (U.study) renderStudy(); }
        return;
      }
      draw();
    });
    m.el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.pl) { plan[t.dataset.pl] = t.type === 'number' ? Math.max(0, parseInt(t.value, 10) || 0) : t.value; draw(); }
    });
  }
  function planEditorHTML(p) {
    const card = (k, t, desc) => `<div class="mode-card ${p.mode === k ? 'on' : ''}" data-mode="${k}"><b>${t}</b><span>${desc}</span></div>`;
    return `<div style="margin-top:10px">
      ${card('daily', '按天模式（默认）', '不安排当天的短间隔。新卡评分后最早明天再见，到期卡片按“学习日”（04:00 换日）一次出完')}
      ${card('flexible', '灵活模式', `开启当天短间隔：新卡评“忘记了 / 模糊”、复习卡评“忘记了”时，${S.settings.steps} 分钟后再出现；评“记住了”直接按天安排`)}
      ${card('sprint', '冲刺模式', '设置考试日期，每次间隔不超过“距考试天数 / 3”，保证考前多看几遍；考后自动回到按天模式')}
      ${p.mode === 'sprint' ? `<div class="form-row"><label>考试日期</label><input type="date" class="text-input" style="width:180px" data-pl="examDate" value="${p.examDate || ''}"></div>` : ''}
      <div class="form-row" style="display:flex;gap:24px">
        <span>每日新学 <input type="number" class="num-input" data-pl="newPerDay" value="${p.newPerDay}"> 张</span>
        <span>每日复习 <input type="number" class="num-input" data-pl="reviewPerDay" value="${p.reviewPerDay}"> 张</span>
      </div>
      <div class="hint-text">间隔由 FSRS 计算（目标记忆保持率 ${S.settings.retention}，可在系统设置里改）</div>
    </div>`;
  }

  // ================================================================ 其他弹窗
  function coverDialog(d) {
    const m = openModal(dialogHTML('设置卡片集封面', `
      <button class="btn" data-x="upload" style="width:100%;justify-content:center">上传封面图片</button>
      <div class="form-row"><input class="text-input" id="cv-url" placeholder="或输入图片 URL" value="${esc(d.cover && !d.cover.startsWith('data:') ? d.cover : '')}"></div>
      <div class="hint-text">图片显示比例 3:2</div>`,
    `${d.cover ? '<button class="btn danger" data-x="remove">移除封面</button>' : ''}<span style="flex:1"></span><button class="btn" data-x="no">取消</button><button class="btn primary" data-x="ok">确定</button>`), { light: true });
    m.el.addEventListener('click', (e) => {
      const x = e.target.closest('[data-x]');
      if (!x) return;
      const k = x.dataset.x;
      if (k === 'upload') {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = () => readImage(inp.files[0]).then((url) => { d.cover = url; save(); closeModal(m); render(); });
        inp.click(); return;
      }
      if (k === 'remove') d.cover = null;
      if (k === 'ok') d.cover = $('#cv-url', m.el).value.trim() || d.cover;
      save(); closeModal(m); render();
    });
  }
  function importDialog(d) {
    const m = openModal('', { light: true });
    m.el.style.width = '620px';
    let firstSec = false, text = '';
    const parse = () => text.split('\n').filter((l) => l.trim()).map((l) => {
      const cols = l.split('\t');
      const sec = firstSec ? cols.shift() : null;
      return { sec: sec && sec.trim(), front: (cols[0] || '').trim(), back: cols.slice(1).join('\t').trim() };
    }).filter((r) => r.front);
    const draw = () => {
      const rows = parse();
      m.el.innerHTML = dialogHTML('导入卡片', `
        <div class="seg" style="margin-bottom:12px"><button class="on">文本 / 表格</button><button data-x="p1md">Markdown 文件 <span class="tag-p">P1</span></button><button data-x="p1anki">Anki 牌组 <span class="tag-p">P1</span></button></div>
        <div class="hint-text" style="margin-bottom:6px">每行一张卡片；用 Tab 分隔正面和背面（有背面 → 问答卡，没有 → 笔记卡）。可以直接从 Excel 复制粘贴。正文里的 <code>{{挖空}}</code> 和 Markdown 会保留。</div>
        <textarea class="text-input" id="imp-text" rows="8" placeholder="TCP 第二次握手发送什么？&#9;SYN+ACK&#10;进程是 {{资源分配}} 的基本单位">${esc(text)}</textarea>
        <div class="form-row row-between"><span>第一列是目录（相同目录名的卡片会归到同一个目录下）</span><button class="switch ${firstSec ? 'on' : ''}" data-x="sec"></button></div>
        <div class="hint-text">识别到 <b>${rows.length}</b> 张卡片${rows.length ? '，预览前 5 张：' : ''}</div>
        ${rows.slice(0, 5).map((r) => `<div style="font-size:12px;border-bottom:1px solid var(--line);padding:4px 0">${r.sec ? `<span class="tag-p">${esc(r.sec)}</span> ` : ''}${esc(r.front)}${r.back ? ` <span style="color:var(--text-3)">⇥ ${esc(r.back)}</span>` : ''}</div>`).join('')}`,
      `<button class="btn" data-x="no">取消</button><button class="btn primary" data-x="ok" ${rows.length ? '' : 'disabled'}>导入到末尾</button>`);
      const ta = $('#imp-text', m.el);
      ta.addEventListener('input', () => { text = ta.value; const pos = ta.selectionStart; draw(); const n = $('#imp-text', m.el); n.focus(); n.setSelectionRange(pos, pos); });
    };
    draw();
    m.el.addEventListener('click', (e) => {
      const x = e.target.closest('[data-x]');
      if (!x) return;
      const k = x.dataset.x;
      if (k === 'sec') { firstSec = !firstSec; draw(); }
      else if (k === 'p1md' || k === 'p1anki') toast('放在 P1');
      else if (k === 'no' || x.classList.contains('icon-btn')) closeModal(m);
      else if (k === 'ok') {
        const rows = parse();
        let lastSec = null;
        rows.forEach((r) => {
          if (r.sec && r.sec !== lastSec) {
            let s = d.items.find((x) => x.kind === 'section' && x.title === r.sec);
            if (!s) { s = { id: 's' + uid(), kind: 'section', level: 1, title: r.sec }; d.items.push(s); }
            lastSec = r.sec;
          }
          const c = { id: 'c' + uid(), kind: 'card', type: r.back ? 'qa' : 'note', color: 'default', front: r.front, hint: '', back: r.back, createdAt: Date.now(), updatedAt: Date.now() };
          if (r.sec) { const end = sectionBlock(d, d.items.find((x) => x.kind === 'section' && x.title === r.sec).id)[1]; d.items.splice(end, 0, c); } else d.items.push(c);
          logEdit(c.id, 'create');
        });
        touch(d); save(); closeModal(m); render();
        toast(`已导入 ${rows.length} 张卡片`);
      }
    });
  }
  function exportDialog(d) {
    let keep = true;
    const m = openModal('', { light: true });
    m.el.style.width = '620px';
    const build = () => {
      const out = [`# ${d.title}`, ''];
      d.items.forEach((it) => {
        if (it.kind === 'section') { out.push('#'.repeat(Math.min(6, it.level + 1)) + ' ' + it.title, ''); return; }
        const fix = (s) => (keep ? s : (s || '').replace(/\{\{([^\n]*?)\}\}/g, '$1'));
        if (it.type === 'qa') out.push('**Q:** ' + fix(it.front), '', it.hint ? '> 提示：' + it.hint + '\n' : '', '**A:** ' + fix(it.back), '', '---', '');
        else out.push(fix(it.front), '', '---', '');
      });
      return out.join('\n');
    };
    const draw = () => {
      m.el.innerHTML = dialogHTML('导出', `
        <div class="form-row"><label>格式</label><div class="seg"><button class="on">Markdown</button><button data-x="p1">HTML / PDF <span class="tag-p">P1</span></button><button data-x="p1">CSV <span class="tag-p">P1</span></button><button data-x="p1">JSON <span class="tag-p">P1</span></button></div></div>
        <div class="form-row"><label>挖空</label><div class="seg"><button class="${keep ? 'on' : ''}" data-x="keep">保留挖空</button><button class="${keep ? '' : 'on'}" data-x="ans">显示答案</button></div></div>
        <textarea class="text-input" rows="12" readonly id="exp-out">${esc(build())}</textarea>`,
      '<button class="btn" data-x="no">关闭</button><button class="btn primary" data-x="copy">复制</button>');
    };
    draw();
    m.el.addEventListener('click', (e) => {
      const x = e.target.closest('[data-x]');
      if (!x) { if (e.target.closest('.icon-btn')) closeModal(m); return; }
      const k = x.dataset.x;
      if (k === 'keep') { keep = true; draw(); } else if (k === 'ans') { keep = false; draw(); } else if (k === 'p1') toast('放在 P1');
      else if (k === 'copy') { navigator.clipboard.writeText(build()).then(() => toast('已复制'), () => toast('复制失败，请手动选择')); }
      else closeModal(m);
    });
  }
  function mindmapDialog(d) {
    // 非 AI 版：按目录层级 + 卡片首行生成
    const root = { label: d.title, children: [] };
    const stack = [{ level: 0, node: root }];
    d.items.forEach((it) => {
      if (it.kind === 'section') {
        while (stack[stack.length - 1].level >= it.level) stack.pop();
        const n = { label: it.title, children: [] };
        stack[stack.length - 1].node.children.push(n);
        stack.push({ level: it.level, node: n });
      } else {
        const first = MD.plain((it.type === 'topic' ? it.front : it.front).split('\n')[0]).slice(0, 26);
        stack[stack.length - 1].node.children.push({ label: first || '（图片）', children: [], leaf: true });
      }
    });
    const nodeHTML = (n, isRoot) => `<div class="mm-node ${isRoot ? 'mm-root' : ''}"><div class="mm-label" ${n.leaf ? 'style="background:var(--panel)"' : ''}>${esc(n.label)}</div>${n.children.length ? `<div class="mm-children">${n.children.map((c) => nodeHTML(c)).join('')}</div>` : ''}</div>`;
    const m = openModal(dialogHTML('导图', `<div class="hint-text" style="margin-bottom:8px">按目录结构直接生成（不用 AI），卡片取第一行。P1 再做缩放、折叠和导出图片。</div><div class="mindmap" style="overflow:auto">${nodeHTML(root, true)}</div>`), { light: true });
    m.el.style.width = 'min(1000px, calc(100vw - 60px))';
  }
  function shortcutsDialog() {
    const t = (rows) => `<table class="kbd-table">${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b.split(' ').map((k) => `<kbd>${k}</kbd>`).join(' ')}</td></tr>`).join('')}</table>`;
    openModal(dialogHTML('快捷键与操作', `
      <h4 style="margin:6px 0">卡片管理</h4>${t([['新建卡片 / 新建目录', 'C D'], ['在选中项后面添加卡片 / 目录', '⌥C ⌥D'], ['编辑', 'E'], ['打开（全部卡片模式）', 'Enter'], ['删除（可撤销）', '⌫'], ['移动选择 / 扩展选择', '↑↓←→ ⇧+方向键'], ['全选 / 多选', '⌘A ⌘+点击'], ['搜索', '⌘F'], ['拖动排序；⌥+拖动只移动目录标题', '拖动']])}
      <h4 style="margin:14px 0 6px">学习</h4>${t([['忘记了 / 模糊 / 记住了', '1 2 3'], ['显示 / 隐藏答案', '空格'], ['显示下一个挖空 / 全部', 'V ⇧V'], ['显示提示', 'H'], ['上一张 / 下一张', '← →'], ['编辑 / 朗读 / 关闭', 'E R Esc']])}
      <h4 style="margin:14px 0 6px">编辑器</h4>${t([['挖空', '⌘E'], ['加粗 / 斜体 / 下划线', '⌘B ⌘I ⌘U'], ['列表缩进', 'Tab ⇧Tab'], ['切换正面 / 背面', '⌥↩'], ['完成（连续新建）', '⌘↩'], ['保存并关闭', 'Esc']])}`), { light: true });
  }

  // ================================================================ 统计
  function dayKey(t) { const d = new Date(FSRS.dayStart(t, S.settings.dayHour)); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
  function statsData() {
    const byDay = {};
    S.logs.filter((l) => l.kind === 'grade').forEach((l) => { const k = dayKey(l.at); byDay[k] = (byDay[k] || 0) + 1; });
    const editByDay = {};
    S.edits.forEach((l) => { const k = dayKey(l.at); editByDay[k] = (editByDay[k] || 0) + 1; });
    const t0 = todayStart();
    let streak = 0;
    let t = byDay[dayKey(t0)] ? t0 : t0 - DAY;
    while (byDay[dayKey(t)]) { streak++; t -= DAY; }
    let best = 0, cur = 0, bestEnd = null;
    for (let i = 400; i >= 0; i--) {
      const k = dayKey(t0 - i * DAY);
      if (byDay[k]) { cur++; if (cur > best) { best = cur; bestEnd = t0 - i * DAY; } } else cur = 0;
    }
    return { byDay, editByDay, streak, best, bestEnd, t0 };
  }
  function statsHTML() {
    const sd = statsData();
    const now = new Date();
    const y = now.getFullYear(), mo = now.getMonth();
    const first = new Date(y, mo, 1), days = new Date(y, mo + 1, 0).getDate();
    const pad = (first.getDay() + 6) % 7;
    let cal = '一二三四五六日'.split('').map((w) => `<div class="wd">${w}</div>`).join('') + '<div></div>'.repeat(pad);
    let monthDays = 0;
    for (let i = 1; i <= days; i++) {
      const n = sd.byDay[`${y}-${mo + 1}-${i}`] || 0;
      if (n) monthDays++;
      cal += `<div class="d ${n ? (n > 30 ? 'l3' : n > 12 ? 'l2' : 'l1') : ''} ${i === now.getDate() ? 'today' : ''}" title="${n} 次">${i}</div>`;
    }
    const todayLogs = S.logs.filter((l) => l.kind === 'grade' && l.at >= sd.t0);
    const todayCards = new Set(todayLogs.map((l) => l.cardId || l.at)).size;
    const allCards = S.decks.filter((d) => !d.deletedAt).reduce((a, d) => a + cardsOf(d).length, 0);
    const pct = Math.min(1, sd.streak / 30);
    const bestStart = sd.bestEnd ? sd.bestEnd - (sd.best - 1) * DAY : null;
    return `<div class="page">
      <div class="page-head"><h1 class="page-title">我的统计</h1></div>
      <div class="stat-grid">
        <div class="panel">
          <h3>学习日历</h3>
          <div class="streak">
            <svg class="ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" stroke-width="9"/><circle cx="50" cy="50" r="42" fill="none" stroke="var(--accent)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(264 * pct).toFixed(1)} 264" transform="rotate(-90 50 50)"/><text x="50" y="49" text-anchor="middle" font-size="22" font-weight="700" fill="var(--text)">${sd.streak}</text><text x="50" y="67" text-anchor="middle" font-size="11" fill="var(--text-2)">天连续</text></svg>
            <div style="font-size:13px;line-height:2">
              <div>最长连续学习 <b>${sd.best}</b> 天 <span class="hint-text">${bestStart ? fmtDate(bestStart) + ' – ' + fmtDate(sd.bestEnd) : ''}</span></div>
              <div>本月已学习 <b>${monthDays}</b> 天</div>
            </div>
          </div>
          <div style="margin-top:12px;font-weight:500">${y}年${mo + 1}月</div>
          <div class="cal">${cal}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="panel">
            <h3>数据</h3>
            <div class="kpis">
              <div class="kpi"><b>${todayCards}</b><span>今日学习卡片</span></div>
              <div class="kpi"><b>${S.logs.filter((l) => l.kind === 'grade').length}</b><span>累计学习次数</span></div>
              <div class="kpi"><b>${liveDecks().length}</b><span>我的卡片集</span></div>
              <div class="kpi"><b>${allCards}</b><span>我的卡片总数</span></div>
            </div>
          </div>
          <div class="panel">
            <div class="row-between" style="margin-bottom:8px"><h3 style="margin:0">学习与编辑曲线</h3>
              <div class="seg" id="range-seg">${[7, 30, 90].map((n) => `<button class="${(U.statRange || 7) === n ? 'on' : ''}" data-range="${n}">${n}天</button>`).join('')}</div></div>
            <div class="legend"><span><i style="background:var(--accent)"></i>学习（评分次数）</span><span><i style="background:var(--orange)"></i>编辑（新建 / 修改卡片）</span></div>
            <div id="line-chart"></div>
          </div>
          <div class="panel">
            <h3>未来 30 天到期 <span class="tag-p">P1</span></h3>
            <div id="forecast"></div>
          </div>
        </div>
      </div>
      <p class="hint-text" style="margin-top:16px">学习排行榜、收藏数已砍掉。P1 再加“真实记忆保持率”（按评分统计，和目标保持率对比）。</p>
    </div>`;
  }
  function bindStats() {
    const sd = statsData();
    const n = U.statRange || 7;
    const days = [];
    for (let i = n - 1; i >= 0; i--) days.push(sd.t0 - i * DAY);
    const a = days.map((t) => sd.byDay[dayKey(t)] || 0);
    const b = days.map((t) => sd.editByDay[dayKey(t)] || 0);
    $('#line-chart').innerHTML = lineChart(days, [a, b], ['var(--accent)', 'var(--orange)']);
    const fc = [];
    for (let i = 0; i < 30; i++) {
      const s0 = sd.t0 + i * DAY, s1 = s0 + DAY;
      fc.push(Object.values(S.states).filter((s) => !s.mastered && s.state > 0 && (i === 0 ? s.due < s1 : s.due >= s0 && s.due < s1)).length);
    }
    $('#forecast').innerHTML = barChart(fc);
    $('#range-seg').onclick = (e) => { const t = e.target.closest('[data-range]'); if (t) { U.statRange = +t.dataset.range; render(); } };
  }
  function lineChart(days, series, colors) {
    const W = 520, H = 170, L = 30, B = 22, T = 8;
    const max = Math.max(5, ...series.flat());
    const x = (i) => L + (i * (W - L - 8)) / Math.max(1, days.length - 1);
    const y = (v) => T + (H - T - B) * (1 - v / max);
    let g = '';
    for (let k = 0; k <= 4; k++) { const v = Math.round((max * k) / 4); g += `<line x1="${L}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--text-3)">${v}</text>`; }
    const every = Math.ceil(days.length / 7);
    days.forEach((t, i) => { if (i % every === 0 || i === days.length - 1) { const dd = new Date(t); g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--text-3)">${dd.getMonth() + 1}/${dd.getDate()}</text>`; } });
    series.forEach((s, si) => {
      g += `<polyline fill="none" stroke="${colors[si]}" stroke-width="2" stroke-linejoin="round" points="${s.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`;
      if (days.length <= 31) s.forEach((v, i) => { g += `<circle cx="${x(i)}" cy="${y(v)}" r="2.5" fill="${colors[si]}"><title>${v}</title></circle>`; });
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg>`;
  }
  function barChart(vals) {
    const W = 520, H = 120, B = 18, max = Math.max(3, ...vals), bw = (W - 10) / vals.length;
    let g = '';
    vals.forEach((v, i) => {
      const h = ((H - B - 6) * v) / max;
      g += `<rect x="${5 + i * bw + 2}" y="${H - B - h}" width="${bw - 4}" height="${h}" rx="2" fill="${i === 0 ? 'var(--orange)' : 'var(--accent)'}" opacity="${i === 0 ? 1 : 0.7}"><title>${i === 0 ? '今天' : i + '天后'}：${v} 张</title></rect>`;
      if (i % 5 === 0) g += `<text x="${5 + i * bw + bw / 2}" y="${H - 4}" text-anchor="middle" font-size="10" fill="var(--text-3)">${i === 0 ? '今天' : '+' + i}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg>`;
  }

  // ================================================================ 设置
  function chainPreview() {
    const cfg = { mode: 'daily', retention: S.settings.retention, maxIvl: S.settings.maxIvl, dayHour: S.settings.dayHour, steps: S.settings.steps };
    let st = { state: 0 }, t = Date.now();
    const out = [];
    for (let i = 0; i < 6; i++) {
      const r = FSRS.schedule(st, 3, t, cfg);
      out.push(r.label);
      st = r.state; t = r.due;
    }
    return out.join(' → ');
  }
  function settingsHTML() {
    const st = S.settings;
    const seg = (key, opts) => `<div class="seg">${opts.map(([k, l]) => `<button class="${String(st[key]) === String(k) ? 'on' : ''}" data-set="${key}" data-v="${k}">${l}</button>`).join('')}</div>`;
    const sw = (key) => `<button class="switch ${st[key] ? 'on' : ''}" data-set-sw="${key}"></button>`;
    const row = (title, desc, ctrl) => `<div class="set-row"><div class="l"><b>${title}</b>${desc ? `<span>${desc}</span>` : ''}</div>${ctrl}</div>`;
    return `<div class="page settings-wrap">
      <div class="page-head"><h1 class="page-title">系统设置</h1></div>
      <div class="set-group"><h3>学习偏好</h3>
        ${row('默认复习模式', '新卡片集默认使用；每个卡片集可以在学习设置里单独改', seg('defaultMode', [['daily', '按天'], ['flexible', '灵活']]))}
        ${row('每日新学上限', '', `<input type="number" class="num-input" data-set-num="newPerDay" value="${st.newPerDay}">`)}
        ${row('每日复习上限', '', `<input type="number" class="num-input" data-set-num="reviewPerDay" value="${st.reviewPerDay}">`)}
        ${row('点击卡片空白处，显示下一个挖空', '', sw('clickBlankRevealNext'))}
        ${row('卡片文字大小', '学习时卡片的默认字号', seg('fontSize', [['small', '小'], ['default', '默认'], ['large', '大'], ['xlarge', '特大']]))}
      </div>
      <div class="set-group"><h3>记忆算法（FSRS）</h3>
        ${row(`目标记忆保持率　<span style="color:var(--accent)">${Math.round(st.retention * 100)}%</span>`, '复习时预计能想起来的概率。越高复习越频繁；0.90 是 Anki 推荐值', `<input type="range" min="0.80" max="0.97" step="0.01" value="${st.retention}" data-set-range="retention" style="width:180px">`)}
        <div class="set-row" style="border-top:0;padding-top:0"><span class="hint-text">新卡一直点“记住了”时的间隔：<b style="color:var(--text)">${chainPreview()}</b></span></div>
        ${row('最大间隔', '天', `<input type="number" class="num-input" data-set-num="maxIvl" value="${st.maxIvl}">`)}
        ${row('灵活模式的短间隔', '只在灵活模式下生效', seg('steps', [[1, '1分钟'], [5, '5分钟'], [10, '10分钟'], [30, '30分钟']]))}
        ${row('新的一天开始于', '凌晨学到很晚也算前一天', seg('dayHour', [[0, '0:00'], [2, '2:00'], [4, '4:00'], [6, '6:00']]))}
        ${row('间隔随机抖动', '避免同一天到期的卡片扎堆', sw('fuzz'))}
        ${row('显示第 4 个评分键“很简单”', '对应 FSRS 的 Easy，间隔更长', sw('easyButton'))}
        ${row('“本轮再练”不改变记忆状态', '忘记后本轮再出现时，评分只算练习，不重复惩罚', sw('requeueNoReschedule'))}
        ${row('用自己的复习记录优化参数', '复习记录足够多（约 1000 次）以后可用', '<span class="tag-p">P2</span>')}
      </div>
      <div class="set-group"><h3>朗读偏好 <span class="tag-p">P1</span></h3>
        ${row('朗读方式', '只做系统朗读；AI 自然朗读砍掉', '<span class="hint-text">系统朗读</span>')}
        ${row('朗读范围 / 语言筛选 / 语速 / 模式', '和原版一致：当前可见或整张卡；全部语言或只读外语；0.8–1.2；单次、连续、单卡循环', '<span class="hint-text">P1</span>')}
      </div>
      <div class="set-group"><h3>通用</h3>
        ${row('连续新建卡片', '点“完成”后保存并继续新建下一张', sw('continuousNew'))}
        ${row('外观', '', seg('theme', [['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']]))}
      </div>
      <div class="set-group"><h3>数据</h3>
        ${row('数据目录', '数据库和图片都存在这里', `<code style="font-size:12px">${esc(st.dataDir)}</code>`)}
        ${row('自动备份', '每天第一次启动时备份，保留最近 14 份', '<button class="btn sm" data-act="p2" title="立即备份（原型里不可用）">立即备份</button>')}
        ${row('从备份恢复', '', '<button class="btn sm" data-act="p2" title="从备份恢复（原型里不可用）">选择备份…</button>')}
      </div>
    </div>`;
  }
  document.addEventListener('click', (e) => {
    if (U.route.name !== 'settings') return;
    const t = e.target.closest('[data-set],[data-set-sw]');
    if (!t) return;
    if (t.dataset.set) { const k = t.dataset.set; const v = t.dataset.v; S.settings[k] = /^\d+$/.test(v) ? +v : v; }
    else { const k = t.dataset.setSw; S.settings[k] = !S.settings[k]; }
    save(); const sc = $('#main').scrollTop; render(); $('#main').scrollTop = sc;
  });
  document.addEventListener('change', (e) => {
    if (U.route.name !== 'settings') return;
    const t = e.target;
    if (t.dataset.setNum) { S.settings[t.dataset.setNum] = Math.max(1, parseInt(t.value, 10) || 1); save(); }
    if (t.dataset.setRange) { S.settings[t.dataset.setRange] = +t.value; save(); const sc = $('#main').scrollTop; render(); $('#main').scrollTop = sc; }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  // ================================================================ 原型底部条
  function protoBar() {
    const bar = document.createElement('div');
    bar.className = 'proto-bar';
    bar.innerHTML = '<span>bnki 原型 · 数据只存在这个浏览器里</span><button data-pb="keys">快捷键</button><button data-pb="reset">重置示例数据</button><button data-pb="hide">隐藏</button>';
    bar.addEventListener('click', async (e) => {
      const k = e.target.dataset.pb;
      if (k === 'keys') shortcutsDialog();
      if (k === 'hide') bar.remove();
      if (k === 'reset' && await confirmDialog('重置示例数据', '会清除你在原型里做的所有修改。', '重置', true)) {
        S = fresh(); save(); U.sel.clear(); location.hash = '#/'; render();
      }
    });
    document.body.appendChild(bar);
  }

  document.execCommand('defaultParagraphSeparator', false, 'p');
  protoBar();
  route();
})();
