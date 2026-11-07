import http from 'node:http';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { cases, styleCards, creativeCards, styleGroups } from './sample-catalog.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.join(ROOT, 'public');
const DATA_ROOT = process.env.TASTE_DESK_DATA_ROOT || path.join(ROOT, 'local-data');
const STATE_FILE = path.join(DATA_ROOT, 'state.json');
const INTAKE_ROOT = path.join(DATA_ROOT, 'intake-assets');
const EXPORT_ROOT = process.env.TASTE_DESK_EXPORT_ROOT || path.join(ROOT, 'exports');
const DEFAULT_PORT = 4318;
const MAX_JSON_BODY = 32 * 1024 * 1024;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif'
};

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const port = Number(argValue('--port', process.env.TASTE_DESK_PORT || DEFAULT_PORT));

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

function safeChild(root, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const normalized = path.normalize(decoded).replace(/^([/\\])+/, '');
  const candidate = path.resolve(root, normalized);
  const base = path.resolve(root) + path.sep;
  return candidate.startsWith(base) ? candidate : null;
}

async function serveFile(response, filePath, cache = false) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': cache ? 'public, max-age=3600' : 'no-store'
    });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: '文件不存在' });
  }
}

async function parseJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BODY) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return cleanState({});
  }
}

function cleanText(value, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanState(input) {
  const preferences = {};
  for (const [id, value] of Object.entries(input.preferences || {})) {
    if (['liked', 'rejected', 'unsure'].includes(value)) preferences[String(id).slice(0, 100)] = value;
  }

  const notes = {};
  for (const [id, value] of Object.entries(input.notes || {})) {
    const note = cleanText(value, 2000);
    if (note) notes[String(id).slice(0, 100)] = note;
  }

  const boards = Array.isArray(input.boards)
    ? input.boards.slice(0, 100).map((board) => ({
        id: cleanText(board.id, 100) || crypto.randomUUID(),
        title: cleanText(board.title, 80) || '未命名专题板',
        itemIds: [...new Set((Array.isArray(board.itemIds) ? board.itemIds : []).map(String))].slice(0, 500),
        createdAt: cleanText(board.createdAt, 40) || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))
    : [];

  const intake = Array.isArray(input.intake)
    ? input.intake.slice(0, 500).map((entry) => ({
        id: cleanText(entry.id, 100) || crypto.randomUUID(),
        kind: ['link', 'image'].includes(entry.kind) ? entry.kind : 'link',
        title: cleanText(entry.title, 160) || '未命名素材',
        url: cleanText(entry.url, 3000),
        assetPath: cleanText(entry.assetPath, 500),
        note: cleanText(entry.note, 2000),
        status: ['pending', 'reviewed'].includes(entry.status) ? entry.status : 'pending',
        createdAt: cleanText(entry.createdAt, 40) || new Date().toISOString()
      }))
    : [];

  return {
    ...input,
    version: 1,
    preferences,
    notes,
    boards,
    activeBoardId: cleanText(input.activeBoardId, 100),
    intake
  };
}

async function writeState(input) {
  const state = cleanState(input);
  await mkdir(DATA_ROOT, { recursive: true });
  const temporary = `${STATE_FILE}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporary, STATE_FILE);
  return state;
}

function imageUrl(image) {
  if (!image) return '';
  const relative = image.startsWith('/') ? image.slice(1) : image;
  return `/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

function feelingTags(item) {
  const tags = new Set([...(item.styles || []), ...(item.scenes || []), item.category]);
  const feelings = [];
  const has = (...values) => values.some((value) => tags.has(value));
  if (has('Charts', 'Infographic', 'UI', 'Documents', 'Tech', 'Education', 'Charts & Infographics', 'UI & Interfaces')) feelings.push('清晰理性');
  if (has('Architecture', 'Brand', 'Photography', 'Documents', 'Architecture & Spaces', 'Photography & Realism')) feelings.push('克制安静');
  if (has('Character', 'Characters', 'Photography', 'Story', 'Food', 'Travel', 'Characters & People')) feelings.push('温暖有人情');
  if (has('Poster', '3D', 'Product', 'Products', 'Fashion', 'Commerce', 'Posters & Typography', 'Products & E-commerce')) feelings.push('鲜明有冲击');
  if (has('Classical', 'History', 'History & Classical Themes')) feelings.push('怀旧有时间感');
  if (has('Illustration', 'Scenes', 'Creative', 'Illustration & Art', 'Scenes & Storytelling')) feelings.push('奇想有玩心');
  return feelings.length ? [...new Set(feelings)] : ['暂未归类'];
}

function occasionTags(item) {
  const category = item.category;
  const result = [];
  if (['Posters & Typography', 'Documents & Publishing', 'Illustration & Art', 'Scenes & Storytelling'].includes(category)) result.push('文章与社媒');
  if (['Charts & Infographics', 'Documents & Publishing', 'UI & Interfaces'].includes(category)) result.push('咨询与演示');
  if (['Brand & Logos', 'Products & E-commerce', 'Photography & Realism'].includes(category)) result.push('品牌与产品');
  if (['Architecture & Spaces', 'Scenes & Storytelling', 'Photography & Realism'].includes(category)) result.push('空间与场景');
  if (['Characters & People', 'History & Classical Themes', 'Scenes & Storytelling'].includes(category)) result.push('人物与叙事');
  return result.length ? result : ['灵感漫游'];
}

function normalizeCase(item) {
  return {
    ...item,
    id: String(item.id),
    imageUrl: imageUrl(item.image),
    feelings: feelingTags(item),
    occasions: occasionTags(item)
  };
}

function normalizeStyleCard(item) {
  const relative = String(item.image || '').replace(/^\/+/, '');
  return {
    ...item,
    id: String(item.id),
    imageUrl: `/${relative.split('/').map(encodeURIComponent).join('/')}`
  };
}

function catalog() {
  return {
    source: {
      name: '品味台示例库',
      readOnly: true
    },
    cases: cases.map(normalizeCase),
    categories: [...new Set(cases.map(item => item.category))],
    styleCards: styleCards.map(normalizeStyleCard),
    creativeCards: creativeCards.map(item => ({
      ...normalizeStyleCard(item),
      localImagePath: path.join(PUBLIC_ROOT, item.image)
    })),
    styleGroups
  };
}

async function uploadImage(body) {
  const name = cleanText(body.name, 200).replace(/[^\p{L}\p{N}._-]+/gu, '-');
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s.exec(body.data || '');
  if (!name || !match) throw new Error('仅支持 PNG、JPEG、WebP 或 GIF 图片');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 24 * 1024 * 1024) throw new Error('图片必须小于 24 MB');
  await mkdir(INTAKE_ROOT, { recursive: true });
  const fileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${name}`;
  await writeFile(path.join(INTAKE_ROOT, fileName), buffer);
  return { assetPath: `/intake-assets/${encodeURIComponent(fileName)}`, localImagePath: path.join(INTAKE_ROOT, fileName) };
}

function markdownEscape(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

async function exportBoard(body) {
  const data = await catalog();
  const state = await readState();
  const assets = (state.assets || []).map(a => ({ ...a, category: a.assetType, description: a.traits, feelings: [], occasions: [], prompt: `以基准图保持主体特征：${a.traits || a.title}` }));
  const byId = new Map([...data.cases, ...data.styleCards, ...data.creativeCards, ...assets].map((item) => [item.id, item]));
  const ids = Array.isArray(body.itemIds) ? body.itemIds.map(String).slice(0, 200) : [];
  const items = ids.map((id) => byId.get(id)).filter(Boolean);
  const title = cleanText(body.title, 100) || '未命名视觉任务';
  const note = cleanText(body.note, 5000);
  const lines = [
    `# ${title}`,
    '',
    `> 由 PAIOS 品味台导出于 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    '',
    '## 本次意图',
    '',
    note || '待补充。',
    '',
    '## 参考案例',
    ''
  ];
  items.forEach((item, index) => {
    lines.push(`### ${index + 1}. ${markdownEscape(item.title)}`);
    lines.push('');
    lines.push(`- 分类：${markdownEscape(item.category)}`);
    lines.push(`- 感觉导航：${item.feelings.join('、')}`);
    lines.push(`- 使用场合：${item.occasions.join('、')}`);
    if (item.sourceLabel) lines.push(`- 来源：${markdownEscape(item.sourceLabel)}`);
    if (item.sourceUrl) lines.push(`- 来源链接：${markdownEscape(item.sourceUrl)}`);
    if (item.exampleImageUrl) lines.push(`- 来源实例预览：${markdownEscape(item.exampleImageUrl)}`);
    lines.push(`- 本地图片：${item.localImagePath || path.join(PUBLIC_ROOT, item.image?.replace(/^\//, '') || '')}`);
    if (item.sourceCode) lines.push(`- 来源编号与版本：${item.sourceCode} / ${item.sourceVersion}`);
    if (item.description) lines.push(`- 核心含义：${markdownEscape(item.description)}`);
    if (item.useWhen) lines.push(`- 适合：${markdownEscape(item.useWhen)}`);
    if (item.avoidWhen) lines.push(`- 慎用：${markdownEscape(item.avoidWhen)}`);
    lines.push('');
    if (item.prompt) {
      lines.push('参考提示词：');
      lines.push('');
      lines.push('```text');
      lines.push(markdownEscape(item.prompt));
      lines.push('```');
      lines.push('');
    }
  });
  lines.push('## 给执行伙伴');
  lines.push('');
  lines.push('请把上述案例作为方向证据而非机械拼贴；先复述共同特征与差异，再提出本次成品方案。');
  lines.push('');

  await mkdir(EXPORT_ROOT, { recursive: true });
  const safeTitle = title.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60) || 'taste-task';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${stamp}-${safeTitle}.md`;
  const outputPath = path.join(EXPORT_ROOT, fileName);
  const content = `${lines.join('\n')}\n`;
  await writeFile(outputPath, content, 'utf8');
  return { path: outputPath, content };
}

const server = http.createServer(async (request, response) => {
  const host = request.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host) ||
      (request.headers.origin && request.headers.origin !== `http://${host}`) ||
      request.headers['sec-fetch-site'] === 'cross-site') {
    return sendJson(response, 403, { error: '仅接受本机页面的请求' });
  }
  const url = new URL(request.url, `http://${host}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
      const [catalogData, state] = await Promise.all([catalog(), readState()]);
      sendJson(response, 200, { catalog: catalogData, state });
      return;
    }
    if (request.method === 'PUT' && url.pathname === '/api/state') {
      sendJson(response, 200, { state: await writeState(await parseJson(request)) });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/upload') {
      sendJson(response, 201, await uploadImage(await parseJson(request)));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/export') {
      sendJson(response, 201, await exportBoard(await parseJson(request)));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/export-task') {
      const body = await parseJson(request);
      const content = cleanText(body.content, 200000);
      if (!content) throw new Error('任务内容为空');
      await mkdir(EXPORT_ROOT, { recursive: true });
      const stem = `${Date.now()}-creative-task`;
      const outputPath = path.join(EXPORT_ROOT, `${stem}.md`);
      const jsonPath = path.join(EXPORT_ROOT, `${stem}.json`);
      await writeFile(outputPath, content, 'utf8');
      await writeFile(jsonPath, JSON.stringify(body.task, null, 2), 'utf8');
      sendJson(response, 201, { path: outputPath, jsonPath, content });
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/intake-assets/')) {
      const file = safeChild(INTAKE_ROOT, url.pathname.slice('/intake-assets/'.length));
      if (!file) return sendJson(response, 403, { error: '路径无效' });
      await serveFile(response, file, false);
      return;
    }
    if (request.method === 'GET') {
      const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = safeChild(PUBLIC_ROOT, requested);
      if (!file) return sendJson(response, 403, { error: '路径无效' });
      await serveFile(response, file, false);
      return;
    }
    sendJson(response, 405, { error: '不支持此操作' });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: error.message || '服务器发生错误' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`PAIOS Taste Desk: http://127.0.0.1:${server.address().port}`);
});
