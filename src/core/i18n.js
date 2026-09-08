/**
 * i18n 引擎（纯模块，不依赖 obsidian，便于单元测试）。
 *
 * 策略：以中文原文作为 key。中文是恒等（key 即译文），英文走 en 字典映射。
 * 这样 manifest 结构零改动——通用渲染器只需把 field.label/desc/buttonLabel 包进 t()。
 *
 * 语言由 main.js 在 onload 及语言设置变更时解析后注入：
 *   setLanguage('zh' | 'en')
 * 'auto' 的解析（跟随 Obsidian getLanguage()）在 main.js 完成，本模块只接收具体语言。
 *
 * 插值：t('会发一条「{name}」笔记', { name }) —— 用 {var} 占位。
 */

let currentLang = 'zh';

/** 英文字典：中文 key → 英文译文。由各文件替换时增量登记。 */
const en = {};

/**
 * 注册某语言的翻译条目（增量合并）。
 * 各适配器文件可在模块加载时调用 registerTranslations('en', { '中文': 'English' })，
 * 避免所有翻译集中在 i18n.js 造成多文件并发修改冲突，也符合适配器隔离原则。
 * @param {'en'} lang 目前仅支持 'en'
 * @param {object} dict 中文 key → 译文
 */
function registerTranslations(lang, dict) {
  if (lang !== 'en' || !dict || typeof dict !== 'object') return;
  for (const key of Object.keys(dict)) {
    en[key] = dict[key];
  }
}

/**
 * 设置当前语言（'zh' | 'en'）。其它值一律回退中文。
 */
function setLanguage(lang) {
  currentLang = lang === 'en' ? 'en' : 'zh';
}

function getEffectiveLanguage() {
  return currentLang;
}

/**
 * 取当前语言下的译文。中文恒等；英文查字典，缺失回退原文（中文）。
 * @param {string} key 中文原文
 * @param {object} [vars] 插值变量 {name: '...'}
 */
function t(key, vars) {
  let str = key;
  if (currentLang === 'en' && Object.prototype.hasOwnProperty.call(en, key)) {
    str = en[key];
  }
  if (vars) {
    // 单趟替换：变量值中若含其它占位符（如文件名里恰好出现 "{suffix}"），
    // 也不会被后续轮次二次替换。顺序逐个 split/join 的写法有此注入风险。
    str = str.replace(/\{(\w+)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
    ));
  }
  return str;
}

module.exports = { t, setLanguage, getEffectiveLanguage, registerTranslations };