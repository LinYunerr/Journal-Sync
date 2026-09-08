'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    collectTargets,
    dispatchSends,
    buildDiagTargets,
    buildSummary
} = require('../src/core/send-dispatcher');

// ── 测试用 stub plugin ────────────────────────────────────

function makePlugin({ adapters = {}, enabled = {}, tgConfig = {}, mastodonAccounts = {} } = {}) {
    const adapterSet = new Set(Object.keys(adapters));
    return {
        adapterRegistry: {
            has: (id) => adapterSet.has(id)
        },
        isAdapterEnabled: (id) => enabled[id] !== false,
        getAdapterConfig: (id) => (id === 'telegram' ? tgConfig : (adapters[id] || {})),
        getMastodonAccount: (id) => mastodonAccounts[id] || null,
        executeAdapter: async () => ({ success: true })
    };
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── collectTargets ────────────────────────────────────────

test('collectTargets filters out disabled platforms', () => {
    const plugin = makePlugin({
        adapters: { flomo: {}, misskey: {}, telegram: {} },
        enabled: { flomo: true, misskey: false, telegram: true },
        tgConfig: { channels: [] }
    });
    const { targetAdapters } = collectTargets({
        selectedTargets: ['flomo', 'misskey'],
        selectedTgChannels: [],
        selectedMastodonAccounts: [],
        plugin
    });
    assert.deepEqual(targetAdapters, ['flomo']);
});

test('collectTargets filters out adapters missing from registry', () => {
    const plugin = makePlugin({
        adapters: { flomo: {} },
        tgConfig: { channels: [] }
    });
    const { targetAdapters } = collectTargets({
        selectedTargets: ['flomo', 'notion'],
        selectedTgChannels: [],
        selectedMastodonAccounts: [],
        plugin
    });
    assert.deepEqual(targetAdapters, ['flomo']);
});

test('collectTargets filters stale telegram channels and reports them', () => {
    const plugin = makePlugin({
        adapters: { telegram: {} },
        tgConfig: { channels: [{ id: 'a' }, { id: 'b' }] }
    });
    const { tgChannels, staleTgChannelIds, targetAdapters } = collectTargets({
        selectedTargets: [],
        selectedTgChannels: ['a', 'gone', 'b', 'gone2'],
        selectedMastodonAccounts: [],
        plugin
    });
    assert.deepEqual(tgChannels, ['a', 'b']);
    assert.deepEqual(staleTgChannelIds, ['gone', 'gone2']);
    // 有生效频道时 telegram 占位被压入
    assert.ok(targetAdapters.includes('telegram'));
});

test('collectTargets drops all telegram channels when telegram disabled', () => {
    const plugin = makePlugin({
        adapters: { telegram: {} },
        enabled: { telegram: false },
        tgConfig: { channels: [{ id: 'a' }] }
    });
    const { tgChannels, targetAdapters } = collectTargets({
        selectedTargets: [],
        selectedTgChannels: ['a'],
        selectedMastodonAccounts: [],
        plugin
    });
    assert.deepEqual(tgChannels, []);
    assert.deepEqual(targetAdapters, []);
});

test('collectTargets keeps only existing mastodon accounts when enabled', () => {
    const plugin = makePlugin({
        adapters: { mastodon: {} },
        mastodonAccounts: {
            acct1: { serverUrl: 'https://m1.example', accessToken: 't1' },
            acct2: { serverUrl: 'https://m2.example', accessToken: 't2' }
        }
    });
    const { mstdAccountIds, targetAdapters } = collectTargets({
        selectedTargets: [],
        selectedTgChannels: [],
        selectedMastodonAccounts: ['acct1', 'acctX', 'acct2'],
        plugin
    });
    assert.deepEqual(mstdAccountIds, ['acct1', 'acct2']);
    assert.ok(targetAdapters.includes('mastodon'));
});

test('collectTargets drops mastodon accounts when mastodon disabled', () => {
    const plugin = makePlugin({
        adapters: { mastodon: {} },
        enabled: { mastodon: false },
        mastodonAccounts: { acct1: { serverUrl: 'https://m1.example' } }
    });
    const { mstdAccountIds, targetAdapters } = collectTargets({
        selectedTargets: [],
        selectedTgChannels: [],
        selectedMastodonAccounts: ['acct1'],
        plugin
    });
    assert.deepEqual(mstdAccountIds, []);
    assert.deepEqual(targetAdapters, []);
});

test('collectTargets returns empty for empty selections', () => {
    const plugin = makePlugin({ adapters: { flomo: {} }, tgConfig: { channels: [] } });
    const out = collectTargets({
        selectedTargets: [],
        selectedTgChannels: [],
        selectedMastodonAccounts: [],
        plugin
    });
    assert.deepEqual(out.targetAdapters, []);
    assert.deepEqual(out.tgChannels, []);
    assert.deepEqual(out.mstdAccountIds, []);
    assert.deepEqual(out.staleTgChannelIds, []);
});

// ── dispatchSends ─────────────────────────────────────────

test('generic adapters run in parallel', async () => {
    const events = [];
    const plugin = makePlugin();
    plugin.executeAdapter = async (adapterId) => {
        events.push({ adapterId, phase: 'start', t: Date.now() });
        await sleep(60);
        events.push({ adapterId, phase: 'end', t: Date.now() });
        return { success: true };
    };
    const results = await dispatchSends({
        plugin,
        payload: {},
        targetAdapters: ['flomo', 'misskey', 'notion'],
        tgChannels: [],
        mstdAccountIds: [],
        targetConfigOverrides: {}
    });
    assert.equal(Object.keys(results).length, 3);
    // 三个 start 都在任何 end 之前 → 并行
    const starts = events.filter(e => e.phase === 'start');
    const ends = events.filter(e => e.phase === 'end');
    for (const s of starts) {
        for (const e of ends) {
            assert.ok(s.t <= e.t, `adapter ${s.adapterId} start should precede end events`);
        }
    }
    assert.equal(starts.length, 3);
    assert.equal(ends.length, 3);
});

test('mastodon accounts run serially within the group', async () => {
    const events = [];
    const plugin = makePlugin({
        mastodonAccounts: {
            a1: { serverUrl: 'https://m1.example', accessToken: 't1' },
            a2: { serverUrl: 'https://m2.example', accessToken: 't2' },
            a3: { serverUrl: 'https://m3.example', accessToken: 't3' }
        }
    });
    plugin.executeAdapter = async (adapterId, payload, config) => {
        assert.equal(adapterId, 'mastodon');
        events.push({ phase: 'start', serverUrl: config.serverUrl });
        await sleep(40);
        events.push({ phase: 'end', serverUrl: config.serverUrl });
        return { success: true };
    };
    const results = await dispatchSends({
        plugin,
        payload: {},
        targetAdapters: [],
        tgChannels: [],
        mstdAccountIds: ['a1', 'a2', 'a3'],
        targetConfigOverrides: {}
    });
    assert.equal(Object.keys(results).length, 3);
    // 组内串行：start/end 交替，无重叠
    const phases = events.map(e => e.phase);
    assert.deepEqual(phases, ['start', 'end', 'start', 'end', 'start', 'end']);
});

test('mastodon accounts run in parallel with generic adapters and telegram', async () => {
    const events = [];
    const plugin = makePlugin({
        mastodonAccounts: {
            a1: { serverUrl: 'https://m1.example', accessToken: 't1' }
        }
    });
    plugin.executeAdapter = async (adapterId) => {
        events.push({ id: adapterId, phase: 'start', t: Date.now() });
        await sleep(60);
        events.push({ id: adapterId, phase: 'end', t: Date.now() });
        if (adapterId === 'telegram') {
            return { success: true, results: [{ channelId: 'ch1', success: true }] };
        }
        return { success: true };
    };
    const results = await dispatchSends({
        plugin,
        payload: {},
        targetAdapters: ['flomo'],
        tgChannels: ['ch1'],
        mstdAccountIds: ['a1'],
        targetConfigOverrides: { telegram: { channelIds: ['ch1'] } }
    });
    // 三组同时开始：所有 start 早于所有 end
    const starts = events.filter(e => e.phase === 'start');
    const ends = events.filter(e => e.phase === 'end');
    assert.equal(starts.length, 3);
    for (const s of starts) {
        for (const e of ends) {
            assert.ok(s.t <= e.t, `${s.id} start should precede end events`);
        }
    }
    assert.ok(results['flomo']);
    assert.ok(results['telegram']);
    assert.ok(results['mastodon:a1']);
});

test('telegram is a single call receiving channelIds override', async () => {
    const plugin = makePlugin();
    const calls = [];
    plugin.executeAdapter = async (adapterId, payload, config) => {
        calls.push({ adapterId, config });
        return { success: true, results: [] };
    };
    await dispatchSends({
        plugin,
        payload: {},
        targetAdapters: [],
        tgChannels: ['c1', 'c2'],
        mstdAccountIds: [],
        targetConfigOverrides: { telegram: { channelIds: ['c1', 'c2'] } }
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].adapterId, 'telegram');
    assert.deepEqual(calls[0].config.channelIds, ['c1', 'c2']);
});

test('no targets yields empty results', async () => {
    const plugin = makePlugin();
    const results = await dispatchSends({
        plugin,
        payload: {},
        targetAdapters: [],
        tgChannels: [],
        mstdAccountIds: [],
        targetConfigOverrides: {}
    });
    assert.deepEqual(results, {});
});

test('result keys match adapterId / telegram / mastodon:<acctId>', async () => {
    const plugin = makePlugin({
        mastodonAccounts: {
            acctA: { label: '主号', serverUrl: 'https://m.example', accessToken: 't' }
        }
    });
    plugin.executeAdapter = async (adapterId) => {
        if (adapterId === 'telegram') {
            return { success: true, results: [{ channelId: 'ch1', success: true }] };
        }
        return { success: true };
    };
    const results = await dispatchSends({
        plugin,
        payload: {},
        targetAdapters: ['flomo', 'notion'],
        tgChannels: ['ch1'],
        mstdAccountIds: ['acctA'],
        targetConfigOverrides: {}
    });
    assert.deepEqual(Object.keys(results), ['flomo', 'notion', 'telegram', 'mastodon:acctA']);
    assert.equal(results['mastodon:acctA'].displayLabel, '主号');
});

test('adapter throw is captured as { success: false, error }', async () => {
    const plugin = makePlugin({
        mastodonAccounts: {
            a1: { serverUrl: 'https://m.example', accessToken: 't' }
        }
    });
    plugin.executeAdapter = async (adapterId) => {
        if (adapterId === 'flomo') throw new Error('flomo down');
        if (adapterId === 'telegram') throw new Error('tg down');
        if (adapterId === 'mastodon') throw new Error('mstd down');
        return { success: true };
    };
    const results = await dispatchSends({
        plugin,
        payload: {},
        targetAdapters: ['flomo'],
        tgChannels: ['c1'],
        mstdAccountIds: ['a1'],
        targetConfigOverrides: { telegram: { channelIds: ['c1'] } }
    });
    assert.deepEqual(results['flomo'], { success: false, error: 'flomo down' });
    assert.deepEqual(results['telegram'], { success: false, error: 'tg down' });
    assert.deepEqual(results['mastodon:a1'], { success: false, error: 'mstd down', displayLabel: 'https://m.example' });
});

test('one failing adapter does not block other groups', async () => {
    const plugin = makePlugin();
    plugin.executeAdapter = async (adapterId) => {
        if (adapterId === 'flomo') throw new Error('boom');
        await sleep(20);
        return { success: true };
    };
    const results = await dispatchSends({
        plugin,
        payload: {},
        targetAdapters: ['flomo', 'misskey'],
        tgChannels: [],
        mstdAccountIds: [],
        targetConfigOverrides: {}
    });
    assert.equal(results['flomo'].success, false);
    assert.equal(results['misskey'].success, true);
});

test('missing mastodon account mid-dispatch is skipped', async () => {
    // 账号在收集与发送之间被删除的场景
    const accounts = { a1: { serverUrl: 'https://m.example' }, a2: { serverUrl: 'https://m2.example' } };
    const plugin = makePlugin({ mastodonAccounts: accounts });
    plugin.getMastodonAccount = (id) => accounts[id] || null;
    plugin.executeAdapter = async () => {
        // 第一个账号发送时删除第二个账号
        delete accounts.a2;
        return { success: true };
    };
    const results = await dispatchSends({
        plugin,
        payload: {},
        targetAdapters: [],
        tgChannels: [],
        mstdAccountIds: ['a1', 'a2'],
        targetConfigOverrides: {}
    });
    assert.ok(results['mastodon:a1']);
    assert.equal(results['mastodon:a2'], undefined);
});

test('collectTargets output piped into dispatchSends sends telegram/mastodon exactly once each', async () => {
    const plugin = makePlugin({
        adapters: { flomo: {}, telegram: {}, mastodon: {} },
        enabled: { flomo: true, telegram: true, mastodon: true },
        tgConfig: { channels: [{ id: 'c1' }, { id: 'c2' }] },
        mastodonAccounts: {
            a1: { serverUrl: 'https://m1.example', accessToken: 't1', visibility: 'public', label: 'acct1' }
        }
    });
    const calls = [];
    plugin.executeAdapter = async (adapterId, payload, config) => {
        calls.push({ adapterId, config });
        if (adapterId === 'telegram') return { success: true, results: [] };
        return { success: true };
    };
    const collected = collectTargets({
        selectedTargets: ['flomo'],
        selectedTgChannels: ['c1', 'c2'],
        selectedMastodonAccounts: ['a1'],
        plugin
    });
    const results = await dispatchSends({
        plugin,
        payload: {},
        targetAdapters: collected.targetAdapters,
        tgChannels: collected.tgChannels,
        mstdAccountIds: collected.mstdAccountIds,
        targetConfigOverrides: { telegram: { channelIds: ['c1', 'c2'] } }
    });
    // flomo / telegram / mastodon 各恰好一次，占位不进入通用循环造成重复发送
    assert.equal(calls.filter(c => c.adapterId === 'flomo').length, 1);
    assert.equal(calls.filter(c => c.adapterId === 'telegram').length, 1);
    assert.equal(calls.filter(c => c.adapterId === 'mastodon').length, 1);
    // 结果键不含占位 mastodon 假失败
    assert.deepEqual(Object.keys(results).sort(), ['flomo', 'mastodon:a1', 'telegram']);
});

// ── buildDiagTargets ──────────────────────────────────────

test('buildDiagTargets produces expected snapshot shape', () => {
    const targetAdapters = ['flomo', 'telegram', 'mastodon'];
    const mstdAccountIds = ['acctA'];
    const results = {
        flomo: { success: true },
        telegram: { success: false, results: [{ channelId: 'ch1', success: true }, { channelId: 'ch2', success: false, error: 'bad' }] },
        'mastodon:acctA': { success: true, skipped: true, displayLabel: '主号' }
    };
    const diagTargets = buildDiagTargets({ targetAdapters, mstdAccountIds, results });
    assert.deepEqual(diagTargets, [
        { kind: 'adapter', id: 'flomo', label: 'flomo', success: true, error: null, durationMs: null },
        { kind: 'telegram-channel', id: 'ch1', label: 'telegram ch1', success: true, error: null, durationMs: null },
        { kind: 'telegram-channel', id: 'ch2', label: 'telegram ch2', success: false, error: 'bad', durationMs: null },
        { kind: 'mastodon-account', id: 'acctA', label: '主号', success: false, error: null, durationMs: null }
    ]);
});

// ── buildSummary ──────────────────────────────────────────

test('buildSummary formats success, skip, failure, warnings and telegram channels', () => {
    const results = {
        flomo: { success: true },
        misskey: { success: true, warnings: ['图片压缩'] },
        notion: { success: true, skipped: true },
        bluesky: { success: false, error: 'net error' },
        telegram: { success: true, results: [
            { channelId: 'ch1', success: true },
            { channelId: 'ch2', success: false, error: 'forbidden' }
        ] },
        'mastodon:acctA': { success: true, displayLabel: '主号' }
    };
    const summary = buildSummary(results);
    assert.deepEqual(summary.split('；\n'), [
        'flomo: 成功',
        'misskey: 成功（图片压缩）',
        'notion: 跳过',
        'bluesky: 失败(net error)',
        'Telegram ch1: 成功',
        'Telegram ch2: 失败(forbidden)',
        '主号: 成功'
    ]);
});

test('buildSummary uses key id when no displayLabel', () => {
    assert.equal(buildSummary({ weibo: { success: false, error: null } }), 'weibo: 失败(发送未知错误)');
});
