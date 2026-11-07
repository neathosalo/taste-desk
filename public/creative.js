function assetCards() {
  return (app.state?.assets || []).map(a => ({ ...a, kind: 'owned-asset', resourceType: 'asset', category: a.assetType,
    imageUrl: assetUrl(a.assetPath), sourceCode: a.id, group: a.assetType, description: a.traits,
    prompt: `参考基准图保留：${a.traits || a.title}；生成后核对主体一致性。`,
    feelings: [], occasions: [], styles: [], useWhen: '系列创作的主体参考', avoidWhen: '基准图不保证生成结果一致' }));
}

function renderCreative() {
  if (!app.catalog?.creativeCards) return;
  const type = $('#creativeType [aria-pressed="true"]').dataset.creativeType;
  const preference = $('#creativePreference').value;
  const query = app.filters.query.toLocaleLowerCase('zh-CN').trim();
  const items = app.catalog.creativeCards.filter(i => i.resourceType === type &&
    (preference === 'all' || preferenceFor(i.id) === preference) &&
    (!query || [i.title, i.description, i.sourceCode, i.group].join(' ').toLocaleLowerCase('zh-CN').includes(query)));
  $('#creativeCount').textContent = `${items.length} 项`;
  $('#creativeGrid').innerHTML = items.length ? items.map(i => cardHtml(i, 'creative')).join('') : '<div class="empty-message">没有匹配项</div>';
}

function useInComposition(id) {
  const item = caseById(id);
  if (!item) return;
  const draft = app.state.creativeDraft;
  const selected = (draft.itemIds || []).map(caseById).filter(Boolean);
  if (selected.some(i => i.id === id)) return toast('已在当前组合');
  const limits = { style: 2, layout: 1, color: 3, video: 1, asset: 8 };
  if (selected.filter(i => i.resourceType === item.resourceType).length >= (limits[item.resourceType] || 1)) {
    toast(`这一类已选满，请先从组合中移除一项`);
    return;
  }
  draft.itemIds = [...(draft.itemIds || []), id];
  queueSave();
  closeDetail();
  switchView('compose');
}

function compositionTask() {
  const draft = { ...app.state.creativeDraft };
  const refs = (draft.itemIds || []).map(caseById).filter(Boolean).map(i => ({
    id: i.id, type: i.resourceType, title: i.title, description: i.description || '', prompt: i.prompt || '',
    localImagePath: i.localImagePath || '',
    source: i.sourceUrl || i.source || '', sourceCode: i.sourceCode || '', version: i.sourceVersion || i.version || 'v1'
  }));
  return { schemaVersion: 1, ...draft, references: refs };
}

function compositionMarkdown(task) {
  const lines = [`# ${task.theme || '未命名创意任务'}`, '', `用途：${task.purpose || '待定'}`, `画幅：${task.ratio || '待定'}`,
    `主题：${task.theme || '待补充'}`, `情绪：${task.mood || '由执行伙伴结合题材判断'}`, `留白：${task.whitespace || '正常'}`, ''];
  if (task.purpose === '短视频') lines.push(`时长：${task.duration || '待定'}秒；${task.voice}；${task.subtitles}`, '');
  if (task.note) lines.push('补充要求：', task.note, '');
  lines.push('## 已选参考', '');
  const colors = task.references.filter(r => r.type === 'color');
  const styles = task.references.filter(r => r.type === 'style');
  for (const r of task.references) {
    const role = r.type === 'color' ? (colors.indexOf(r) === 0 ? '主色' : '辅助色') : r.type === 'style' && styles.length > 1 ? (styles.indexOf(r) === 0 ? '主风格' : '辅助风格') : ({style:'画风',layout:'版式',video:'视频表现',asset:'基准资产'})[r.type];
    lines.push(`### ${r.title}（${role}）`, `来源编号：${r.id}；版本：${r.version}`, `参考图：${r.localImagePath}`, `来源：${r.source}`, '', r.prompt || r.description, '');
  }
  lines.push('## 执行要求', '先根据主题和参考给出方案，再制作小样。只借鉴版式结构，模板示例文案按主题重写。',
    '留空项由执行伙伴提出建议；参考图用于视觉判断，不保证生成一致性。媒体生成成本与最终执行工具另行确认。', '');
  return lines.join('\n');
}

function renderComposer() {
  const draft = app.state.creativeDraft;
  for (const element of $('#composerForm').elements) if (element.name) element.value = draft[element.name] || '';
  const items = (draft.itemIds || []).map(caseById).filter(Boolean);
  $('#compositionSelections').innerHTML = items.length ? items.map(i => `<div class="selection-row"><img src="${escapeHtml(i.imageUrl)}" alt="" /><div><strong>${escapeHtml(i.title)}</strong><small>${escapeHtml(i.category)} · ${escapeHtml(i.sourceCode)}</small></div><button class="icon-button" type="button" data-remove-composition="${escapeHtml(i.id)}" title="移出组合">×</button></div>`).join('') : '<div class="composer-empty"><button type="button" class="secondary-button" data-go-creative>选择参考</button></div>';
  $('#savedComposition').innerHTML = '<option value="">选择组合</option>' + app.state.compositions.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.theme || c.purpose)}</option>`).join('');
  $('#compositionPreview').textContent = compositionMarkdown(compositionTask());
}

function renderAssets() {
  const type = $('#assetType').value;
  const items = assetCards().filter(a => a.assetType === type);
  $('#assetGrid').innerHTML = items.length ? items.map(i => cardHtml(i, 'assets')).join('') : '<div class="empty-message">暂无资产</div>';
}

async function saveOwnedAsset(event) {
  event.preventDefault();
  const file = $('#assetImage').files[0];
  if (!file || file.size > 24 * 1024 * 1024) return toast('请选择小于24MB的基准图');
  const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  const uploaded = await apiRequest('upload', { name: file.name, data });
  app.state.assets.push({ id: `asset:${crypto.randomUUID()}`, title: $('#assetName').value.trim(), assetType: $('#assetType').value,
    traits: $('#assetTraits').value.trim(), source: $('#assetSource').value.trim(), version: $('#assetVersion').value.trim() || 'v1', assetPath: uploaded.assetPath, localImagePath: uploaded.localImagePath, createdAt: new Date().toISOString() });
  await saveState();
  $('#assetForm').reset();
  renderAssets();
  toast('资产已保存');
}

function initCreative() {
  $('#creativeGrid').addEventListener('click', handleGridClick);
  $('#assetGrid').addEventListener('click', handleGridClick);
  $('#creativeType').addEventListener('click', event => {
    const selected = event.target.closest('[data-creative-type]');
    if (!selected) return;
    $$('#creativeType button').forEach(button => button.setAttribute('aria-pressed', String(button === selected)));
    renderCreative();
  });
  $('#creativePreference').addEventListener('change', renderCreative);
  $('#assetType').addEventListener('change', renderAssets);
  $('#useInComposition').addEventListener('click', () => useInComposition(app.selectedCaseId));
  $('#assetForm').addEventListener('submit', event => saveOwnedAsset(event).catch(error => toast(error.message)));
  $('#composerForm').addEventListener('submit', event => event.preventDefault());
  $('#composerForm').addEventListener('input', event => {
    if (!event.target.name) return;
    app.state.creativeDraft[event.target.name] = event.target.value;
    queueSave();
    $('#compositionPreview').textContent = compositionMarkdown(compositionTask());
  });
  $('#compositionSelections').addEventListener('click', event => {
    if (event.target.closest('[data-go-creative]')) return switchView('creative');
    const id = event.target.closest('[data-remove-composition]')?.dataset.removeComposition;
    if (!id) return;
    app.state.creativeDraft.itemIds = app.state.creativeDraft.itemIds.filter(v => v !== id);
    queueSave(); renderComposer();
  });
  $('#copyComposition').addEventListener('click', () => copyText(compositionMarkdown(compositionTask())).then(() => toast('任务已复制')));
  $('#saveComposition').addEventListener('click', () => {
    app.state.compositions.push({ ...structuredClone(app.state.creativeDraft), id: crypto.randomUUID(), savedAt: new Date().toISOString() });
    queueSave(); renderComposer(); toast('组合已保存');
  });
  $('#savedComposition').addEventListener('change', event => {
    const recipe = app.state.compositions.find(c => c.id === event.target.value);
    if (!recipe) return;
    app.state.creativeDraft = structuredClone(recipe);
    queueSave(); renderComposer();
  });
  $('#exploreComposition').addEventListener('click', () => {
    const selected = app.state.creativeDraft.itemIds.map(caseById).filter(Boolean);
    const picks = [];
    for (const type of ['style', 'layout', 'color']) {
      const current = selected.filter(i => i.resourceType === type);
      let pool = app.catalog.creativeCards.filter(i => i.resourceType === type && preferenceFor(i.id) !== 'rejected');
      if (type === 'layout') {
        const group = ({'文章封面':'social-card','社媒图文':'social-card','知识图解':'infographic','角色设定':'ip-character','短视频':'comic-storyboard'})[app.state.creativeDraft.purpose];
        if (group) pool = pool.filter(i => i.group === group);
      }
      const liked = pool.filter(i => preferenceFor(i.id) === 'liked');
      if (liked.length) pool = liked;
      if (current.length) picks.push(...current.map(i => i.id));
      else if (pool.length) picks.push(pool[Math.floor(Math.random() * pool.length)].id);
    }
    picks.push(...selected.filter(i => !['style', 'layout', 'color'].includes(i.resourceType)).map(i => i.id));
    app.state.creativeDraft.itemIds = picks;
    queueSave(); renderComposer();
  });
  $('#exportComposition').addEventListener('click', async () => {
    try {
      await saveState();
      const task = compositionTask();
      const payload = await apiRequest('exportTask', { task, content: compositionMarkdown(task) });
      $('#compositionExportPath').textContent = `${payload.path}\n${payload.jsonPath}`;
      toast('Markdown与JSON任务已保存');
    } catch (error) { toast(error.message); }
  });
  renderCreative(); renderComposer(); renderAssets();
}
