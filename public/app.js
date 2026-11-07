const app = {
  catalog: null,
  state: null,
  view: 'browse',
  selectedCaseId: null,
  filters: {
    query: '',
    occasion: 'all',
    feeling: 'all',
    type: 'all',
    preference: 'all'
  },
  styleGroup: 'all',
  compareIds: [],
  saveTimer: null
};

const typeLabels = {
  'Architecture & Spaces': '空间与建筑',
  'Brand & Logos': '品牌与标志',
  'Characters & People': '人物',
  'Charts & Infographics': '图表与信息图',
  'Documents & Publishing': '文档与出版',
  'History & Classical Themes': '历史与古典',
  'Illustration & Art': '插画与艺术',
  'Other Use Cases': '其他案例',
  'Photography & Realism': '摄影与写实',
  'Posters & Typography': '海报与字体',
  'Products & E-commerce': '产品与电商',
  'Scenes & Storytelling': '场景与叙事',
  'UI & Interfaces': '界面与交互'
};

const occasionOptions = ['文章与社媒', '咨询与演示', '品牌与产品', '空间与场景', '人物与叙事', '灵感漫游'];
const feelingOptions = ['克制安静', '清晰理性', '温暖有人情', '鲜明有冲击', '怀旧有时间感', '奇想有玩心'];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const nativeBridge = window.webkit?.messageHandlers?.tasteDesk;
const nativePending = new Map();

window.__tasteDeskResolve = (id, encoded) => {
  const pending = nativePending.get(id);
  if (!pending) return;
  nativePending.delete(id);
  clearTimeout(pending.timer);
  try {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (payload?.error) pending.reject(new Error(payload.error));
    else pending.resolve(payload);
  } catch (error) {
    pending.reject(error);
  }
};

async function apiRequest(action, body = null) {
  if (nativeBridge) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        nativePending.delete(id);
        reject(new Error('原生桥接响应超时'));
      }, 20000);
      nativePending.set(id, { resolve, reject, timer });
      nativeBridge.postMessage({ id, action, body });
    });
  }

  const routes = {
    bootstrap: ['GET', '/api/bootstrap'],
    saveState: ['PUT', '/api/state'],
    upload: ['POST', '/api/upload'],
    exportBoard: ['POST', '/api/export'],
    exportTask: ['POST', '/api/export-task']
  };
  const [method, url] = routes[action] || [];
  if (!method) throw new Error('未知操作');
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '操作失败');
  return payload;
}

function assetUrl(value) {
  if (!nativeBridge || !value?.startsWith('/intake-assets/')) return value;
  return `taste-resource://intake/${value.slice('/intake-assets/'.length)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('is-visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('is-visible'), 2200);
}

function caseById(id) {
  return [...app.catalog.cases, ...(app.catalog.styleCards || []), ...(app.catalog.creativeCards || []), ...(typeof assetCards === 'function' ? assetCards() : [])].find((item) => item.id === String(id));
}

function activeBoard() {
  let board = app.state.boards.find((item) => item.id === app.state.activeBoardId);
  if (!board && app.state.boards.length) {
    board = app.state.boards[0];
    app.state.activeBoardId = board.id;
  }
  return board;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

function queueSave() {
  $('#saveStatus').textContent = '正在保存…';
  clearTimeout(app.saveTimer);
  app.saveTimer = setTimeout(saveState, 260);
}

async function saveState() {
  try {
    await apiRequest('saveState', app.state);
    $('#saveStatus').textContent = '状态已保存';
    renderCounts();
  } catch (error) {
    $('#saveStatus').textContent = '保存失败';
    toast(error.message);
  }
}

function preferenceFor(id) {
  return app.state.preferences[String(id)] || 'neutral';
}

function setPreference(id, value) {
  const key = String(id);
  if (preferenceFor(key) === value) delete app.state.preferences[key];
  else app.state.preferences[key] = value;
  queueSave();
  renderBrowse();
  renderStyles();
  renderBoard();
  renderCounts();
  if (typeof renderCreative === 'function') renderCreative();
  syncDetail();
}

function renderCounts() {
  const values = Object.values(app.state.preferences);
  $('#likedCount').textContent = values.filter((value) => value === 'liked').length;
  $('#unsureCount').textContent = values.filter((value) => value === 'unsure').length;
  $('#rejectedCount').textContent = values.filter((value) => value === 'rejected').length;
  $('#boardCount').textContent = app.state.boards.length;
  $('#compareCount').textContent = app.compareIds.length;
  $('#intakeCount').textContent = app.state.intake.filter((item) => item.status === 'pending').length;
}

function countFor(kind, value) {
  if (kind === 'occasion') return app.catalog.cases.filter((item) => item.occasions.includes(value)).length;
  if (kind === 'feeling') return app.catalog.cases.filter((item) => item.feelings.includes(value)).length;
  return 0;
}

function filterButton(kind, value) {
  return `<button class="filter-chip" data-filter-kind="${kind}" data-filter-value="${escapeHtml(value)}" type="button"><span>${kind === 'occasion' ? '↗' : '◌'}</span><span>${escapeHtml(value)}</span><b>${countFor(kind, value)}</b></button>`;
}

function renderFilters() {
  $('#occasionFilters').innerHTML = occasionOptions.map((value) => filterButton('occasion', value)).join('');
  $('#feelingFilters').innerHTML = feelingOptions.map((value) => filterButton('feeling', value)).join('');
  $('#typeFilter').innerHTML = [
    '<option value="all">全部类型</option>',
    ...app.catalog.categories.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(typeLabels[value] || value)}</option>`)
  ].join('');
  syncFilterButtons();
}

function syncFilterButtons() {
  $$('.filter-chip').forEach((button) => {
    const kind = button.dataset.filterKind;
    button.classList.toggle('is-active', app.filters[kind] === button.dataset.filterValue);
  });
  $('#typeFilter').value = app.filters.type;
}

function filteredCases() {
  const query = app.filters.query.toLocaleLowerCase('zh-CN').trim();
  return app.catalog.cases.filter((item) => {
    if (app.filters.occasion !== 'all' && !item.occasions.includes(app.filters.occasion)) return false;
    if (app.filters.feeling !== 'all' && !item.feelings.includes(app.filters.feeling)) return false;
    if (app.filters.type !== 'all' && item.category !== app.filters.type) return false;
    if (app.filters.preference !== 'all' && preferenceFor(item.id) !== app.filters.preference) return false;
    if (!query) return true;
    const haystack = [
      item.title,
      item.promptPreview,
      item.prompt,
      item.category,
      ...(item.styles || []),
      ...(item.scenes || []),
      ...item.occasions,
      ...item.feelings
    ].join(' ').toLocaleLowerCase('zh-CN');
    return haystack.includes(query);
  });
}

function cardHtml(item, mode = 'browse') {
  const preference = preferenceFor(item.id);
  const stateClass = preference === 'neutral' ? '' : `is-${preference}`;
  const stateSymbol = { liked: '♥', unsure: '?', rejected: '×', neutral: '♡' }[preference];
  const selected = app.selectedCaseId === item.id ? ' is-selected' : '';
  const primaryImage = item.exampleImageUrl || item.imageUrl;
  const sourceBadge = item.exampleImageUrl ? '<span class="source-preview-badge">原文实例</span>' : '';
  const canCompare = ['style-language', 'creative-reference'].includes(item.kind) && mode !== 'board';
  const compared = app.compareIds.includes(item.id);
  return `
    <article class="case-card${selected}" data-case-id="${escapeHtml(item.id)}">
      <button class="card-image-button" data-action="detail" type="button" title="查看详情">
        <img src="${escapeHtml(primaryImage)}" data-fallback-src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.imageAlt || item.title)}" loading="lazy" referrerpolicy="no-referrer" />
        ${sourceBadge}
      </button>
      ${mode === 'board' ? '<button class="card-action board-remove" data-action="remove-board" type="button" title="从专题板移除">−</button>' : ''}
      <div class="card-actions ${preference !== 'neutral' ? 'has-state' : ''}">
        <button class="card-action ${stateClass}" data-action="quick-preference" type="button" title="循环切换喜欢、待定和不适合">${stateSymbol}</button>
        ${canCompare ? `<button class="card-action${compared ? ' is-compared' : ''}" data-action="toggle-compare" type="button" title="${compared ? '移出对照台' : '加入对照台'}">⇄</button>` : ''}
        <button class="card-action" data-action="add-board" type="button" title="加入当前专题板">＋</button>
      </div>
      <div class="card-content">
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.kind === 'creative-reference' ? `${item.sourceCode} · ${item.category}` : item.kind === 'style-language' ? item.englishTitle : item.feelings.slice(0, 2).join(' · '))}</p>
      </div>
    </article>`;
}

function renderBrowse() {
  const items = filteredCases();
  $('#resultCount').textContent = `${items.length} 项`;
  const activeLabels = [app.filters.occasion, app.filters.feeling]
    .filter((value) => value !== 'all');
  $('#resultTitle').textContent = activeLabels.join(' / ') || (app.filters.preference !== 'all' ? '我的留痕' : '全部灵感');
  $('#galleryGrid').innerHTML = items.length
    ? items.map((item) => cardHtml(item)).join('')
    : '<div class="empty-message">没有匹配项，换一个入口看看。</div>';
}

function renderStyleFilters() {
  const groups = app.catalog.styleGroups || [];
  $('#styleGroupFilters').innerHTML = [
    `<button class="style-group-chip${app.styleGroup === 'all' ? ' is-active' : ''}" data-style-group="all" type="button">全部 <b>${app.catalog.styleCards.length}</b></button>`,
    ...groups.map((group) => {
      const count = app.catalog.styleCards.filter((item) => item.group === group).length;
      return `<button class="style-group-chip${app.styleGroup === group ? ' is-active' : ''}" data-style-group="${escapeHtml(group)}" type="button">${escapeHtml(group)} <b>${count}</b></button>`;
    })
  ].join('');
}

function renderStyles() {
  if (!app.catalog?.styleCards) return;
  const query = app.filters.query.toLocaleLowerCase('zh-CN').trim();
  const items = app.catalog.styleCards.filter((item) => {
    if (app.styleGroup !== 'all' && item.group !== app.styleGroup) return false;
    if (!query) return true;
    return [item.title, item.englishTitle, item.description, item.useWhen, item.avoidWhen, ...(item.styles || []), ...(item.scenes || [])]
      .join(' ').toLocaleLowerCase('zh-CN').includes(query);
  });
  renderStyleFilters();
  $('#styleGrid').innerHTML = items.length
    ? items.map((item) => cardHtml(item, 'styles')).join('')
    : '<div class="empty-message">没有匹配的风格语言，换一个关键词看看。</div>';
}

function compareCardHtml(item) {
  const primaryImage = item.exampleImageUrl || item.imageUrl;
  return `<article class="compare-card" data-case-id="${escapeHtml(item.id)}">
    <div class="compare-image-wrap">
      <img src="${escapeHtml(primaryImage)}" data-fallback-src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.imageAlt || item.title)}" loading="lazy" referrerpolicy="no-referrer" />
      <span>${escapeHtml(item.group)}</span>
      <button class="icon-button" data-action="toggle-compare" type="button" title="移出对照台">×</button>
    </div>
    <div class="compare-copy">
      <p class="eyebrow">${escapeHtml(item.englishTitle)}</p>
      <h2>${escapeHtml(item.title)}</h2>
      <p class="compare-description">${escapeHtml(item.description)}</p>
      <dl>
        <div><dt>适合</dt><dd>${escapeHtml(item.useWhen)}</dd></div>
        <div><dt>慎用</dt><dd>${escapeHtml(item.avoidWhen)}</dd></div>
      </dl>
      <div class="compare-prompt">
        <strong>提示词</strong>
        <p>${escapeHtml(item.prompt)}</p>
        <button class="text-button" data-action="copy-item-prompt" type="button">复制这组</button>
      </div>
      <a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer">查看原文</a>
    </div>
  </article>`;
}

function renderCompare() {
  const items = app.compareIds.map(caseById).filter(Boolean);
  $('#compareMeta').textContent = items.length
    ? `已选 ${items.length} 项 · 最多 4 项`
    : '从风格词典选择 2–4 项并排看';
  $('#compareEmpty').hidden = items.length > 0;
  $('#compareGrid').hidden = items.length === 0;
  $('#compareGrid').style.setProperty('--compare-columns', Math.max(1, items.length));
  $('#compareGrid').innerHTML = items.map(compareCardHtml).join('');
  $('#clearCompareButton').disabled = items.length === 0;
  $('#compareToBoardButton').disabled = items.length === 0;
  renderCounts();
}

function toggleCompare(id) {
  const key = String(id);
  if (app.compareIds.includes(key)) {
    app.compareIds = app.compareIds.filter((itemId) => itemId !== key);
  } else {
    if (app.compareIds.length >= 4) return toast('对照台最多放 4 种风格');
    app.compareIds.push(key);
  }
  renderStyles();
  if (typeof renderCreative === 'function') renderCreative();
  renderCompare();
}

function addCompareToBoard() {
  const board = activeBoard();
  if (!board || !app.compareIds.length) return;
  let added = 0;
  for (const id of app.compareIds) {
    if (!board.itemIds.includes(id)) {
      board.itemIds.push(id);
      added += 1;
    }
  }
  board.updatedAt = new Date().toISOString();
  queueSave();
  renderBoard();
  toast(added ? `已将 ${added} 项加入“${board.title}”` : '这些风格已在当前专题板');
}

function renderBoardSelects() {
  const options = app.state.boards.map((board) => `<option value="${escapeHtml(board.id)}">${escapeHtml(board.title)}</option>`).join('');
  $('#activeBoardSelect').innerHTML = options;
  $('#boardViewSelect').innerHTML = options;
  $('#styleBoardSelect').innerHTML = options;
  $('#activeBoardSelect').value = app.state.activeBoardId;
  $('#boardViewSelect').value = app.state.activeBoardId;
  $('#styleBoardSelect').value = app.state.activeBoardId;
}

function renderBoard() {
  const board = activeBoard();
  renderBoardSelects();
  if (!board) {
    $('#activeBoardMeta').textContent = '0 项';
    $('#boardGrid').innerHTML = '';
    $('#boardEmpty').hidden = false;
    return;
  }
  const items = board.itemIds.map(caseById).filter(Boolean);
  $('#activeBoardMeta').textContent = `${board.title} · ${items.length} 项`;
  $('#boardEmpty').hidden = items.length > 0;
  $('#boardGrid').innerHTML = items.map((item) => cardHtml(item, 'board')).join('');
}

function addToBoard(id) {
  const board = activeBoard();
  if (!board) return;
  if (!board.itemIds.includes(String(id))) {
    board.itemIds.push(String(id));
    board.updatedAt = new Date().toISOString();
    queueSave();
    renderBoard();
    syncDetail();
    toast(`已加入“${board.title}”`);
  } else {
    toast('这一项已在当前专题板中');
  }
}

function removeFromBoard(id) {
  const board = activeBoard();
  if (!board) return;
  board.itemIds = board.itemIds.filter((itemId) => itemId !== String(id));
  board.updatedAt = new Date().toISOString();
  queueSave();
  renderBoard();
}

function cyclePreference(id) {
  const order = ['neutral', 'liked', 'unsure', 'rejected'];
  const current = preferenceFor(id);
  const next = order[(order.indexOf(current) + 1) % order.length];
  if (next === 'neutral') delete app.state.preferences[String(id)];
  else app.state.preferences[String(id)] = next;
  queueSave();
  renderBrowse();
  renderStyles();
  renderBoard();
  renderCounts();
  if (typeof renderCreative === 'function') renderCreative();
  syncDetail();
}

function openDetail(id) {
  app.selectedCaseId = String(id);
  renderBrowse();
  renderStyles();
  renderBoard();
  syncDetail();
  $('#detailPanel').classList.add('is-open');
}

function closeDetail() {
  app.selectedCaseId = null;
  $('#detailPanel').classList.remove('is-open');
  renderBrowse();
  renderStyles();
  renderBoard();
  syncDetail();
}

function syncDetail() {
  const item = caseById(app.selectedCaseId);
  $('#detailEmpty').hidden = Boolean(item);
  $('#detailContent').hidden = !item;
  if (!item) return;
  $('#detailImage').dataset.fallbackSrc = item.imageUrl;
  $('#detailImage').src = item.exampleImageUrl || item.imageUrl;
  $('#detailImage').alt = item.imageAlt || item.title;
  $('#detailImageCredit').hidden = !item.imageCredit;
  $('#detailImageCredit').textContent = item.imageCredit || '';
  $('#detailCategory').textContent = item.kind === 'style-language'
    ? item.group
    : (typeLabels[item.category] || item.category);
  $('#detailTitle').textContent = item.title;
  $('#detailTags').innerHTML = [...item.feelings, ...item.occasions, ...(item.styles || []).slice(0, 3)]
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
  const isStyleLanguage = ['style-language', 'creative-reference', 'owned-asset'].includes(item.kind);
  $('#styleGuidance').hidden = !isStyleLanguage;
  $('#detailDescription').textContent = item.description || '';
  $('#detailUseWhen').textContent = item.useWhen || '';
  $('#detailAvoidWhen').textContent = item.avoidWhen || '';
  $('#detailPrompt').textContent = item.prompt || item.promptPreview || '暂无提示词。';
  $('#detailNote').value = app.state.notes[item.id] || '';
  $$('.preference-actions button').forEach((button) => {
    button.classList.toggle('is-active', preferenceFor(item.id) === button.dataset.preference);
  });
  const link = item.sourceUrl || item.githubUrl;
  $('#sourceLink').hidden = !link;
  $('#sourceLink').href = link || '#';
  $('#sourceLink').textContent = item.kind === 'style-language' ? '查看原文' : '查看来源';
  const board = activeBoard();
  const alreadyAdded = board?.itemIds.includes(item.id);
  $('#addToBoardButton').textContent = alreadyAdded ? `已在“${board.title}”` : `加入“${board?.title || '专题板'}”`;
  $('#addToBoardButton').disabled = Boolean(alreadyAdded);
  $('#useInComposition').hidden = !['creative-reference', 'owned-asset'].includes(item.kind);
}

function switchView(view) {
  app.view = view;
  $$('.view-tab').forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
  $$('.view-panel').forEach((panel) => panel.classList.toggle('is-active', panel.id === `${view}View`));
  $('#filterRail').hidden = view !== 'browse';
  $('.app-body').classList.toggle('without-filter', view !== 'browse');
  const fullWidth = ['compare', 'intake', 'compose'].includes(view);
  $('.app-body').classList.toggle('full-width', fullWidth);
  $('#detailPanel').hidden = fullWidth;
  $('#searchInput').placeholder = view === 'styles' ? '搜索风格、场合或特征' : '搜索标题、提示词或标签';
  if (view === 'styles') renderStyles();
  if (view === 'compare') renderCompare();
  if (view === 'boards') renderBoard();
  if (view === 'intake') renderIntake();
  if (view === 'creative') renderCreative();
  if (view === 'compose') renderComposer();
  if (view === 'assets') renderAssets();
}

function createBoard() {
  const title = window.prompt('新专题板名称');
  if (!title?.trim()) return;
  const id = `board-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  app.state.boards.push({ id, title: title.trim().slice(0, 80), itemIds: [], createdAt: now, updatedAt: now });
  app.state.activeBoardId = id;
  queueSave();
  renderBoard();
  renderCounts();
  toast(`已建立“${title.trim()}”`);
}

function renameBoard() {
  const board = activeBoard();
  if (!board) return;
  const title = window.prompt('专题板新名称', board.title);
  if (!title?.trim()) return;
  board.title = title.trim().slice(0, 80);
  board.updatedAt = new Date().toISOString();
  queueSave();
  renderBoard();
}

function renderIntake() {
  const items = [...app.state.intake].reverse();
  $('#intakeList').innerHTML = items.length ? items.map((item) => {
    const visual = item.kind === 'image' && item.assetPath
      ? `<img src="${escapeHtml(assetUrl(item.assetPath))}" alt="" />`
      : '<span>↗</span>';
    const link = item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.url)}</a>` : '<small>本机图片</small>';
    return `<article class="intake-item" data-intake-id="${escapeHtml(item.id)}">
      <div class="intake-thumb">${visual}</div>
      <div class="intake-copy"><strong>${escapeHtml(item.title)}</strong>${link}<small>${new Date(item.createdAt).toLocaleString('zh-CN')}</small></div>
      <button class="intake-remove" data-action="remove-intake" type="button" title="移出待整理">×</button>
    </article>`;
  }).join('') : '<div class="empty-message">待整理入口现在是空的。</div>';
}

async function addLinkIntake(event) {
  event.preventDefault();
  const url = $('#intakeUrl').value.trim();
  if (!url) return;
  const title = $('#intakeTitle').value.trim() || new URL(url).hostname;
  app.state.intake.push({
    id: crypto.randomUUID(), kind: 'link', title, url, assetPath: '', note: '', status: 'pending', createdAt: new Date().toISOString()
  });
  event.currentTarget.reset();
  queueSave();
  renderIntake();
  renderCounts();
  toast('已加入待整理');
}

async function uploadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (file.size > 24 * 1024 * 1024) return toast('图片超过 24 MB');
  toast('正在放入图片…');
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const payload = await apiRequest('upload', { name: file.name, data });
  app.state.intake.push({
    id: crypto.randomUUID(), kind: 'image', title: file.name, url: '', assetPath: payload.assetPath, note: '', status: 'pending', createdAt: new Date().toISOString()
  });
  queueSave();
  renderIntake();
  renderCounts();
  toast('图片已加入待整理');
}

async function exportBoard() {
  const board = activeBoard();
  if (!board || !board.itemIds.length) return toast('专题板里还没有案例');
  const payload = await apiRequest('exportBoard', {
    title: $('#exportTitle').value.trim() || board.title,
    note: $('#exportNote').value.trim(),
    itemIds: board.itemIds
  });
  await copyText(payload.content);
  $('#exportDialog').close();
  toast(`任务包已保存并复制：${payload.path}`);
}

function handleGridClick(event) {
  const card = event.target.closest('.case-card');
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!card || !action) return;
  const id = card.dataset.caseId;
  if (action === 'detail') openDetail(id);
  if (action === 'add-board') addToBoard(id);
  if (action === 'remove-board') removeFromBoard(id);
  if (action === 'quick-preference') cyclePreference(id);
  if (action === 'toggle-compare') toggleCompare(id);
  if (action === 'copy-item-prompt') {
    const item = caseById(id);
    if (item) copyText(item.prompt || '').then(() => toast('这组提示词已复制'));
  }
}

function bindEvents() {
  document.addEventListener('error', (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const fallback = image.dataset.fallbackSrc;
    if (!fallback || image.dataset.fallbackApplied === 'true') return;
    image.dataset.fallbackApplied = 'true';
    image.src = fallback;
  }, true);

  $$('.view-tab').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('[data-go-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.goView)));

  $('#searchInput').addEventListener('input', (event) => {
    app.filters.query = event.target.value;
    if (app.view === 'creative') renderCreative();
    else if (app.view === 'styles') renderStyles();
    else renderBrowse();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      switchView('browse');
      $('#searchInput').focus();
    }
    if (event.key === 'Escape' && !$('#imageViewer').open) closeDetail();
  });

  $('#filterRail').addEventListener('click', (event) => {
    const button = event.target.closest('.filter-chip');
    if (!button) return;
    const kind = button.dataset.filterKind;
    const value = button.dataset.filterValue;
    app.filters[kind] = app.filters[kind] === value ? 'all' : value;
    syncFilterButtons();
    renderBrowse();
  });
  $('#typeFilter').addEventListener('change', (event) => {
    app.filters.type = event.target.value;
    renderBrowse();
  });
  $('#resetFilters').addEventListener('click', () => {
    app.filters = { query: '', occasion: 'all', feeling: 'all', type: 'all', preference: 'all' };
    $('#searchInput').value = '';
    syncFilterButtons();
    renderBrowse();
  });

  $('#galleryGrid').addEventListener('click', handleGridClick);
  $('#styleGrid').addEventListener('click', handleGridClick);
  $('#compareGrid').addEventListener('click', handleGridClick);
  $('#styleGroupFilters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-style-group]');
    if (!button) return;
    app.styleGroup = button.dataset.styleGroup;
    renderStyles();
  });
  $('#boardGrid').addEventListener('click', handleGridClick);
  $('#clearCompareButton').addEventListener('click', () => {
    app.compareIds = [];
    renderStyles();
    renderCompare();
  });
  $('#compareToBoardButton').addEventListener('click', addCompareToBoard);
  $('#newBoardButton').addEventListener('click', createBoard);
  $('#renameBoardButton').addEventListener('click', renameBoard);
  $('#activeBoardSelect').addEventListener('change', (event) => {
    app.state.activeBoardId = event.target.value;
    queueSave();
    renderBoard();
    syncDetail();
  });
  $('#boardViewSelect').addEventListener('change', (event) => {
    app.state.activeBoardId = event.target.value;
    queueSave();
    renderBoard();
    syncDetail();
  });
  $('#styleBoardSelect').addEventListener('change', (event) => {
    app.state.activeBoardId = event.target.value;
    queueSave();
    renderBoard();
    syncDetail();
  });

  $('#closeDetail').addEventListener('click', closeDetail);
  $$('.preference-actions button').forEach((button) => button.addEventListener('click', () => {
    if (app.selectedCaseId) setPreference(app.selectedCaseId, button.dataset.preference);
  }));
  $('#detailNote').addEventListener('input', (event) => {
    if (!app.selectedCaseId) return;
    const note = event.target.value;
    if (note.trim()) app.state.notes[app.selectedCaseId] = note;
    else delete app.state.notes[app.selectedCaseId];
    queueSave();
  });
  $('#copyPromptButton').addEventListener('click', async () => {
    const item = caseById(app.selectedCaseId);
    if (!item) return;
    await copyText(item.prompt || item.promptPreview || '');
    toast('提示词已复制');
  });
  $('#addToBoardButton').addEventListener('click', () => app.selectedCaseId && addToBoard(app.selectedCaseId));

  $('#linkIntakeForm').addEventListener('submit', addLinkIntake);
  $('#uploadInput').addEventListener('change', async (event) => {
    try { await uploadFile(event.target.files[0]); } catch (error) { toast(error.message); }
    event.target.value = '';
  });
  const uploadZone = $('#uploadZone');
  ['dragenter', 'dragover'].forEach((name) => uploadZone.addEventListener(name, (event) => {
    event.preventDefault(); uploadZone.classList.add('is-dragging');
  }));
  ['dragleave', 'drop'].forEach((name) => uploadZone.addEventListener(name, (event) => {
    event.preventDefault(); uploadZone.classList.remove('is-dragging');
  }));
  uploadZone.addEventListener('drop', async (event) => {
    try { await uploadFile(event.dataTransfer.files[0]); } catch (error) { toast(error.message); }
  });
  $('#intakeList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="remove-intake"]');
    if (!button) return;
    const id = button.closest('[data-intake-id]').dataset.intakeId;
    app.state.intake = app.state.intake.filter((item) => item.id !== id);
    queueSave(); renderIntake(); renderCounts();
  });

  $('#openExportButton').addEventListener('click', () => {
    const board = activeBoard();
    if (!board?.itemIds.length) return toast('专题板里还没有案例');
    $('#exportTitle').value = board.title;
    $('#exportNote').value = '';
    $('#exportDialog').showModal();
  });
  $('#exportButton').addEventListener('click', async () => {
    try { await exportBoard(); } catch (error) { toast(error.message); }
  });
}

async function init() {
  try {
    const payload = await apiRequest('bootstrap');
    app.catalog = payload.catalog;
    app.state = payload.state;
    app.state.creativeDraft ||= { purpose: '文章封面', ratio: '3:4', whitespace: '正常', voice: '暂不配音', subtitles: '需要字幕', itemIds: [] };
    app.state.compositions ||= [];
    app.state.assets ||= [];
    if (!app.state.boards.length) {
      const now = new Date().toISOString();
      app.state.boards.push({ id: 'board-inspiration', title: '随手灵感', itemIds: [], createdAt: now, updatedAt: now });
      app.state.activeBoardId = 'board-inspiration';
      queueSave();
    }
    $('#sourceCount').textContent = `${app.catalog.cases.length} 项只读资源`;
    $('#styleCount').textContent = app.catalog.styleCards.length;
    renderFilters();
    renderBrowse();
    renderStyles();
    renderCompare();
    renderBoard();
    renderIntake();
    renderCounts();
    syncDetail();
    bindEvents();
    initCreative();
  } catch (error) {
    document.body.innerHTML = `<main class="empty-message"><h1>品味台未能启动</h1><p>${escapeHtml(error.message)}</p></main>`;
  }
}

init();
