/**
 * 发送日志（快照）存取层
 *
 * 每次发布（无论是否实际派发）在插件数据目录下写一条快照子目录：
 *   <manifest.dir>/send-log/<dirName>/snapshot.json + img-1.png 等图片缓存副本。
 * 仅保留最近 MAX_ENTRIES 条，超出裁剪最旧目录。
 *
 * 约束：
 * - 绝不写入任何凭据（config / token / webhook 一律不碰，由调用方保证 entry 内容）。
 * - 全部走 vault.adapter 官方 API（移动端兼容），禁止 Node fs。
 * - 所有导出函数绝不 throw：写入失败返回 false，读取失败返回 [] / null。
 */

'use strict';

const SEND_LOG_DIR = 'send-log';
const MAX_ENTRIES = 10;

// ──────────────────────────────────────────────
// 内部工具
// ──────────────────────────────────────────────

function padNumber(v, size = 2) { return String(v).padStart(size, '0'); }

/** 本地时间目录名：YYYY-MM-DDTHHMMSS-xxxx（xxxx 防同一秒内多次写入冲突） */
function buildDirName(now = new Date(), suffix = '') {
  const stamp = `${now.getFullYear()}-${padNumber(now.getMonth() + 1)}-${padNumber(now.getDate())}` +
    `T${padNumber(now.getHours())}${padNumber(now.getMinutes())}${padNumber(now.getSeconds())}`;
  const tail = suffix || Math.random().toString(36).slice(2, 6);
  return `${stamp}-${tail}`;
}

/** 本地时间 ISO 字符串（带时区偏移），如 2026-09-06T21:30:05.482+08:00 */
function toLocalIsoString(d = new Date()) {
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${padNumber(Math.floor(abs / 60))}:${padNumber(abs % 60)}`;
  const base = `${d.getFullYear()}-${padNumber(d.getMonth() + 1)}-${padNumber(d.getDate())}` +
    `T${padNumber(d.getHours())}:${padNumber(d.getMinutes())}:${padNumber(d.getSeconds())}` +
    `.${String(d.getMilliseconds()).padStart(3, '0')}`;
  return `${base}${offset}`;
}

/** sentAt 字符串 → 时间戳（解析失败按 0，排序兜底） */
function sentAtTime(value) {
  const t = Date.parse(String(value || ''));
  return Number.isNaN(t) ? 0 : t;
}

/** 图片缓存扩展名：取 filename 扩展名小写并清非法字符，无扩展名则 bin */
function imageCacheExt(filename) {
  const name = String(filename || '');
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return ext || 'bin';
}

/** 目录名单段化（防路径穿越） */
function safeDirName(dirName) {
  return String(dirName || '').replace(/[\\\/]/g, '');
}
/** 目录条目名：Obsidian 的 ListedFiles.folders 是 string[]，兼容对象形态 */
function folderName(folder) {
  return typeof folder === 'string' ? folder.split('/').pop() : (folder?.name || String(folder?.path || '').split('/').pop());
}

/** 从 ctx 取 { adapter, baseDir }；不完整返回 null */
function resolveCtx(ctx) {
  const plugin = ctx?.plugin;
  const adapter = plugin?.app?.vault?.adapter;
  const baseDir = String(plugin?.manifest?.dir || '');
  if (!adapter || !baseDir) return null;
  return { adapter, baseDir };
}

/** 列表预览：剥 @图片N / ![[...]] / ![...](...) 后取首个非空行截 80 字符；纯图发送显示 [图片] ×N */
function buildPreview(snapshot) {
  const content = String(snapshot?.content || '');
  const stripped = content
    .replace(/@图片\d+/g, '')
    .replace(/!\[\[[^\]]+\]\]/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  const firstLine = stripped.split('\n').map(l => l.trim()).find(l => l.length > 0) || '';
  if (firstLine) return firstLine.slice(0, 80);
  const count = Array.isArray(snapshot?.images) ? snapshot.images.length : 0;
  return count > 0 ? `[图片] ×${count}` : '';
}

// ──────────────────────────────────────────────
// 导出 API
// ──────────────────────────────────────────────

/**
 * 写入一条发送快照。
 *
 * @param {object} ctx    - { plugin }（提供 app.vault.adapter 与 manifest）
 * @param {object} entry  - 快照结构（见 Contract）；images[].data 为运行时字段
 *                          （ArrayBuffer 或 Blob），写入缓存文件后不落 snapshot.json。
 * @returns {Promise<boolean>} 成功 true；任何失败 false（绝不 throw）
 */
async function writeSnapshot(ctx, entry) {
  try {
    const resolved = resolveCtx(ctx);
    if (!resolved || !entry || typeof entry !== 'object') return false;
    const { adapter, baseDir } = resolved;

    // 目录名从 sentAt 派生；后缀取毫秒并追加随机段，保证同一毫秒内多次写入也不冲突
    const nowMs = sentAtTime(entry.sentAt);
    const suffix = (nowMs > 0 ? nowMs.toString(36).slice(-4).padStart(4, '0') : '') + Math.random().toString(36).slice(2, 6);
    const sentAt = entry.sentAt || toLocalIsoString(new Date());
    const dirName = buildDirName(new Date(nowMs || Date.now()), suffix);
    const rootDir = `${baseDir}/${SEND_LOG_DIR}`;
    const entryDir = `${rootDir}/${dirName}`;

    // 递归建目录（已存在时忽略错误）
    await adapter.mkdir(rootDir).catch(() => {});
    await adapter.mkdir(entryDir).catch(() => {});

    // 逐张写图片缓存副本，并在 snapshot.json 中以 cacheFile 引用
    const images = Array.isArray(entry.images) ? entry.images : [];
    const storedImages = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (!img || typeof img !== 'object') continue;
      const cacheFile = img.cacheFile || `img-${i + 1}.${imageCacheExt(img.filename)}`;
      if (img.data !== undefined && img.data !== null) {
        const buffer = img.data instanceof Blob ? await img.data.arrayBuffer() : img.data;
        await adapter.writeBinary(`${entryDir}/${cacheFile}`, buffer);
      }
      const { data: _runtime, ...rest } = img;
      storedImages.push({ ...rest, cacheFile });
    }

    // 写 snapshot.json（浅拷贝，不修改调用方对象；不含 images[].data）
    const snapshot = { ...entry, sentAt, images: storedImages };
    await adapter.write(`${entryDir}/snapshot.json`, JSON.stringify(snapshot, null, 2));

    // 裁剪超出上限的最旧条目（失败静默，不影响写入结果）
    try {
      const listed = await adapter.list(rootDir);
      const folders = Array.isArray(listed?.folders) ? listed.folders : [];
      const candidates = [];
      for (const folder of folders) {
        const name = folderName(folder);
        if (!name) continue;
        try {
          const raw = await adapter.read(`${rootDir}/${name}/snapshot.json`);
          const parsed = JSON.parse(raw);
          candidates.push({ name, sentAt: (parsed && parsed.sentAt) ? parsed.sentAt : 0 });
        } catch (e) { candidates.push({ name, sentAt: 0 }); }
      }
      candidates.sort((a, b) => sentAtTime(a.sentAt) - sentAtTime(b.sentAt));
      while (candidates.length > MAX_ENTRIES) {
        const oldest = candidates.shift();
        try { await adapter.rmdir(`${rootDir}/${oldest.name}`, true); } catch (e) { /* 静默 */ }
      }
    } catch (e) { /* 裁剪失败静默 */ }

    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 列举日志条目（按 sentAt 降序）。
 *
 * @param {object} ctx - { plugin }
 * @returns {Promise<Array>} [{ dirName, sentAt, dispatched, failStage, preview, snapshot }]
 *                           读不到目录或全部损坏时返回 []
 */
async function listEntries(ctx) {
  try {
    const resolved = resolveCtx(ctx);
    if (!resolved) return [];
    const { adapter, baseDir } = resolved;
    const rootDir = `${baseDir}/${SEND_LOG_DIR}`;

    if (!(await adapter.exists(rootDir))) return [];
    const listed = await adapter.list(rootDir);
    const folders = Array.isArray(listed?.folders) ? listed.folders : [];

    const entries = [];
    for (const folder of folders) {
      const name = folderName(folder);
      if (!name) continue;
      const snapshot = await readSnapshot(ctx, name);
      if (!snapshot || !snapshot.sentAt) continue;
      entries.push({
        dirName: name,
        sentAt: snapshot.sentAt,
        dispatched: snapshot.dispatched !== false,
        failStage: snapshot.failStage || null,
        preview: buildPreview(snapshot),
        snapshot
      });
    }

    entries.sort((a, b) => sentAtTime(b.sentAt) - sentAtTime(a.sentAt));
    return entries.slice(0, MAX_ENTRIES);
  } catch (e) {
    return [];
  }
}

/**
 * 读取单条完整快照（重新编辑用）。
 *
 * @param {object} ctx    - { plugin }
 * @param {string} dirName - 条目目录名（来自 listEntries）
 * @returns {Promise<object|null>} 快照对象（images 不含 data）；找不到/损坏返回 null
 */
async function readSnapshot(ctx, dirName) {
  try {
    const resolved = resolveCtx(ctx);
    const name = safeDirName(dirName);
    if (!resolved || !name) return null;
    const { adapter, baseDir } = resolved;

    const filePath = `${baseDir}/${SEND_LOG_DIR}/${name}/snapshot.json`;
    if (!(await adapter.exists(filePath))) return null;

    const parsed = JSON.parse(await adapter.read(filePath));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

module.exports = { SEND_LOG_DIR, MAX_ENTRIES, writeSnapshot, listEntries, readSnapshot };
