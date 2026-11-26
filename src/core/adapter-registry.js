'use strict';

const { t, registerTranslations } = require('./i18n');

registerTranslations('en', {
    '未命名图片': 'Unnamed image',
    '适配器不存在': 'Adapter not found',
    '{name} 图片超过 {max} 张，只发送前 {max} 张，确认发送': '{name}: over {max} images; only the first {max} will be sent. Confirm to send',
    '{name} 图片文件超过 {size} MB：{preview}{suffix}，确认发送': '{name}: image files exceed {size} MB: {preview}{suffix}. Confirm to send',
    ' 等 {count} 张': ' ...and {count} more',
    '{id}: 适配器不存在': '{id}: adapter not found',
    '、': ', '
});

class AdapterRegistry {
  constructor() {
    this._adapters = new Map();
  }

  register(adapter) {
    if (!adapter?.manifest?.id) throw new Error('adapter must have manifest.id');
    this._adapters.set(adapter.manifest.id, adapter);
  }

  get(id) { return this._adapters.get(id) || null; }
  getAll() { return Array.from(this._adapters.values()); }
  has(id) { return this._adapters.has(id); }

  /**
   * 获取适配器能力声明
   * @param {string} id
   * @returns {object} capabilities
   */
  getCapabilities(id) {
    const adapter = this.get(id);
    if (!adapter) return null;
    return adapter.manifest?.capabilities || null;
  }

  /**
   * 按适配器能力声明识别图片数量和文件大小预警，并调用可选适配器级发送前预警钩子。
   * 这里只负责发现并生成提示，不改变 payload，也不决定是否发送。
   * @param {string[]} targetIds
   * @param {object} payload
   * @param {object} [configs] - { [adapterId]: config }
   * @returns {Promise<{ warnings: string[], perAdapter: object }>}
   */
  async getAttachmentWarnings(targetIds, payload = {}, configs = {}) {
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const images = attachments.filter(item => item?.kind === 'image');
    const warnings = [];
    const perAdapter = {};
    const sizeCache = new Map();

    const readSize = async (image) => {
      if (Number.isFinite(image?.size)) return image.size;
      const key = image?.vaultPath || image?.filename;
      if (!key) return null;
      if (sizeCache.has(key)) return sizeCache.get(key);

      const pending = Promise.resolve()
        .then(() => {
          if (typeof payload.statAttachment !== 'function') return null;
          return payload.statAttachment(key);
        })
        .catch(() => null)
        .then(statSize => {
          const bytes = Number(statSize);
          if (Number.isFinite(bytes) && bytes > 0) return bytes;
          // statAttachment 缺失、返回 null 或抛错：回退读取完整二进制的旧路径。
          if (typeof payload.readAttachment !== 'function') return null;
          return Promise.resolve()
            .then(() => payload.readAttachment(key))
            .then(buffer => buffer?.byteLength || 0);
        })
        .then(size => {
          if (size > 0) image.size = size;
          return size || null;
        })
        .catch(() => null);
      sizeCache.set(key, pending);
      return pending;
    };

    for (const id of targetIds) {
      const adapter = this.get(id);
      const capabilities = adapter?.manifest?.capabilities || {};
      const adapterWarnings = [];
      const name = adapter?.manifest?.name || id;
      const maxAttachments = Number(capabilities.maxAttachments) || 0;
      const maxAttachmentSize = Number(capabilities.maxAttachmentSize) || 0;

      if (
        capabilities.warnOnAttachmentCount === true
        && maxAttachments > 0
        && images.length > maxAttachments
      ) {
        adapterWarnings.push(t('{name} 图片超过 {max} 张，只发送前 {max} 张，确认发送', { name, max: maxAttachments }));
      }

      if (capabilities.warnOnAttachmentSize === true && maxAttachmentSize > 0) {
        const sizes = await Promise.all(images.map(image => readSize(image)));
        const oversized = [];
        for (let i = 0; i < images.length; i++) {
          if (sizes[i] > maxAttachmentSize) {
            const image = images[i];
            oversized.push(image.filename || image.vaultPath || t('未命名图片'));
          }
        }
        if (oversized.length > 0) {
          const preview = oversized.slice(0, 3).join(t('、'));
          const suffix = oversized.length > 3 ? t(' 等 {count} 张', { count: oversized.length }) : '';
          adapterWarnings.push(t('{name} 图片文件超过 {size} MB：{preview}{suffix}，确认发送', { name, size: Math.round(maxAttachmentSize / 1024 / 1024), preview, suffix }));
        }
      }

      if (typeof adapter?.getPreSendWarnings === 'function') {
        const extra = await adapter.getPreSendWarnings({ payload, config: configs[id] || {} });
        if (Array.isArray(extra)) {
          adapterWarnings.push(...extra.filter(Boolean));
        }
      }

      perAdapter[id] = adapterWarnings;
      warnings.push(...adapterWarnings);
    }

    return { warnings, perAdapter };
  }

  /**
   * 对多个目标适配器执行预检验证。
   * 每个适配器自行检查 payload 是否满足其限制条件。
   *
   * @param {string[]} targetIds - 目标适配器 ID 列表
   * @param {object} payload - 统一 payload
   * @param {object} configs - { [adapterId]: config }
   * @returns {Promise<{ warnings: string[], errors: string[], perAdapter: object }>}
   */
  async validateAll(targetIds, payload, configs = {}) {
    const perAdapter = {};
    const warnings = [];
    const errors = [];

    for (const id of targetIds) {
      const adapter = this.get(id);
      if (!adapter) {
        perAdapter[id] = { warnings: [], errors: [t('适配器不存在')] };
        errors.push(t('{id}: 适配器不存在', { id }));
        continue;
      }

      const config = configs[id] || {};
      const result = typeof adapter.validate === 'function'
        ? await adapter.validate({ payload, config })
        : { warnings: [], errors: [] };

      const aw = Array.isArray(result.warnings) ? result.warnings : [];
      const ae = Array.isArray(result.errors) ? result.errors : [];

      perAdapter[id] = { warnings: aw, errors: ae };

      for (const w of aw) warnings.push(`${id}: ${w}`);
      for (const e of ae) errors.push(`${id}: ${e}`);
    }

    return { warnings, errors, perAdapter };
  }
}

module.exports = AdapterRegistry;
