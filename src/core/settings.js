/**
 * 设置深度合并（纯函数）。
 *
 * 语义（升级时用户已有设置不被重置）：
 * - 用户的非空数组永不吸收默认数组（仅当用户值为空数组或缺失时才用默认值）
 * - 用户的空字符串 / null / undefined 标量会被默认值补上（有意的升级行为）
 * - 对象递归合并
 */

'use strict';

function deepMergeSettings(target, source) {
    if (!target || typeof target !== 'object') target = {};
    if (!source || typeof source !== 'object') return target;

    for (const key of Object.keys(source)) {
        const sourceVal = source[key];
        const targetVal = target[key];

        if (Array.isArray(sourceVal)) {
            if (!Array.isArray(targetVal) || targetVal.length === 0) {
                target[key] = JSON.parse(JSON.stringify(sourceVal));
            }
        } else if (sourceVal && typeof sourceVal === 'object') {
            if (!targetVal || typeof targetVal !== 'object') target[key] = {};
            deepMergeSettings(target[key], sourceVal);
        } else {
            if (targetVal === undefined || targetVal === '' || targetVal === null) {
                target[key] = sourceVal;
            }
        }
    }
    return target;
}

module.exports = { deepMergeSettings };