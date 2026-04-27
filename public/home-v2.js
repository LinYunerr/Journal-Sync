const SENSITIVE_VALUE_MASK = '__SECRET_PRESENT__';
const SENSITIVE_INPUT_PLACEHOLDER = 'sk-xxxx-xxxx-xxxx';
const AI_API_TYPE_CHAT = 'chat_completions';
const AI_API_TYPE_RESPONSES = 'responses';

const state = {
    plugins: [],
    simpleTargets: [],
    simpleToggleMap: {},
    saveLocalToggleMap: {},
    workflowPanelLinks: {},
    inputMedia: {
        images: [],
        count: 0,
        maxImages: 9
    },
    tgInputModeEnabled: false,
    tgOptions: {
        showLinkPreview: true,
        boldFirstLine: false,
        appendSourceTag: false,
        addLineBreakPerLine: false
    },
    tgFormatting: {
        markdownContent: '',
        telegramContent: '',
        sourceUrl: '',
        generatedFrom: '',
        boldFirstLineApplied: false
    },
    tgChannels: [],
    tgChannelSelection: {},
    modal: {
        activeKey: 'general',
        pluginRegistry: [],
        pluginDrafts: {},
        pluginFieldErrors: {},
        general: {
            ai: {
                apiType: AI_API_TYPE_CHAT,
                baseUrl: '',
                apiKey: '',
                model: ''
            },
            networkProxy: ''
        },
        networkProxySaved: ''
    }
};

const contentInput = document.getElementById('v2ContentInput');
const imagePreviewGrid = document.getElementById('v2ImagePreviewGrid');
const imageUploadStatus = document.getElementById('v2ImageUploadStatus');
const imagePreviewModal = document.getElementById('imagePreviewModalV2');
const imagePreviewModalImg = document.getElementById('imagePreviewModalImgV2');
const closeImagePreviewBtn = document.getElementById('closeImagePreviewBtnV2');
const editPluginHint = document.getElementById('editPluginHint');
const simpleTargetRows = document.getElementById('simpleTargetRows');
const saveLocalRows = document.getElementById('saveLocalRows');
const sendSimpleBtn = document.getElementById('sendSimpleBtn');
const saveLocalBtn = document.getElementById('saveLocalBtnV2');
const simplePublishStatus = document.getElementById('simplePublishStatus');
const saveLocalStatus = document.getElementById('saveLocalStatus');
const tgInputModeBtn = document.getElementById('tgInputModeBtn');
const tgInputWorkspace = document.getElementById('tgInputWorkspace');
const generateTgLocalBtn = document.getElementById('generateTgLocalBtn');
const tgFormattedOutput = document.getElementById('tgFormattedOutputV2');
const tgFormattedPreview = document.getElementById('tgFormattedPreviewV2');
const tgAdvancedPanel = document.getElementById('tgAdvancedPanelV2');
const tgChannelRows = document.getElementById('tgChannelRows');
const tgMediaHint = document.getElementById('tgMediaHintV2');
const workflowLinkToggles = Array.from(document.querySelectorAll('[data-workflow-link]'));

const openPluginCenterBtn = document.getElementById('openPluginCenterBtn');
const pluginCenterModal = document.getElementById('pluginCenterModal');
const pluginCenterBackdrop = document.getElementById('pluginCenterBackdrop');
const closePluginCenterBtn = document.getElementById('closePluginCenterBtn');
const settingsNavList = document.getElementById('settingsNavList');
const settingsDetail = document.getElementById('settingsDetail');
const settingsAlert = document.getElementById('settingsAlert');
const GlobalInputTraits = window.GlobalInputTraits || {
    mountAutoGrowTextarea: () => null
};
const createInputMediaBridge = window.createInputMediaBridge || null;
const HOME_V2_DRAFT_ENDPOINT = '/api/home-v2-draft';
const HOME_V2_DRAFT_DEBOUNCE_MS = 400;
const WORKFLOW_PANEL_LINK_STORAGE_KEY = 'journal-sync-home-v2-workflow-panel-links';
const WORKFLOW_PANEL_LINKS = [
    {
        id: 'publish-save',
        panels: ['publish', 'save']
    }
];

let inputMediaBridge = null;
let draftSyncTimer = null;
let isApplyingServerDraft = false;
let lastSavedDraftSignature = '';
const workflowPanelActions = new Map();

function buildDraftImageState(imageFilenames = []) {
    return (Array.isArray(imageFilenames) ? imageFilenames : [])
        .filter(Boolean)
        .map(filename => ({
            filename,
            previewUrl: '/api/image-cache/' + encodeURIComponent(filename)
        }));
}

function buildCurrentHomeDraft() {
    return {
        content: String(contentInput?.value || '').replace(/\r\n/g, '\n'),
        imageFilenames: getPendingImageFilenames()
    };
}

function getHomeDraftSignature(draft = {}) {
    return JSON.stringify({
        content: String(draft.content || '').replace(/\r\n/g, '\n'),
        imageFilenames: Array.isArray(draft.imageFilenames) ? draft.imageFilenames : []
    });
}

function syncInputDependentPanels() {
    renderSimpleTargets();
    renderSaveLocalTargets();
    loadTelegramChannelOptions();
}

async function persistHomeDraft() {
    if (isApplyingServerDraft) return;

    const draft = buildCurrentHomeDraft();
    const signature = getHomeDraftSignature(draft);
    if (signature === lastSavedDraftSignature) {
        return;
    }

    const requestOptions = (!draft.content.trim() && draft.imageFilenames.length === 0)
        ? { method: 'DELETE' }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft)
        };

    const response = await fetch(HOME_V2_DRAFT_ENDPOINT, requestOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
        throw new Error(data.error || ('HTTP ' + response.status));
    }

    lastSavedDraftSignature = signature;
}

function scheduleHomeDraftSync() {
    if (isApplyingServerDraft) return;
    window.clearTimeout(draftSyncTimer);
    draftSyncTimer = window.setTimeout(() => {
        persistHomeDraft().catch((error) => {
            console.error('[HomeV2Draft] 同步失败:', error);
        });
    }, HOME_V2_DRAFT_DEBOUNCE_MS);
}

async function restoreHomeDraft() {
    const response = await fetch(HOME_V2_DRAFT_ENDPOINT);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
        throw new Error(data.error || ('HTTP ' + response.status));
    }

    const draft = data?.draft || {};
    isApplyingServerDraft = true;
    try {
        if (contentInput) {
            contentInput.value = typeof draft.content === 'string' ? draft.content : '';
            GlobalInputTraits.refreshAutoGrowTextarea?.('homeV2ContentInput');
        }
        inputMediaBridge?.setImages(buildDraftImageState(draft.imageFilenames), { notify: true });
        state.inputMedia = inputMediaBridge?.getState?.() || state.inputMedia;
        lastSavedDraftSignature = getHomeDraftSignature({
            content: contentInput?.value || '',
            imageFilenames: getPendingImageFilenames()
        });
    } finally {
        isApplyingServerDraft = false;
    }
}

function setStatus(el, message, type = '') {
    el.textContent = message || '';
    el.classList.remove('ok', 'error');
    if (type) {
        el.classList.add(type);
    }
}

function readWorkflowPanelLinks() {
    let savedLinks = {};
    try {
        savedLinks = JSON.parse(window.localStorage.getItem(WORKFLOW_PANEL_LINK_STORAGE_KEY) || '{}') || {};
    } catch (error) {
        savedLinks = {};
    }

    for (const link of WORKFLOW_PANEL_LINKS) {
        state.workflowPanelLinks[link.id] = Boolean(savedLinks[link.id]);
    }
}

function persistWorkflowPanelLinks() {
    try {
        window.localStorage.setItem(WORKFLOW_PANEL_LINK_STORAGE_KEY, JSON.stringify(state.workflowPanelLinks));
    } catch (error) {
        console.error('[WorkflowLinks] 保存联动状态失败:', error);
    }
}

function renderWorkflowPanelLinks() {
    for (const toggle of workflowLinkToggles) {
        const linkId = toggle.dataset.workflowLink;
        const isLinked = Boolean(state.workflowPanelLinks[linkId]);
        toggle.classList.toggle('linked', isLinked);
        toggle.setAttribute('aria-pressed', isLinked ? 'true' : 'false');
        toggle.title = isLinked ? '取消联动发布部分和保存部分' : '联动发布部分和保存部分';
    }
}

function setWorkflowPanelLinkActive(linkId, active) {
    if (!WORKFLOW_PANEL_LINKS.some(link => link.id === linkId)) return;
    state.workflowPanelLinks[linkId] = Boolean(active);
    persistWorkflowPanelLinks();
    renderWorkflowPanelLinks();
}

function getLinkedWorkflowPanelIds(panelId) {
    const linkedPanelIds = [];
    for (const link of WORKFLOW_PANEL_LINKS) {
        if (!state.workflowPanelLinks[link.id] || !link.panels.includes(panelId)) continue;
        linkedPanelIds.push(...link.panels.filter(item => item !== panelId));
    }
    return [...new Set(linkedPanelIds)];
}

function getWorkflowPanelIdForAction(actionEl) {
    return actionEl?.closest?.('[data-workflow-panel]')?.dataset?.workflowPanel || '';
}

function getWorkflowPanelPrimaryAction(panelId) {
    return document.querySelector(`[data-workflow-panel="${panelId}"] [data-workflow-action="primary"]`);
}

function registerWorkflowPanelAction(panelId, handler) {
    if (!panelId || typeof handler !== 'function') return;
    workflowPanelActions.set(panelId, handler);
}

async function runWorkflowPanelAction(panelId, visited = new Set()) {
    if (!panelId || visited.has(panelId)) return;
    const handler = workflowPanelActions.get(panelId);
    if (!handler) return;

    const primaryAction = getWorkflowPanelPrimaryAction(panelId);
    if (primaryAction?.disabled) return;

    visited.add(panelId);
    await handler();

    const linkedPanelIds = getLinkedWorkflowPanelIds(panelId);
    for (const linkedPanelId of linkedPanelIds) {
        await runWorkflowPanelAction(linkedPanelId, visited);
    }
}

function initializeWorkflowPanelLinks() {
    readWorkflowPanelLinks();
    renderWorkflowPanelLinks();

    for (const toggle of workflowLinkToggles) {
        toggle.addEventListener('click', () => {
            const linkId = toggle.dataset.workflowLink;
            setWorkflowPanelLinkActive(linkId, !state.workflowPanelLinks[linkId]);
        });
    }
}

function ensureMainInputTraits() {
    const mount = (key, textarea) => {
        if (!textarea) return;
        GlobalInputTraits.mountAutoGrowTextarea(key, textarea, {
            reserveLines: 2
        });
    };

    mount('homeV2ContentInput', contentInput);
    mount('homeV2TgFormattedOutput', tgFormattedOutput);
}

function hasPendingImages() {
    return Number(state.inputMedia?.count || 0) > 0;
}

function getPendingImageFilenames() {
    return Array.isArray(state.inputMedia?.images)
        ? state.inputMedia.images.map(item => item.filename).filter(Boolean)
        : [];
}

function getFirstNonEmptyLineIndex(lines) {
    for (let index = 0; index < lines.length; index += 1) {
        if (String(lines[index] || '').trim()) {
            return index;
        }
    }
    return -1;
}

function appendInlineTokenToLastLine(content, token) {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) return String(content || '').trim();

    const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = String(lines[index] || '');
        if (!line.trim()) continue;
        lines[index] = `${line.replace(/\s+$/g, '')} ${normalizedToken}`;
        return lines.join('\n').trim();
    }
    return normalizedToken;
}

function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildEquivalentSourceUrlPatterns(sourceUrl, { markdown = false } = {}) {
    const normalizedUrl = normalizeSourceUrl(sourceUrl);
    if (!normalizedUrl) return [];

    const patterns = [escapeRegExp(normalizedUrl)];
    if (normalizedUrl.toLowerCase().includes('bilibili')) {
        const bvMatch = normalizedUrl.match(/BV[0-9A-Za-z]{10}/);
        if (bvMatch) {
            const tailExclusions = markdown ? `\\s<>"')` : `\\s<>"'`;
            patterns.push(`https?:\\/\\/(?:www\\.)?bilibili\\.com\\/video\\/${escapeRegExp(bvMatch[0])}\\/?(?:[?#][^${tailExclusions}]*)?`);
        }
    }

    return [...new Set(patterns)];
}

function stripTrailingSourceArtifacts(content, sourceUrl) {
    const normalizedContent = String(content || '');
    const normalizedUrl = normalizeSourceUrl(sourceUrl);
    if (!normalizedContent.trim() || !normalizedUrl) {
        return { content: normalizedContent, stripped: false };
    }

    const markdownUrlPatterns = buildEquivalentSourceUrlPatterns(normalizedUrl, { markdown: true });
    const inlineUrlPatterns = buildEquivalentSourceUrlPatterns(normalizedUrl);
    const patterns = [
        ...markdownUrlPatterns.map(pattern => new RegExp(`(?:\\s|^)\\[source\\]\\(${pattern}\\)\\s*$`, 'i')),
        ...inlineUrlPatterns.map(pattern => new RegExp(`(?:\\s|^)(?:source)\\s*[:：]?\\s*(?:\\n\\s*)?${pattern}\\s*$`, 'i')),
        ...inlineUrlPatterns.map(pattern => new RegExp(`(?:\\s|^)${pattern}\\s*$`, 'i'))
    ];

    let strippedContent = normalizedContent;
    let stripped = false;

    while (true) {
        let changed = false;
        for (const pattern of patterns) {
            const next = strippedContent.replace(pattern, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
            if (next !== strippedContent) {
                strippedContent = next;
                stripped = true;
                changed = true;
                break;
            }
        }
        if (!changed) break;
    }

    return {
        content: strippedContent,
        stripped
    };
}

function hasTrailingMarkdownSourceLink(content, sourceUrl) {
    const normalizedContent = String(content || '').trim();
    const normalizedUrl = normalizeSourceUrl(sourceUrl);
    if (!normalizedContent || !normalizedUrl) return false;
    return new RegExp(`\\[source\\]\\(${escapeRegExp(normalizedUrl)}\\)\\s*$`, 'i').test(normalizedContent);
}

function replaceTrailingMarkdownSourceLinkWithToken(content, sourceUrl, token) {
    const normalizedContent = String(content || '');
    const normalizedUrl = normalizeSourceUrl(sourceUrl);
    const normalizedToken = String(token || '');
    if (!normalizedContent.trim() || !normalizedUrl || !normalizedToken) {
        return { content: normalizedContent, replaced: false };
    }

    const pattern = new RegExp(`\\[source\\]\\(${escapeRegExp(normalizedUrl)}\\)\\s*$`, 'i');
    if (!pattern.test(normalizedContent.trim())) {
        return { content: normalizedContent, replaced: false };
    }

    return {
        content: normalizedContent.replace(pattern, normalizedToken),
        replaced: true
    };
}

function ensureTrailingMarkdownSource(content, sourceUrl) {
    const normalizedContent = String(content || '').trim();
    const normalizedUrl = normalizeSourceUrl(sourceUrl);
    if (!normalizedContent || !normalizedUrl) return normalizedContent;

    const sourceToken = `[source](${normalizedUrl})`;
    if (hasTrailingMarkdownSourceLink(normalizedContent, normalizedUrl)) {
        return normalizedContent;
    }

    const stripped = stripTrailingSourceArtifacts(normalizedContent, normalizedUrl);
    const baseContent = stripped.content.trim();
    return appendInlineTokenToLastLine(baseContent, sourceToken);
}

function buildPreviewContentWithSource(content, sourceUrl, placeholder) {
    const normalizedContent = String(content || '').trim();
    const normalizedUrl = normalizeSourceUrl(sourceUrl);
    if (!normalizedContent || !normalizedUrl) return normalizedContent;

    const rewrittenMarkdown = replaceTrailingMarkdownSourceLinkWithToken(normalizedContent, normalizedUrl, placeholder);
    if (rewrittenMarkdown.replaced) {
        return rewrittenMarkdown.content.trim();
    }

    const stripped = stripTrailingSourceArtifacts(normalizedContent, normalizedUrl);
    return appendInlineTokenToLastLine(stripped.content.trim(), placeholder);
}

function applyLineBreakPerLine(content) {
    const normalized = String(content || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return '';
    if (!state.tgOptions.addLineBreakPerLine) return normalized;

    const lines = normalized.split('\n');
    const output = [];

    for (let index = 0; index < lines.length; index += 1) {
        const currentLine = String(lines[index] || '');
        output.push(currentLine);

        if (!currentLine.trim()) continue;
        if (index >= lines.length - 1) continue;
        const nextLine = String(lines[index + 1] || '');
        if (!nextLine.trim()) continue;
        output.push('');
    }

    return output.join('\n').trim();
}

function unwrapMarkdownBoldLine(line) {
    const rawLine = String(line || '');
    const match = rawLine.match(/^(\s*)\*\*(\S[\s\S]*?\S|\S)\*\*(\s*)$/);
    if (!match) {
        return { line: rawLine, unwrapped: false };
    }

    return {
        line: `${match[1]}${match[2]}${match[3]}`,
        unwrapped: true
    };
}

function buildTgFormattedPayload(rawContent) {
    const normalizedInput = String(rawContent || '').replace(/\r\n/g, '\n').trim();
    const lineBrokenContent = applyLineBreakPerLine(normalizedInput);
    const lines = lineBrokenContent.split('\n');
    const firstNonEmptyIndex = getFirstNonEmptyLineIndex(lines);
    const sourceUrl = normalizeSourceUrl(extractLastHttpsUrl(normalizedInput));
    let firstLineMarkdownBold = false;

    if (firstNonEmptyIndex >= 0) {
        const unwrapped = unwrapMarkdownBoldLine(lines[firstNonEmptyIndex]);
        lines[firstNonEmptyIndex] = unwrapped.line;
        firstLineMarkdownBold = unwrapped.unwrapped;
    }

    const markdownLines = [...lines];
    const boldFirstLineApplied = Boolean(state.tgOptions.boldFirstLine || firstLineMarkdownBold);

    let markdownContent = markdownLines.join('\n').trim();
    if (state.tgOptions.appendSourceTag && sourceUrl) {
        markdownContent = ensureTrailingMarkdownSource(markdownContent, sourceUrl);
    }

    return {
        markdownContent,
        telegramContent: lines.join('\n').trim(),
        sourceUrl,
        generatedFrom: normalizedInput,
        boldFirstLineApplied
    };
}

function renderTgFormattedPreview() {
    if (!tgFormattedPreview) return;

    const markdownContent = state.tgFormatting.markdownContent || '';
    if (!markdownContent) {
        tgFormattedPreview.innerHTML = '<span class="tg-preview-muted">暂无预览，点击“生成TG发布格式”后显示。</span>';
        return;
    }

    const previewPlaceholder = '__TG_SOURCE_LINK__';
    const previewContent = state.tgOptions.appendSourceTag && state.tgFormatting.sourceUrl
        ? buildPreviewContentWithSource(state.tgFormatting.telegramContent || '', state.tgFormatting.sourceUrl, previewPlaceholder)
        : (state.tgFormatting.telegramContent || '');
    const lines = previewContent.split('\n');
    const firstNonEmptyIndex = getFirstNonEmptyLineIndex(lines);
    const previewLines = lines.map((line, index) => {
        let escaped = escapeHtml(line);
        if (escaped.includes(previewPlaceholder)) {
            const safeUrl = escapeHtml(state.tgFormatting.sourceUrl);
            const sourceLink = `<a href="${safeUrl}" target="_blank" rel="noreferrer">source</a>`;
            escaped = escaped.replaceAll(previewPlaceholder, sourceLink);
        }
        if (state.tgFormatting.boldFirstLineApplied && index === firstNonEmptyIndex) {
            return `<strong>${escaped}</strong>`;
        }
        return escaped;
    });

    let html = `<div>${previewLines.join('<br>')}</div>`;
    if (state.tgOptions.showLinkPreview && state.tgFormatting.sourceUrl) {
        const safeUrl = escapeHtml(state.tgFormatting.sourceUrl);
        html += `<div class="tg-link-preview">网址预览：<a href="${safeUrl}" target="_blank" rel="noreferrer">${safeUrl}</a></div>`;
    }

    tgFormattedPreview.innerHTML = html;
}

function setTgInputMode(enabled) {
    state.tgInputModeEnabled = Boolean(enabled);
    tgInputModeBtn.classList.toggle('active', state.tgInputModeEnabled);
    tgInputModeBtn.setAttribute('aria-pressed', state.tgInputModeEnabled ? 'true' : 'false');
    tgInputWorkspace.classList.toggle('hidden', !state.tgInputModeEnabled);
    if (!state.tgInputModeEnabled) {
        return;
    }
    renderTgFormattedPreview();
}

function regenerateLocalTgFormat({ silent = false } = {}) {
    const content = (contentInput.value || '').trim();
    if (!content) {
        if (!silent) {
            setStatus(simplePublishStatus, '请先输入内容', 'error');
        }
        state.tgFormatting = {
            markdownContent: '',
            telegramContent: '',
            sourceUrl: '',
            generatedFrom: '',
            boldFirstLineApplied: false
        };
        if (tgFormattedOutput) {
            tgFormattedOutput.value = '';
        }
        renderTgFormattedPreview();
        return false;
    }

    state.tgFormatting = buildTgFormattedPayload(content);
    if (tgFormattedOutput) {
        tgFormattedOutput.value = state.tgFormatting.markdownContent;
    }
    renderTgFormattedPreview();

    if (!silent) {
        setStatus(simplePublishStatus, 'TG 本地格式已生成', 'ok');
    }
    return true;
}

function isTgFormattingAppliedForCurrentInput() {
    if (!state.tgInputModeEnabled) return false;
    const raw = (contentInput.value || '').trim();
    if (!raw) return false;
    if (!state.tgFormatting.generatedFrom) return false;
    if (state.tgFormatting.generatedFrom !== raw) return false;
    return Boolean(state.tgFormatting.telegramContent || state.tgFormatting.markdownContent);
}

function getCurrentContent({ channel = 'pipeline' } = {}) {
    const raw = (contentInput.value || '').trim();
    if (!state.tgInputModeEnabled) return raw;
    if (!state.tgFormatting.markdownContent || state.tgFormatting.generatedFrom !== raw) {
        return raw;
    }
    if (channel === 'telegram') {
        return state.tgFormatting.telegramContent || raw;
    }
    return state.tgFormatting.markdownContent || raw;
}

function getCurrentSourceUrlForTgPublish() {
    if (!state.tgOptions.appendSourceTag) return '';
    const raw = (contentInput.value || '').trim();
    if (state.tgInputModeEnabled && state.tgFormatting.generatedFrom === raw) {
        return state.tgFormatting.sourceUrl || '';
    }
    return normalizeSourceUrl(extractLastHttpsUrl(raw));
}

function trimTrailingUrlPunctuation(url) {
    return (url || '').replace(/[)\],.!?;:，。！？；：》」』】）]+$/g, '');
}

function extractLastHttpsUrl(content) {
    const text = String(content || '');
    let cursor = text.length;

    while (cursor > 0) {
        const httpsIndex = text.lastIndexOf('https', cursor - 1);
        if (httpsIndex < 0) return '';

        const candidate = text.slice(httpsIndex);
        const match = candidate.match(/^https:\/\/[^\s<>"']+/i);
        if (match) {
            return trimTrailingUrlPunctuation(match[0]);
        }

        cursor = httpsIndex;
    }

    return '';
}

function normalizeSourceUrl(rawUrl) {
    const url = (rawUrl || '').trim();
    if (!url) return '';
    if (url.toLowerCase().includes('bilibili')) {
        const bvMatch = url.match(/BV[0-9A-Za-z]{10}/);
        if (bvMatch) {
            return `https://www.bilibili.com/video/${bvMatch[0]}`;
        }
    }
    return url;
}

function normalizeAiApiType(rawApiType) {
    const normalized = String(rawApiType || '').trim().toLowerCase();
    return normalized === AI_API_TYPE_RESPONSES ? AI_API_TYPE_RESPONSES : AI_API_TYPE_CHAT;
}

function getAiApiSuffix(rawApiType) {
    return normalizeAiApiType(rawApiType) === AI_API_TYPE_RESPONSES
        ? '/responses'
        : '/chat/completions';
}

function stripAiEndpointSuffix(rawBaseUrl) {
    const base = String(rawBaseUrl || '').trim();
    if (!base) return '';
    return base.replace(/\/(chat\/completions|responses)\/?$/i, '');
}

function getAiApiTypeOptionsHtml(currentType) {
    const current = normalizeAiApiType(currentType);
    return `
        <option value="${AI_API_TYPE_CHAT}" ${current === AI_API_TYPE_CHAT ? 'selected' : ''}>chat/completions</option>
        <option value="${AI_API_TYPE_RESPONSES}" ${current === AI_API_TYPE_RESPONSES ? 'selected' : ''}>responses</option>
    `;
}

function cloneValue(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getValueAtPath(target, path) {
    return path.split('.').reduce((current, segment) => {
        if (current == null) return undefined;
        return current[segment];
    }, target);
}

function setValueAtPath(target, path, value) {
    const segments = path.split('.');
    let current = target;
    for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        if (typeof current[segment] !== 'object' || current[segment] === null || Array.isArray(current[segment])) {
            current[segment] = {};
        }
        current = current[segment];
    }
    current[segments[segments.length - 1]] = value;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getPluginById(pluginId) {
    return state.plugins.find(plugin => plugin.id === pluginId) || null;
}

function getHomeV2FallbackSection(plugin) {
    const rawId = String(plugin?.id || '').trim().toLowerCase();
    const rawName = String(plugin?.name || plugin?.manifest?.name || '').trim().toLowerCase();

    const id = rawId || rawName;
    if (id === 'flomo') return 'publish_simple';
    if (id === 'mastodon' || id === 'cmx') return 'publish_simple';
    if (id === 'missky' || id === 'misskey') return 'publish_simple';
    if (id === 'telegram' || id === 'tg') return 'publish_advanced';
    if (id === 'obsidian-local' || id === 'obsidian') return 'save_local';
    return '';
}

function getHomeV2Meta(plugin) {
    const homeV2 = plugin?.manifest?.ui?.homeV2;
    if (!homeV2 || typeof homeV2 !== 'object') {
        const fallbackSection = getHomeV2FallbackSection(plugin);
        if (!fallbackSection) return null;
        return {
            section: fallbackSection,
            order: 100,
            label: (plugin?.manifest?.name || plugin?.name || plugin?.id || '').trim()
        };
    }

    const normalizedSection = typeof homeV2.section === 'string' && homeV2.section.trim()
        ? homeV2.section.trim()
        : getHomeV2FallbackSection(plugin);

    if (!normalizedSection) return null;

    return {
        section: normalizedSection,
        order: Number.isFinite(Number(homeV2.order)) ? Number(homeV2.order) : 100,
        label: typeof homeV2.label === 'string' && homeV2.label.trim()
            ? homeV2.label.trim()
            : (plugin?.manifest?.name || plugin?.name || plugin?.id)
    };
}

function sortPluginsByHomeOrder(plugins) {
    return [...plugins].sort((a, b) => {
        const aMeta = getHomeV2Meta(a);
        const bMeta = getHomeV2Meta(b);
        const aOrder = aMeta?.order ?? 100;
        const bOrder = bMeta?.order ?? 100;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return String(a.id).localeCompare(String(b.id));
    });
}

function getPluginsBySection(section, { enabledOnly = false } = {}) {
    return sortPluginsByHomeOrder(
        state.plugins.filter(plugin => {
            const homeV2 = getHomeV2Meta(plugin);
            return homeV2?.section === section && (!enabledOnly || Boolean(plugin.enabled));
        })
    );
}

function getUnifiedPublishTargets() {
    const merged = [
        ...getPluginsBySection('publish_simple', { enabledOnly: true }),
        ...getPluginsBySection('publish_advanced', { enabledOnly: true })
    ];
    const seen = new Set();
    const deduped = [];

    for (const plugin of merged) {
        if (!plugin || plugin.id === 'telegram') continue;
        if (seen.has(plugin.id)) continue;
        seen.add(plugin.id);
        deduped.push(plugin);
    }

    return sortPluginsByHomeOrder(deduped);
}

function hasEnabledTelegramPlugin() {
    return Boolean(getPluginById('telegram')?.enabled);
}

function refreshPublishButtonState() {
    sendSimpleBtn.disabled = state.simpleTargets.length === 0 && !hasEnabledTelegramPlugin();
}

function getPluginMediaMeta(plugin) {
    const media = plugin?.manifest?.capabilities?.media;
    if (!media || typeof media !== 'object') return null;
    return media;
}

function getPluginImageInputDescription(plugin) {
    const media = getPluginMediaMeta(plugin);
    if (!media) return '';
    const maxImages = Number.isFinite(Number(media.maxImages)) && Number(media.maxImages) > 0
        ? Number(media.maxImages)
        : null;

    if (media.acceptsInputImages === false) {
        if (String(media.mode || '').trim() === 'public_urls' && maxImages) {
            return `该插件不接收主页本地图片输入；正文中的公网图片 URL 一次最多 ${maxImages} 张。`;
        }
        return '该插件不接收主页图片输入。';
    }

    if (maxImages) {
        return `该插件一次最多输入 ${maxImages} 张图片。`;
    }

    return '该插件可以接收主页图片输入。';
}

function canPluginTransferInputImages(plugin) {
    const media = getPluginMediaMeta(plugin);
    if (!media) return false;
    if (typeof media.acceptsInputImages === 'boolean') {
        return media.acceptsInputImages;
    }
    if (media.acceptsImages === false) return false;
    return !['public_urls', 'metadata'].includes(String(media.mode || '').trim());
}

function getPluginImageStatus(plugin) {
    if (!hasPendingImages()) return null;

    const imageCount = Number(state.inputMedia?.count || 0);
    if (imageCount <= 0) return null;
    if (!canPluginTransferInputImages(plugin)) {
        return {
            label: '无图片',
            state: 'none'
        };
    }

    const media = getPluginMediaMeta(plugin);
    const maxImages = Number.isFinite(Number(media?.maxImages)) && Number(media.maxImages) > 0
        ? Number(media.maxImages)
        : imageCount;

    if (imageCount > maxImages) {
        return {
            label: `上传前${maxImages}张图`,
            state: 'partial'
        };
    }

    return {
        label: `上传${imageCount}张图`,
        state: 'all'
    };
}

function describePluginToggle(plugin, section) {
    const defaultSubLabel = section === 'save_local'
        ? '点击切换保存时是否执行'
        : '点击切换当前发送';
    const imageStatus = getPluginImageStatus(plugin);

    return {
        subLabel: defaultSubLabel,
        note: '',
        mediaChip: imageStatus ? {
            label: imageStatus.label,
            mode: imageStatus.state
        } : null
    };
}

function createPluginToggleBlock({
    label,
    subLabel,
    note,
    active,
    locked,
    onToggle,
    mediaChip,
    blockClass = '',
    titleClass = '',
    subLabelClass = ''
}) {
    const block = document.createElement('button');
    block.type = 'button';
    block.className = `plugin-toggle-block${blockClass ? ` ${blockClass}` : ''}${active ? ' active' : ''}${locked ? ' locked' : ''}`;
    block.setAttribute('aria-pressed', active ? 'true' : 'false');
    block.disabled = Boolean(locked);

    const title = document.createElement('span');
    title.className = `plugin-toggle-title${titleClass ? ` ${titleClass}` : ''}`;
    title.textContent = label;

    const desc = document.createElement('span');
    desc.className = `plugin-toggle-sub${subLabelClass ? ` ${subLabelClass}` : ''}`;
    desc.textContent = subLabel || '';

    const flag = document.createElement('span');
    flag.className = `plugin-toggle-flag ${active ? 'enabled' : 'disabled'}`;
    flag.textContent = active ? '已启用' : '未启用';

    const tags = document.createElement('div');
    tags.className = 'plugin-toggle-tags';
    tags.appendChild(flag);

    if (mediaChip?.label) {
        const mediaTag = document.createElement('span');
        mediaTag.className = `plugin-toggle-media-chip mode-${mediaChip.mode || 'metadata'}`;
        mediaTag.textContent = mediaChip.label;
        tags.appendChild(mediaTag);
    }

    block.appendChild(title);
    block.appendChild(desc);
    block.appendChild(tags);

    if (note) {
        const noteEl = document.createElement('span');
        noteEl.className = 'plugin-toggle-note';
        noteEl.textContent = note;
        block.appendChild(noteEl);
    }

    block.addEventListener('click', () => {
        if (locked) return;
        const next = !block.classList.contains('active');
        block.classList.toggle('active', next);
        block.setAttribute('aria-pressed', next ? 'true' : 'false');
        flag.className = `plugin-toggle-flag ${next ? 'enabled' : 'disabled'}`;
        flag.textContent = next ? '已启用' : '未启用';
        onToggle(next);
    });

    return block;
}

function renderSimpleTargets() {
    simpleTargetRows.innerHTML = '';
    setStatus(simplePublishStatus, '');

    const mapped = getUnifiedPublishTargets();
    state.simpleTargets = mapped;

    if (mapped.length === 0) {
        simpleTargetRows.innerHTML = '<div class="target-sub">当前没有启用通用发布插件，可单独使用 Telegram 频道发布。</div>';
    } else {
        for (const plugin of mapped) {
            const meta = getHomeV2Meta(plugin);
            const label = meta?.label || plugin.name || plugin.id;
            const mediaUi = describePluginToggle(plugin, 'publish_simple');
            if (typeof state.simpleToggleMap[plugin.id] !== 'boolean') {
                state.simpleToggleMap[plugin.id] = true;
            }

            const block = createPluginToggleBlock({
                label,
                subLabel: mediaUi.subLabel,
                note: mediaUi.note,
                active: state.simpleToggleMap[plugin.id],
                locked: false,
                mediaChip: mediaUi.mediaChip,
                onToggle(next) {
                    state.simpleToggleMap[plugin.id] = next;
                }
            });
            simpleTargetRows.appendChild(block);
        }
    }
    refreshPublishButtonState();
}

function renderSaveLocalTargets() {
    saveLocalRows.innerHTML = '';
    const savePlugins = getPluginsBySection('save_local', { enabledOnly: true });

    if (savePlugins.length === 0) {
        saveLocalRows.innerHTML = '<div class="target-sub">当前没有启用 Obsidian 本地保存插件。</div>';
        return;
    }

    for (const plugin of savePlugins) {
        const meta = getHomeV2Meta(plugin);
        const label = meta?.label || plugin.name || plugin.id;
        const mediaUi = describePluginToggle(plugin, 'save_local');
        if (typeof state.saveLocalToggleMap[plugin.id] !== 'boolean') {
            state.saveLocalToggleMap[plugin.id] = true;
        }

        const block = createPluginToggleBlock({
            label,
            subLabel: mediaUi.subLabel,
            note: mediaUi.note,
            active: state.saveLocalToggleMap[plugin.id],
            locked: false,
            mediaChip: mediaUi.mediaChip,
            onToggle(next) {
                state.saveLocalToggleMap[plugin.id] = next;
            }
        });

        saveLocalRows.appendChild(block);
    }
}

function renderEditHint() {
    const editPlugins = getPluginsBySection('edit', { enabledOnly: true });
    if (editPlugins.length === 0) {
        editPluginHint.textContent = '';
        return;
    }
    editPluginHint.textContent = `编辑分区插件：${editPlugins.map(plugin => plugin.name).join('、')}`;
}

function getSelectedTgChannels() {
    return state.tgChannels
        .filter(channel => Boolean(state.tgChannelSelection[channel.id]))
        .map(channel => channel.id);
}

function getTgChannelDisplay(channelId) {
    const target = state.tgChannels.find(item => item.id === channelId);
    return target?.title || channelId;
}

function getTgChannelUsernameDisplay(channel) {
    const username = String(channel?.username || '').trim();
    if (username) {
        return username.startsWith('@') ? username : `@${username}`;
    }
    const fallbackId = String(channel?.id || '').trim();
    if (fallbackId.startsWith('@')) {
        return fallbackId;
    }
    return '@未设置';
}

function renderTgChannels() {
    tgChannelRows.innerHTML = '';
    tgChannelRows.classList.add('tg-channel-list');

    if (state.tgChannels.length === 0) {
        tgChannelRows.innerHTML = '<div class="target-sub">请先在插件中心中配置 Telegram 频道。</div>';
        return;
    }

    for (const channel of state.tgChannels) {
        const block = createPluginToggleBlock({
            label: channel.title || channel.id,
            subLabel: getTgChannelUsernameDisplay(channel),
            active: Boolean(state.tgChannelSelection[channel.id]),
            locked: false,
            blockClass: 'tg-channel-toggle',
            onToggle(next) {
                state.tgChannelSelection[channel.id] = next;
            }
        });
        tgChannelRows.appendChild(block);
    }
}

function loadTelegramChannelOptions() {
    const telegramPlugin = getPluginById('telegram');
    const telegramEnabled = Boolean(telegramPlugin?.enabled);
    tgAdvancedPanel.style.display = telegramEnabled ? '' : 'none';
    tgInputModeBtn.style.display = telegramEnabled ? 'inline-flex' : 'none';

    if (tgMediaHint) {
        const imageStatus = telegramEnabled ? getPluginImageStatus(telegramPlugin) : null;
        tgMediaHint.textContent = imageStatus?.label || '';
    }

    if (!telegramEnabled) {
        state.tgChannels = [];
        state.tgChannelSelection = {};
        tgChannelRows.innerHTML = '';
        setTgInputMode(false);
        refreshPublishButtonState();
        return;
    }

    const rawChannels = Array.isArray(telegramPlugin?.config?.channels)
        ? telegramPlugin.config.channels
        : [];
    const configuredHomeChannels = Array.isArray(telegramPlugin?.config?.homeChannels)
        ? telegramPlugin.config.homeChannels.map(item => String(item))
        : null;
    state.tgOptions = {
        showLinkPreview: telegramPlugin?.config?.showLinkPreview !== false,
        boldFirstLine: Boolean(telegramPlugin?.config?.boldFirstLine),
        appendSourceTag: Boolean(telegramPlugin?.config?.appendSourceTag),
        addLineBreakPerLine: Boolean(telegramPlugin?.config?.addLineBreakPerLine)
    };

    const channels = rawChannels
        .map(item => {
            if (typeof item !== 'object' || item === null) {
                const id = String(item || '').trim();
                return id ? { id, title: id, username: '' } : null;
            }
            const id = String(item.id || '').trim();
            if (!id) return null;
            const username = item.username ? String(item.username) : '';
            return {
                id,
                title: item.title ? String(item.title) : id,
                username
            };
        })
        .filter(Boolean)
        .filter(channel => !configuredHomeChannels || configuredHomeChannels.includes(String(channel.id)));

    state.tgChannels = channels;

    const previousSelection = { ...state.tgChannelSelection };
    state.tgChannelSelection = {};
    for (const channel of channels) {
        state.tgChannelSelection[channel.id] = Boolean(previousSelection[channel.id]);
    }

    renderTgChannels();

    if (state.tgInputModeEnabled && (contentInput.value || '').trim()) {
        regenerateLocalTgFormat({ silent: true });
    } else {
        renderTgFormattedPreview();
    }
    refreshPublishButtonState();
}

function syncMainHomePanels() {
    renderEditHint();
    renderSimpleTargets();
    renderSaveLocalTargets();
    loadTelegramChannelOptions();
}

async function loadRegistry() {
    const response = await fetch('/api/plugins/registry');
    const data = await response.json();
    if (!data.ok || !Array.isArray(data.plugins)) {
        throw new Error(data.error || '加载插件列表失败');
    }
    state.plugins = data.plugins;
    syncMainHomePanels();
}

async function runPublishPanelAction() {
    const pipelineContent = getCurrentContent({ channel: 'pipeline' });
    const imageFilenames = getPendingImageFilenames();
    if (!pipelineContent && imageFilenames.length === 0) {
        setStatus(simplePublishStatus, '请输入内容或添加图片后再发布', 'error');
        return;
    }

    const enabledTargets = state.simpleTargets
        .filter(plugin => plugin.enabled && state.simpleToggleMap[plugin.id])
        .map(plugin => plugin.id);

    const telegramEnabled = hasEnabledTelegramPlugin();
    const selectedTgChannels = telegramEnabled ? getSelectedTgChannels() : [];
    const publishToTelegram = telegramEnabled && selectedTgChannels.length > 0;

    if (enabledTargets.length === 0 && !publishToTelegram) {
        setStatus(simplePublishStatus, '请至少选择一个发布目标，或选择 Telegram 频道', 'error');
        return;
    }

    sendSimpleBtn.disabled = true;
    setStatus(simplePublishStatus, '发布中...');

    try {
        const summary = [];
        let hasFailure = false;

        if (enabledTargets.length > 0) {
            const response = await fetch('/api/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: pipelineContent,
                    targets: enabledTargets,
                    imageFilenames
                })
            });

            const data = await response.json().catch(() => ({}));
            for (const targetId of enabledTargets) {
                const targetResult = data?.results?.[targetId];
                if (!targetResult) {
                    summary.push(`${targetId}: 无返回`);
                    hasFailure = true;
                    continue;
                }
                if (targetResult.skipped) {
                    summary.push(`${targetId}: 跳过（${targetResult.message || 'skipped'}）`);
                    continue;
                }
                const warningText = Array.isArray(targetResult.warnings) && targetResult.warnings.length > 0
                    ? `，${targetResult.warnings.join('；')}`
                    : '';
                if (targetResult.success) {
                    summary.push(`${targetId}: 成功${warningText}`);
                } else {
                    summary.push(`${targetId}: 失败（${targetResult.message || targetResult.error || 'unknown'}）`);
                    hasFailure = true;
                }
            }

            if (!response.ok || data.ok === false) {
                hasFailure = true;
            }
        }

        if (publishToTelegram) {
            const tgContent = getCurrentContent({ channel: 'telegram' });
            const tgSourceUrl = getCurrentSourceUrlForTgPublish();
            const tgFormattingApplied = isTgFormattingAppliedForCurrentInput();
            for (let index = 0; index < selectedTgChannels.length; index += 1) {
                const channelId = selectedTgChannels[index];
                const channelTitle = getTgChannelDisplay(channelId);
                setStatus(simplePublishStatus, `发布中 (${index + 1}/${selectedTgChannels.length})：Telegram ${channelTitle}`);
                try {
                    const response = await fetch('/api/telegram/publish', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            content: tgContent,
                            channel: channelId,
                            type: 'note',
                            imageFilenames,
                            sourceUrl: tgSourceUrl,
                            tgFormattingApplied,
                            tgBoldFirstLineApplied: Boolean(state.tgFormatting.boldFirstLineApplied)
                        })
                    });
                    const data = await response.json().catch(() => ({}));
                    if (!response.ok || !data.ok) {
                        throw new Error(data.error || `HTTP ${response.status}`);
                    }
                    summary.push(`Telegram(${channelTitle}): 成功`);
                } catch (error) {
                    summary.push(`Telegram(${channelTitle}): 失败（${error.message}）`);
                    hasFailure = true;
                }
            }
        } else if (telegramEnabled && selectedTgChannels.length === 0) {
            summary.push('Telegram: 未选择频道，已跳过');
        }

        if (summary.length === 0) {
            setStatus(simplePublishStatus, '没有可发布目标', 'error');
            return;
        }

        if (hasFailure) {
            setStatus(simplePublishStatus, `发布存在失败：${summary.join('；')}`, 'error');
        } else {
            setStatus(simplePublishStatus, `发布完成：${summary.join('；')}`, 'ok');
        }
    } catch (error) {
        setStatus(simplePublishStatus, `发布失败：${error.message}`, 'error');
    } finally {
        refreshPublishButtonState();
    }
}

tgInputModeBtn.addEventListener('click', () => {
    setTgInputMode(!state.tgInputModeEnabled);
});

generateTgLocalBtn.addEventListener('click', () => {
    regenerateLocalTgFormat();
});

contentInput.addEventListener('input', () => {
    scheduleHomeDraftSync();

    if (!state.tgInputModeEnabled || !state.tgFormatting.generatedFrom) return;
    const current = (contentInput.value || '').trim();
    if (current && current !== state.tgFormatting.generatedFrom) {
        setStatus(simplePublishStatus, '输入已变化，请重新点击“生成TG发布格式”', 'error');
    }
});

async function runSavePanelAction() {
    const content = getCurrentContent({ channel: 'pipeline' });
    const imageFilenames = getPendingImageFilenames();
    if (!content && imageFilenames.length === 0) {
        setStatus(saveLocalStatus, '请输入内容或添加图片后再保存', 'error');
        return;
    }

    const selectedSavePlugins = getPluginsBySection('save_local', { enabledOnly: true })
        .filter(plugin => state.saveLocalToggleMap[plugin.id])
        .map(plugin => plugin.id);
    if (selectedSavePlugins.length === 0) {
        setStatus(saveLocalStatus, '请先启用 Obsidian 本地保存插件', 'error');
        return;
    }

    saveLocalBtn.disabled = true;
    setStatus(saveLocalStatus, '保存中...');

    try {
        const response = await fetch('/api/save-local-v2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content,
                type: 'diary',
                imageFilenames,
                options: {
                    plugins: selectedSavePlugins
                }
            })
        });
        const data = await response.json();
        const pluginResults = data?.results?.plugins || {};
        const statusLines = Object.entries(pluginResults).map(([pluginId, result]) => {
            if (!result) return `${pluginId}: 无返回`;
            if (result.skipped) return `${pluginId}: 跳过（${result.message || 'skipped'}）`;
            const warningText = Array.isArray(result.warnings) && result.warnings.length > 0
                ? `，${result.warnings.join('；')}`
                : '';
            return `${pluginId}: ${result.success ? `成功${warningText}` : `失败（${result.message || result.error || 'unknown'}）`}`;
        });
        const statusText = statusLines.join('；');

        if (response.ok && data.ok) {
            setStatus(saveLocalStatus, `本地保存完成：${statusText}`, 'ok');
        } else {
            throw new Error(data.error || statusText || '保存失败');
        }
    } catch (error) {
        setStatus(saveLocalStatus, `保存失败：${error.message}`, 'error');
    } finally {
        saveLocalBtn.disabled = false;
    }
}

registerWorkflowPanelAction('publish', runPublishPanelAction);
registerWorkflowPanelAction('save', runSavePanelAction);

document.querySelectorAll('[data-workflow-action="primary"]').forEach(actionEl => {
    actionEl.addEventListener('click', () => {
        runWorkflowPanelAction(getWorkflowPanelIdForAction(actionEl));
    });
});

function setSettingsAlert(message, type = 'info') {
    settingsAlert.textContent = message || '';
    settingsAlert.classList.remove('show', 'ok', 'error', 'info');
    if (message) {
        settingsAlert.classList.add('show');
        settingsAlert.classList.add(type);
    }
}

function getSettingsNavItems() {
    const plugins = sortPluginsByHomeOrder(state.modal.pluginRegistry);
    return [
        {
            key: 'general',
            label: '常规',
            meta: '全局配置项',
            enabled: false
        },
        ...plugins.map(plugin => ({
            key: `plugin:${plugin.id}`,
            label: plugin.manifest?.name || plugin.name || plugin.id,
            meta: plugin.enabled ? '已启用' : '未启用',
            enabled: Boolean(plugin.enabled)
        }))
    ];
}

function renderSettingsNav() {
    const items = getSettingsNavItems();
    settingsNavList.innerHTML = items.map(item => `
        <button type="button" class="settings-nav-btn${state.modal.activeKey === item.key ? ' active' : ''}" data-settings-key="${escapeHtml(item.key)}">
            <div class="settings-nav-head">
                <span>${escapeHtml(item.label)}</span>
                ${item.enabled ? '<span class="settings-nav-dot" aria-hidden="true"></span>' : ''}
            </div>
            <div class="settings-nav-meta">${escapeHtml(item.meta)}</div>
        </button>
    `).join('');

    settingsNavList.querySelectorAll('[data-settings-key]').forEach(button => {
        button.addEventListener('click', () => {
            state.modal.activeKey = button.dataset.settingsKey;
            renderSettingsNav();
            renderSettingsDetail();
        });
    });
}

function isEmptyValue(value) {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

function hasSavedSensitiveValue(value) {
    return !isEmptyValue(value);
}

function getSensitiveInputValue(element) {
    const rawValue = String(element?.value || '').trim();
    if (rawValue) {
        return rawValue;
    }
    return element?.dataset?.sensitiveHasValue === 'true' ? SENSITIVE_VALUE_MASK : '';
}

function resetSensitiveInputElement(element, hasSavedValue) {
    if (!element) return;
    element.value = '';
    element.dataset.sensitiveHasValue = hasSavedValue ? 'true' : 'false';
    element.placeholder = hasSavedValue ? SENSITIVE_INPUT_PLACEHOLDER : (element.dataset.emptyPlaceholder || '');
}

function getPluginFields(plugin) {
    return (plugin?.manifest?.settings?.sections || []).flatMap(section => section.fields || []);
}

function getStaticOptions(field) {
    return (field.options || []).map(option => (
        typeof option === 'string' ? { value: option, label: option } : option
    ));
}

function getPluginFieldOptions(pluginId, field, currentValue) {
    const staticOptions = getStaticOptions(field);
    if (!field.optionsSource?.path) {
        return staticOptions.map(option => ({ ...option, value: String(option.value) }));
    }

    const sourceItems = getValueAtPath(state.modal.pluginDrafts[pluginId] || {}, field.optionsSource.path);
    const dynamicOptions = Array.isArray(sourceItems)
        ? sourceItems.map(item => {
            if (typeof item !== 'object' || item === null) {
                return { value: String(item), label: String(item) };
            }

            const value = item[field.optionsSource.valueKey || 'value'];
            const label = item[field.optionsSource.labelKey || 'label'] ?? value;
            const caption = field.optionsSource.captionKey ? item[field.optionsSource.captionKey] : null;
            return {
                value: String(value),
                label: caption ? `${label} (${caption})` : String(label)
            };
        })
        : [];

    const options = [...staticOptions, ...dynamicOptions]
        .filter(option => option && option.value !== undefined && option.value !== null)
        .map(option => ({ ...option, value: String(option.value) }));

    const hasScalarCurrentValue = currentValue !== undefined
        && currentValue !== null
        && currentValue !== ''
        && !Array.isArray(currentValue);
    if (hasScalarCurrentValue && !options.some(option => option.value === String(currentValue))) {
        options.unshift({
            value: String(currentValue),
            label: `${String(currentValue)}（当前值）`
        });
    }

    return options;
}

function validatePluginField(pluginId, field) {
    const value = getValueAtPath(state.modal.pluginDrafts[pluginId] || {}, field.key);

    if (field.sensitive && (value === SENSITIVE_VALUE_MASK || value === '****')) {
        return '';
    }

    if (field.required && isEmptyValue(value)) {
        return `${field.label}不能为空`;
    }

    if (isEmptyValue(value)) {
        return '';
    }

    if (field.type === 'number' && Number.isNaN(Number(value))) {
        return `${field.label}必须是数字`;
    }

    if (field.type === 'select' && !field.allowCustomValue) {
        const optionValues = getPluginFieldOptions(pluginId, field, value).map(option => option.value);
        if (optionValues.length > 0 && !optionValues.includes(String(value))) {
            return `${field.label}必须从可选项中选择`;
        }
    }

    if (field.type === 'checkboxGroup') {
        if (!Array.isArray(value)) {
            return `${field.label}必须是数组`;
        }
        const optionValues = getPluginFieldOptions(pluginId, field, value).map(option => option.value);
        const invalidValues = optionValues.length > 0
            ? value.map(item => String(item)).filter(item => !optionValues.includes(item))
            : [];
        if (invalidValues.length > 0) {
            return `${field.label}包含不可用选项`;
        }
    }

    const validate = field.validate || {};
    if (typeof value === 'string') {
        if (validate.minLength && value.length < validate.minLength) {
            return validate.message || `${field.label}至少需要 ${validate.minLength} 个字符`;
        }
        if (validate.maxLength && value.length > validate.maxLength) {
            return validate.message || `${field.label}不能超过 ${validate.maxLength} 个字符`;
        }
        if (validate.pattern) {
            const regex = new RegExp(validate.pattern);
            if (!regex.test(value)) {
                return validate.message || `${field.label}格式不正确`;
            }
        }
    }

    if (field.type === 'number') {
        const numericValue = Number(value);
        if (validate.min !== undefined && numericValue < validate.min) {
            return validate.message || `${field.label}不能小于 ${validate.min}`;
        }
        if (validate.max !== undefined && numericValue > validate.max) {
            return validate.message || `${field.label}不能大于 ${validate.max}`;
        }
    }

    return '';
}

function setPluginFieldError(pluginId, fieldKey, message) {
    if (!state.modal.pluginFieldErrors[pluginId]) {
        state.modal.pluginFieldErrors[pluginId] = {};
    }

    if (message) {
        state.modal.pluginFieldErrors[pluginId][fieldKey] = message;
    } else {
        delete state.modal.pluginFieldErrors[pluginId][fieldKey];
    }

    const input = document.querySelector(`[data-plugin-id="${pluginId}"][data-field-key="${fieldKey}"]`);
    const errorEl = document.getElementById(`settings-plugin-error-${pluginId}-${fieldKey.replace(/\./g, '-')}`);

    if (input) {
        input.classList.toggle('settings-field-invalid', Boolean(message));
    }
    if (errorEl) {
        errorEl.textContent = message || '';
        errorEl.classList.toggle('show', Boolean(message));
    }
}

function validatePluginDraft(pluginId) {
    const plugin = state.modal.pluginRegistry.find(item => item.id === pluginId);
    if (!plugin) return [];

    const errors = [];
    getPluginFields(plugin).forEach(field => {
        const message = validatePluginField(pluginId, field);
        setPluginFieldError(pluginId, field.key, message);
        if (message) {
            errors.push({ field: field.key, message });
        }
    });
    return errors;
}

function applyPluginValidationErrors(pluginId, errors = []) {
    const plugin = state.modal.pluginRegistry.find(item => item.id === pluginId);
    if (!plugin) return;

    getPluginFields(plugin).forEach(field => {
        const matched = errors.find(item => item.field === field.key);
        setPluginFieldError(pluginId, field.key, matched?.message || '');
    });
}

function renderPluginField(plugin, field) {
    const inputId = `settings-plugin-${plugin.id}-${field.key.replace(/\./g, '-')}`;
    const value = getValueAtPath(state.modal.pluginDrafts[plugin.id] || {}, field.key);
    const fieldError = state.modal.pluginFieldErrors[plugin.id]?.[field.key] || '';
    const errorId = `settings-plugin-error-${plugin.id}-${field.key.replace(/\./g, '-')}`;
    const description = field.description
        ? `<div class="settings-sub">${escapeHtml(field.description)}</div>`
        : '';

    if (field.type === 'boolean') {
        return `
            <div class="settings-field">
                <label class="settings-checkbox">
                    <input
                        type="checkbox"
                        id="${inputId}"
                        data-plugin-id="${plugin.id}"
                        data-field-key="${field.key}"
                        data-field-type="boolean"
                        ${value ? 'checked' : ''}>
                    <span>${escapeHtml(field.label)}</span>
                </label>
                ${description}
                <div id="${errorId}" class="settings-field-error${fieldError ? ' show' : ''}">${escapeHtml(fieldError)}</div>
            </div>
        `;
    }

    if (field.type === 'textarea') {
        return `
            <div class="settings-field">
                <label for="${inputId}">${escapeHtml(field.label)}</label>
                <textarea
                    id="${inputId}"
                    data-plugin-id="${plugin.id}"
                    data-field-key="${field.key}"
                    data-field-type="textarea"
                    class="${fieldError ? 'settings-field-invalid' : ''}"
                    placeholder="${escapeHtml(field.placeholder || '')}">${escapeHtml(value || '')}</textarea>
                ${description}
                <div id="${errorId}" class="settings-field-error${fieldError ? ' show' : ''}">${escapeHtml(fieldError)}</div>
            </div>
        `;
    }

    if (field.type === 'select') {
        const options = getPluginFieldOptions(plugin.id, field, value);
        const placeholderOption = field.placeholder
            ? `<option value="">${escapeHtml(field.placeholder)}</option>`
            : '';
        const optionHtml = options.map(option => {
            const optionValue = String(option.value);
            return `<option value="${escapeHtml(optionValue)}" ${optionValue === String(value ?? '') ? 'selected' : ''}>${escapeHtml(option.label)}</option>`;
        }).join('');

        return `
            <div class="settings-field">
                <label for="${inputId}">${escapeHtml(field.label)}</label>
                <select
                    id="${inputId}"
                    data-plugin-id="${plugin.id}"
                    data-field-key="${field.key}"
                    data-field-type="select"
                    class="${fieldError ? 'settings-field-invalid' : ''}">
                    ${placeholderOption}
                    ${optionHtml}
                </select>
                ${description}
                <div id="${errorId}" class="settings-field-error${fieldError ? ' show' : ''}">${escapeHtml(fieldError)}</div>
            </div>
        `;
    }

    if (field.type === 'checkboxGroup') {
        const options = getPluginFieldOptions(plugin.id, field, value);
        const selectedValues = new Set(Array.isArray(value) ? value.map(item => String(item)) : []);
        const optionHtml = options.length > 0
            ? options.map((option, index) => {
                const optionValue = String(option.value);
                const optionId = `${inputId}-${index}`;
                return `
                    <label class="settings-checkbox" for="${optionId}">
                        <input
                            type="checkbox"
                            id="${optionId}"
                            data-plugin-id="${plugin.id}"
                            data-field-key="${field.key}"
                            data-field-type="checkboxGroup"
                            data-option-value="${escapeHtml(optionValue)}"
                            ${selectedValues.has(optionValue) ? 'checked' : ''}>
                        <span>${escapeHtml(option.label)}</span>
                    </label>
                `;
            }).join('')
            : '<div class="settings-sub">请先点击“获取频道列表”。</div>';

        return `
            <div class="settings-field">
                <label>${escapeHtml(field.label)}</label>
                <div class="settings-checkbox-group">
                    ${optionHtml}
                </div>
                ${description}
                <div id="${errorId}" class="settings-field-error${fieldError ? ' show' : ''}">${escapeHtml(fieldError)}</div>
            </div>
        `;
    }

    const inputType = field.sensitive ? 'text' : (field.type === 'password' ? 'password' : (field.type === 'number' ? 'number' : 'text'));
    const hasSensitiveValue = field.sensitive && hasSavedSensitiveValue(value);
    const inputValue = field.sensitive ? '' : (value ?? field.default ?? '');
    const placeholder = field.sensitive && hasSensitiveValue
        ? SENSITIVE_INPUT_PLACEHOLDER
        : (field.placeholder || '');
    const inputClass = [
        fieldError ? 'settings-field-invalid' : '',
        field.sensitive ? 'settings-sensitive-input' : ''
    ].filter(Boolean).join(' ');

    return `
        <div class="settings-field">
            <label for="${inputId}">${escapeHtml(field.label)}</label>
            <input
                type="${inputType}"
                id="${inputId}"
                data-plugin-id="${plugin.id}"
                data-field-key="${field.key}"
                data-field-type="${field.type}"
                class="${inputClass}"
                ${field.sensitive ? 'data-sensitive="true"' : ''}
                ${field.sensitive ? `data-sensitive-has-value="${hasSensitiveValue ? 'true' : 'false'}"` : ''}
                ${field.sensitive ? `data-empty-placeholder="${escapeHtml(field.placeholder || '')}"` : ''}
                ${field.sensitive ? 'autocomplete="off" spellcheck="false"' : ''}
                placeholder="${escapeHtml(placeholder)}"
                value="${escapeHtml(inputValue)}">
            ${description}
            <div id="${errorId}" class="settings-field-error${fieldError ? ' show' : ''}">${escapeHtml(fieldError)}</div>
        </div>
    `;
}

function bindPluginFieldInputs() {
    settingsDetail.querySelectorAll('[data-plugin-id][data-field-key]').forEach(element => {
        const pluginId = element.dataset.pluginId;
        const fieldKey = element.dataset.fieldKey;
        const eventName = element.dataset.fieldType === 'boolean'
            || element.dataset.fieldType === 'select'
            || element.dataset.fieldType === 'checkboxGroup'
            ? 'change'
            : 'input';

        element.addEventListener(eventName, () => {
            let value;
            if (element.dataset.fieldType === 'boolean') {
                value = element.checked;
            } else if (element.dataset.fieldType === 'checkboxGroup') {
                value = Array.from(settingsDetail.querySelectorAll(
                    `[data-plugin-id="${pluginId}"][data-field-key="${fieldKey}"][data-field-type="checkboxGroup"]:checked`
                )).map(input => input.dataset.optionValue || '');
            } else if (element.dataset.sensitive === 'true') {
                value = getSensitiveInputValue(element);
            } else {
                value = element.dataset.fieldType === 'number' && element.value !== ''
                    ? Number(element.value)
                    : element.value;
            }
            setValueAtPath(state.modal.pluginDrafts[pluginId], fieldKey, value);
            const plugin = state.modal.pluginRegistry.find(item => item.id === pluginId);
            const field = getPluginFields(plugin).find(item => item.key === fieldKey);
            if (field) {
                const message = validatePluginField(pluginId, field);
                setPluginFieldError(pluginId, fieldKey, message);
            }
        });
    });
}

function normalizeActionResult(result = {}) {
    if (typeof result !== 'object' || result === null) {
        return {
            success: true,
            message: String(result),
            warnings: [],
            data: {}
        };
    }

    return {
        success: result.success !== false,
        message: result.message || result.error || '',
        warnings: Array.isArray(result.warnings) ? result.warnings : (result.warnings ? [result.warnings] : []),
        data: result.data && typeof result.data === 'object' ? result.data : {}
    };
}

function renderActionResultText(result) {
    const normalized = normalizeActionResult(result);
    const lines = [];
    if (normalized.message) {
        lines.push(normalized.message);
    }
    if (normalized.warnings.length > 0) {
        lines.push(`警告: ${normalized.warnings.join('；')}`);
    }
    if (Object.keys(normalized.data).length > 0) {
        lines.push(JSON.stringify(normalized.data, null, 2));
    }
    return lines.join('\n');
}

function renderPluginSettingsDetail(plugin) {
    const sections = plugin.manifest?.settings?.sections || [];
    const globalActions = plugin.manifest?.settings?.actions || [];
    const sectionsWithFields = sections.filter(section => Array.isArray(section.fields) && section.fields.length > 0);
    const imageInputDescription = getPluginImageInputDescription(plugin);
    const pluginDescription = String(plugin.manifest?.description || '').trim();

    const renderActionButtons = actions => (actions || []).map(action => `
        <button type="button" class="primary-btn" data-plugin-action="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>
    `).join('');

    const fieldsHtml = sectionsWithFields.map(section => {
        const sectionActionButtons = renderActionButtons(section.actions || []);
        return `
        <div class="settings-card">
            <h3>${escapeHtml(section.title || '配置')}</h3>
            ${section.description ? `<div class="settings-sub" style="margin-bottom: 10px;">${escapeHtml(section.description)}</div>` : ''}
            ${sectionActionButtons ? `<div class="settings-actions" style="margin-bottom: 12px;">${sectionActionButtons}</div>` : ''}
            <div class="settings-grid">
                ${(section.fields || []).map(field => renderPluginField(plugin, field)).join('')}
            </div>
        </div>
    `;
    }).join('');

    const actionButtons = renderActionButtons(globalActions);

    settingsDetail.innerHTML = `
        <div class="settings-card">
            <div class="settings-plugin-header">
                <div>
                    <h3>${escapeHtml(plugin.manifest?.name || plugin.name || plugin.id)}</h3>
                    ${pluginDescription ? `<p class="settings-plugin-desc">${escapeHtml(pluginDescription)}</p>` : ''}
                </div>
                <div class="settings-inline">
                    <button id="togglePluginEnabledBtn" type="button" class="settings-plugin-toggle ${plugin.enabled ? 'enabled' : 'disabled'}">
                        ${plugin.enabled ? '已启用' : '未启用'}
                    </button>
                </div>
            </div>
        </div>
        ${imageInputDescription ? `
            <div class="settings-card settings-image-input-card">
                <h3>图片输入</h3>
                <p class="settings-plugin-desc settings-plugin-media-desc">${escapeHtml(imageInputDescription)}</p>
            </div>
        ` : ''}
        ${fieldsHtml || '<div class="settings-card"><div class="settings-sub">该插件没有可配置字段。</div></div>'}
        <div class="settings-card">
            <div class="settings-actions">
                <button id="savePluginConfigBtn" type="button" class="primary-btn">保存插件配置</button>
                ${actionButtons}
            </div>
            <div id="settingsPluginResult" class="settings-result" style="display: none;"></div>
        </div>
    `;

    const toggleBtn = document.getElementById('togglePluginEnabledBtn');
    const saveBtn = document.getElementById('savePluginConfigBtn');

    toggleBtn.addEventListener('click', () => togglePluginEnabled(plugin.id, !plugin.enabled));
    saveBtn.addEventListener('click', () => savePluginConfig(plugin.id));

    settingsDetail.querySelectorAll('[data-plugin-action]').forEach(button => {
        button.addEventListener('click', () => runPluginAction(plugin.id, button.dataset.pluginAction));
    });

    bindPluginFieldInputs();
}

function renderGeneralSettingsDetail() {
    const general = state.modal.general;
    const hasGeneralAiKey = hasSavedSensitiveValue(general.ai.apiKey);
    settingsDetail.innerHTML = `
        <div class="settings-card">
            <h3>AI 与网络</h3>
            <div class="settings-grid">
                <div class="settings-field">
                    <label for="generalAiApiType">AI 接口类型</label>
                    <select id="generalAiApiType">
                        ${getAiApiTypeOptionsHtml(general.ai.apiType)}
                    </select>
                </div>
                <div class="settings-field">
                    <label for="generalAiBaseUrl">API 地址</label>
                    <div class="settings-ai-url-row">
                        <input id="generalAiBaseUrl" type="text" value="${escapeHtml(general.ai.baseUrl)}" placeholder="https://api.openai.com/v1">
                        <span id="generalAiApiSuffix" class="settings-ai-url-suffix"></span>
                    </div>
                </div>
                <div class="settings-field">
                    <label for="generalAiApiKey">API 密钥</label>
                    <input
                        id="generalAiApiKey"
                        class="settings-sensitive-input"
                        type="text"
                        value=""
                        placeholder="${escapeHtml(hasGeneralAiKey ? SENSITIVE_INPUT_PLACEHOLDER : 'sk-...')}"
                        data-sensitive="true"
                        data-sensitive-has-value="${hasGeneralAiKey ? 'true' : 'false'}"
                        data-empty-placeholder="sk-..."
                        autocomplete="off"
                        spellcheck="false">
                </div>
                <div class="settings-field">
                    <label for="generalAiModel">模型名称</label>
                    <input id="generalAiModel" type="text" value="${escapeHtml(general.ai.model)}" placeholder="gpt-4o-mini">
                </div>
                <div class="settings-field">
                    <label for="generalNetworkProxy">代理</label>
                    <div class="settings-inline">
                        <input id="generalNetworkProxy" type="text" value="${escapeHtml(general.networkProxy)}" placeholder="http://127.0.0.1:7890">
                        <button id="clearGeneralProxyBtn" type="button" class="primary-btn" style="background: #5f6f88;">清空代理</button>
                    </div>
                </div>
            </div>
            <div class="settings-actions">
                <button id="saveGeneralAiBtn" type="button" class="primary-btn">保存 AI 设置</button>
                <button id="testGeneralAiBtn" type="button" class="primary-btn" style="background: #1c8c53;">测试 LLM 连通性</button>
            </div>
        </div>

        <div class="settings-card">
            <h3>路径与显示</h3>
            <div class="settings-sub">Obsidian 日记路径、笔记 Vault 路径、图片保存路径和文件名规则已迁移到 “Obsidian 本地保存” 插件中单独维护。</div>
        </div>
    `;

    document.getElementById('saveGeneralAiBtn').addEventListener('click', saveGeneralAiConfig);
    document.getElementById('testGeneralAiBtn').addEventListener('click', testGeneralAiConnection);
    document.getElementById('clearGeneralProxyBtn').addEventListener('click', clearGeneralProxy);
    const generalAiTypeInput = document.getElementById('generalAiApiType');
    const generalAiSuffix = document.getElementById('generalAiApiSuffix');
    const syncGeneralAiSuffix = () => {
        if (generalAiSuffix) {
            generalAiSuffix.textContent = getAiApiSuffix(generalAiTypeInput?.value);
        }
    };
    generalAiTypeInput?.addEventListener('change', syncGeneralAiSuffix);
    syncGeneralAiSuffix();
}

function renderSettingsDetail() {
    if (state.modal.activeKey === 'general') {
        renderGeneralSettingsDetail();
        return;
    }

    const pluginId = state.modal.activeKey.replace(/^plugin:/, '');
    const plugin = state.modal.pluginRegistry.find(item => item.id === pluginId);
    if (!plugin) {
        settingsDetail.innerHTML = '<div class="settings-card"><div class="settings-sub">插件不存在或已移除。</div></div>';
        return;
    }

    renderPluginSettingsDetail(plugin);
}

function showPluginResult(message, type = 'ok') {
    const resultEl = document.getElementById('settingsPluginResult');
    if (!resultEl) return;

    resultEl.style.display = 'block';
    resultEl.classList.remove('ok', 'error');
    resultEl.classList.add(type === 'error' ? 'error' : 'ok');
    resultEl.textContent = message;
}

function syncMainPluginsFromModalRegistry() {
    state.plugins = cloneValue(state.modal.pluginRegistry) || [];
    syncMainHomePanels();
}

async function togglePluginEnabled(pluginId, enabled) {
    try {
        setSettingsAlert(`正在${enabled ? '启用' : '禁用'}插件...`, 'info');
        const response = await fetch(`/api/plugins/${pluginId}/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
            throw new Error(data.error || '操作失败');
        }

        const plugin = state.modal.pluginRegistry.find(item => item.id === pluginId);
        if (plugin) {
            plugin.enabled = enabled;
        }

        renderSettingsNav();
        renderSettingsDetail();
        syncMainPluginsFromModalRegistry();
        setSettingsAlert(`插件 ${pluginId} 已${enabled ? '启用' : '禁用'}`, 'ok');
    } catch (error) {
        setSettingsAlert(`切换失败：${error.message}`, 'error');
    }
}

async function savePluginConfig(pluginId, { silent = false } = {}) {
    const localErrors = validatePluginDraft(pluginId);
    if (localErrors.length > 0) {
        const errorMessage = localErrors.map(item => item.message).join('；');
        if (!silent) {
            showPluginResult(errorMessage, 'error');
        }
        throw new Error(localErrors[0].message);
    }

    const response = await fetch(`/api/plugins/${pluginId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: state.modal.pluginDrafts[pluginId] })
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
        if (Array.isArray(data.validationErrors)) {
            applyPluginValidationErrors(pluginId, data.validationErrors);
        }
        throw new Error(data.error || '保存失败');
    }

    if (data.config && typeof data.config === 'object') {
        state.modal.pluginDrafts[pluginId] = cloneValue(data.config);
    }

    const plugin = state.modal.pluginRegistry.find(item => item.id === pluginId);
    if (plugin) {
        plugin.config = cloneValue(state.modal.pluginDrafts[pluginId]);
    }

    applyPluginValidationErrors(pluginId, []);
    syncMainPluginsFromModalRegistry();
    settingsDetail.querySelectorAll(`[data-plugin-id="${pluginId}"][data-sensitive="true"]`).forEach(input => {
        const currentValue = getValueAtPath(state.modal.pluginDrafts[pluginId] || {}, input.dataset.fieldKey);
        resetSensitiveInputElement(input, hasSavedSensitiveValue(currentValue));
    });

    if (!silent) {
        showPluginResult('插件配置已保存', 'ok');
        setSettingsAlert('插件配置已保存', 'ok');
    }

    return data;
}

async function runPluginAction(pluginId, actionId) {
    try {
        showPluginResult('执行中...', 'ok');
        await savePluginConfig(pluginId, { silent: true });

        const response = await fetch(`/api/plugins/${pluginId}/actions/${actionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: { config: state.modal.pluginDrafts[pluginId] } })
        });
        const data = await response.json();

        if (!response.ok || !data.ok) {
            if (Array.isArray(data.validationErrors)) {
                applyPluginValidationErrors(pluginId, data.validationErrors);
            }
            throw new Error(data.error || '执行失败');
        }

        const normalized = normalizeActionResult(data.result || {});
        if (Array.isArray(normalized.data.channels)) {
            setValueAtPath(state.modal.pluginDrafts[pluginId], 'channels', normalized.data.channels);
            if (Array.isArray(normalized.data.homeChannels)) {
                setValueAtPath(state.modal.pluginDrafts[pluginId], 'homeChannels', normalized.data.homeChannels);
            }
            const plugin = state.modal.pluginRegistry.find(item => item.id === pluginId);
            if (plugin) {
                plugin.config = cloneValue(state.modal.pluginDrafts[pluginId]);
            }
            syncMainPluginsFromModalRegistry();
            renderSettingsDetail();
        }

        const actionMessage = renderActionResultText(normalized) || '执行完成';
        showPluginResult(actionMessage, normalized.success === false ? 'error' : 'ok');
        setSettingsAlert(normalized.success === false ? '插件动作执行失败' : '插件动作执行成功', normalized.success === false ? 'error' : 'ok');
    } catch (error) {
        showPluginResult(error.message, 'error');
        setSettingsAlert(`插件动作执行失败：${error.message}`, 'error');
    }
}

function normalizeProxyInput(rawValue) {
    const trimmed = String(rawValue || '').trim();
    if (!trimmed) {
        return '';
    }

    const hasProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
    const candidate = hasProtocol ? trimmed : `http://${trimmed}`;
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('代理地址必须使用 http:// 或 https://');
    }
    if (!parsed.hostname) {
        throw new Error('代理地址缺少主机名');
    }

    if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
        return `${parsed.protocol}//${parsed.host}`;
    }

    return parsed.toString();
}

async function saveNetworkProxy(rawValue, { strict = false } = {}) {
    let normalized;
    try {
        normalized = normalizeProxyInput(rawValue);
    } catch (error) {
        if (strict) {
            throw error;
        }
        return state.modal.networkProxySaved;
    }

    if (normalized === state.modal.networkProxySaved) {
        return state.modal.networkProxySaved;
    }

    const response = await fetch('/api/config/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'network.proxy', value: String(rawValue || '').trim() })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
        throw new Error(data.error || '代理配置保存失败');
    }

    const appliedProxy = typeof data.value === 'string' ? data.value : normalized;
    state.modal.networkProxySaved = appliedProxy;
    state.modal.general.networkProxy = appliedProxy;
    return appliedProxy;
}

async function clearGeneralProxy() {
    const input = document.getElementById('generalNetworkProxy');
    if (!input) return;
    input.value = '';

    try {
        await saveNetworkProxy('', { strict: true });
        setSettingsAlert('代理已清除，已恢复直连', 'ok');
    } catch (error) {
        setSettingsAlert(`清空代理失败：${error.message}`, 'error');
    }
}

async function saveGeneralAiConfig() {
    const apiType = normalizeAiApiType(document.getElementById('generalAiApiType')?.value);
    const baseUrl = stripAiEndpointSuffix((document.getElementById('generalAiBaseUrl')?.value || '').trim());
    const apiKeyInput = document.getElementById('generalAiApiKey');
    const apiKey = (apiKeyInput?.value || '').trim();
    const hasSavedApiKey = apiKeyInput?.dataset.sensitiveHasValue === 'true'
        || hasSavedSensitiveValue(state.modal.general.ai.apiKey);
    const model = (document.getElementById('generalAiModel')?.value || '').trim();
    const networkProxyInput = document.getElementById('generalNetworkProxy');
    const networkProxy = (networkProxyInput?.value || '').trim();

    if (!baseUrl || (!apiKey && !hasSavedApiKey) || !model) {
        setSettingsAlert('请填写 AI 设置的所有字段', 'error');
        return;
    }

    try {
        normalizeProxyInput(networkProxy);
    } catch (error) {
        setSettingsAlert(`代理格式错误：${error.message}`, 'error');
        return;
    }

    try {
        const writes = [
            fetch('/api/config/set', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: 'ai.baseUrl', value: baseUrl })
            }),
            fetch('/api/config/set', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: 'ai.model', value: model })
            }),
            fetch('/api/config/set', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: 'ai.apiType', value: apiType })
            })
        ];
        if (apiKey) {
            writes.push(fetch('/api/config/set', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: 'ai.apiKey', value: apiKey })
            }));
        }

        const responses = await Promise.all(writes);
        for (const response of responses) {
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.ok) {
                throw new Error(data.error || '保存失败');
            }
        }

        const appliedProxy = await saveNetworkProxy(networkProxy, { strict: true });

        state.modal.general.ai = {
            apiType,
            baseUrl,
            apiKey: apiKey ? SENSITIVE_VALUE_MASK : (state.modal.general.ai.apiKey || SENSITIVE_VALUE_MASK),
            model
        };
        state.modal.general.networkProxy = appliedProxy;
        if (networkProxyInput) {
            networkProxyInput.value = appliedProxy;
        }
        const baseUrlInput = document.getElementById('generalAiBaseUrl');
        if (baseUrlInput) {
            baseUrlInput.value = baseUrl;
        }
        resetSensitiveInputElement(apiKeyInput, true);

        setSettingsAlert('AI 设置保存成功', 'ok');
    } catch (error) {
        setSettingsAlert(`保存失败：${error.message}`, 'error');
    }
}

async function testGeneralAiConnection() {
    const apiType = normalizeAiApiType(document.getElementById('generalAiApiType')?.value);
    const baseUrl = stripAiEndpointSuffix((document.getElementById('generalAiBaseUrl')?.value || '').trim());
    const apiKeyInput = document.getElementById('generalAiApiKey');
    const apiKey = (apiKeyInput?.value || '').trim();
    const hasSavedApiKey = apiKeyInput?.dataset.sensitiveHasValue === 'true'
        || hasSavedSensitiveValue(state.modal.general.ai.apiKey);
    const model = (document.getElementById('generalAiModel')?.value || '').trim();
    if (!baseUrl || (!apiKey && !hasSavedApiKey) || !model) {
        setSettingsAlert('请先填写完整的 AI 设置再测试', 'error');
        return;
    }

    setSettingsAlert('正在测试 LLM 连接...', 'info');

    try {
        const response = await fetch('/api/config/test-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ai: {
                    apiType,
                    baseUrl,
                    apiKey: apiKey || SENSITIVE_VALUE_MASK,
                    model
                }
            })
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.ok) {
            throw new Error(data.error || data.message || '连接失败');
        }

        setSettingsAlert(`连接成功：${data.model}，耗时 ${data.duration}`, 'ok');
    } catch (error) {
        setSettingsAlert(`连接失败：${error.message}`, 'error');
    }
}

async function fetchJson(url) {
    const response = await fetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || `${url} 请求失败`);
    }
    return data;
}

async function loadPluginCenterData() {
    const [registryResult, fullResult] = await Promise.allSettled([
        fetchJson('/api/plugins/registry'),
        fetchJson('/api/config/full')
    ]);

    if (registryResult.status !== 'fulfilled' || !registryResult.value.ok || !Array.isArray(registryResult.value.plugins)) {
        throw new Error('加载插件中心失败');
    }

    state.modal.pluginRegistry = registryResult.value.plugins;
    state.modal.pluginDrafts = {};
    state.modal.pluginFieldErrors = {};

    state.modal.pluginRegistry.forEach(plugin => {
        state.modal.pluginDrafts[plugin.id] = cloneValue(plugin.config || {});
        state.modal.pluginFieldErrors[plugin.id] = {};
    });

    const fullConfig = fullResult.status === 'fulfilled' && fullResult.value?.config
        ? fullResult.value.config
        : {};

    state.modal.general = {
        ai: {
            apiType: normalizeAiApiType(fullConfig.ai?.apiType),
            baseUrl: stripAiEndpointSuffix(fullConfig.ai?.baseUrl || ''),
            apiKey: fullConfig.ai?.apiKey || '',
            model: fullConfig.ai?.model || ''
        },
        networkProxy: fullConfig.network?.proxy || ''
    };

    state.modal.networkProxySaved = state.modal.general.networkProxy;
    syncMainPluginsFromModalRegistry();
}

function openPluginCenter() {
    pluginCenterModal.classList.remove('hidden');
    pluginCenterModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closePluginCenter() {
    pluginCenterModal.classList.add('hidden');
    pluginCenterModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    setSettingsAlert('');
}

function initializeInputMediaBridge() {
    if (typeof createInputMediaBridge !== 'function' || !contentInput) {
        return;
    }

    inputMediaBridge = createInputMediaBridge({
        textarea: contentInput,
        previewGrid: imagePreviewGrid,
        statusEl: imageUploadStatus,
        previewModal: imagePreviewModal,
        previewImage: imagePreviewModalImg,
        previewCloseBtn: closeImagePreviewBtn,
        storageKey: 'journal-sync-home-v2-pending-images',
        enableStorage: false,
        maxImages: 9,
        onChange(nextState) {
            state.inputMedia = nextState;
            syncInputDependentPanels();
            scheduleHomeDraftSync();
        }
    });

    inputMediaBridge.init();
    state.inputMedia = inputMediaBridge.getState();
}

async function openPluginCenterWithData() {
    openPluginCenter();
    setSettingsAlert('正在加载插件与设置...', 'info');

    try {
        await loadPluginCenterData();
        const validKeys = new Set(getSettingsNavItems().map(item => item.key));
        if (!validKeys.has(state.modal.activeKey)) {
            state.modal.activeKey = 'general';
        }
        renderSettingsNav();
        renderSettingsDetail();
        setSettingsAlert('设置已加载，可直接修改并保存', 'ok');
    } catch (error) {
        settingsNavList.innerHTML = '';
        settingsDetail.innerHTML = '<div class="settings-card"><div class="settings-sub">加载失败，请稍后重试。</div></div>';
        setSettingsAlert(`加载失败：${error.message}`, 'error');
    }
}

function shouldOpenPluginCenterFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('open') === 'plugin-center' || window.location.hash === '#plugin-center';
}

openPluginCenterBtn.addEventListener('click', openPluginCenterWithData);
closePluginCenterBtn.addEventListener('click', closePluginCenter);
pluginCenterBackdrop.addEventListener('click', closePluginCenter);

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !pluginCenterModal.classList.contains('hidden')) {
        closePluginCenter();
    }
});

async function init() {
    ensureMainInputTraits();
    initializeInputMediaBridge();
    initializeWorkflowPanelLinks();
    setTgInputMode(false);
    renderTgFormattedPreview();

    try {
        await restoreHomeDraft();
    } catch (error) {
        console.error('[HomeV2Draft] 初始化恢复失败:', error);
    }

    try {
        await loadRegistry();
        if (shouldOpenPluginCenterFromUrl()) {
            await openPluginCenterWithData();
        }
    } catch (error) {
        setStatus(simplePublishStatus, `初始化失败：${error.message}`, 'error');
        setStatus(saveLocalStatus, `初始化失败：${error.message}`, 'error');
    }
}

init();
