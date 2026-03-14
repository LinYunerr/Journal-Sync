// 状态管理
let currentType = 'diary';
let timeline = [];
let pendingSaves = new Map(); // 存储待完成的保存任务
let summarizeMode = false; // 总结模式
let pluginStates = { flomo: true, nmem: true, memu: true, telegram: false, mastodon: false }; // 插件状态
let flomoEnabled = { diary: true, note: true }; // flomo 发布开关（独立于插件状态）
let mastodonEnabled = { diary: true, note: true }; // mastodon 发布开关
let tgOptimizedContent = ''; // TG 优化后的内容
let availableChannels = []; // 可用的 Telegram 频道列表
let pendingImages = []; // 缓存中的待保存图片 [{ filename, previewUrl }]
let lastSavedImageFilenames = []; // 最近一次保存时的图片文件名（供 TG 发布使用）
const MAX_IMAGES = 9; // 最多上传 9 张图片

// 从 localStorage 恢复待完成的保存任务
function restorePendingSaves() {
    try {
        const saved = localStorage.getItem('journal-sync-pending-saves');
        if (saved) {
            const data = JSON.parse(saved);
            pendingSaves = new Map(Object.entries(data));
            console.log('恢复待完成的保存任务:', pendingSaves.size);
        }
    } catch (e) {
        console.error('恢复保存任务失败:', e);
    }
}

// 保存待完成的任务到 localStorage
function savePendingSaves() {
    try {
        const data = Object.fromEntries(pendingSaves);
        localStorage.setItem('journal-sync-pending-saves', JSON.stringify(data));
    } catch (e) {
        console.error('保存任务状态失败:', e);
    }
}

// 追踪当前发布内容，用于在多次分发时保持同一条历史记录
let currentSaveId = null;
let currentSavedContent = '';

// 内容缓存
let contentCache = {
    diary: '',
    note: ''
};

// DOM 元素
const tabs = document.querySelectorAll('.tab');
const contentInput = document.getElementById('contentInput');
const modeToggle = document.getElementById('modeToggle');
const modeSlider = document.getElementById('modeSlider');
const modeSliderButton = document.getElementById('modeSliderButton');
const flomoToggle = document.getElementById('flomoToggle');
const flomoSlider = document.getElementById('flomoSlider');
const mastodonToggle = document.getElementById('mastodonToggle');
const mastodonSlider = document.getElementById('mastodonSlider');
const saveBtn = document.getElementById('saveBtn');
const timelineContainer = document.getElementById('timelineContainer');

// Telegram 相关元素
const telegramPublishSection = document.getElementById('telegramPublishSection');
const telegramOptionsSection = document.getElementById('telegramOptionsSection');
const generateTgBtn = document.getElementById('generateTgBtn');
const publishTgBtn = document.getElementById('publishTgBtn');
const publishTgDiaryBtn = document.getElementById('publishTgDiaryBtn');
const tgChannelSelect = document.getElementById('tgChannelSelect');
const tgPreviewSection = document.getElementById('tgPreviewSection');
const tgPreviewContent = document.getElementById('tgPreviewContent');
const tgChannelSelectDiary = document.getElementById('tgChannelSelectDiary');

// 统计元素
const statTotal = document.getElementById('stat-total');
const statDiary = document.getElementById('stat-diary');
const statNote = document.getElementById('stat-note');
const statToday = document.getElementById('stat-today');

// 自动保存草稿到 localStorage
if (contentInput) {
    contentInput.addEventListener('input', () => {
        contentCache[currentType] = contentInput.value;

        // 重置当前发布ID，说明内容发生了修改，这应该新起一条记录
        if (contentInput.value.trim() !== currentSavedContent) {
            currentSaveId = null;
        }

        try {
            if (currentType === 'diary') {
                localStorage.setItem('journal-sync-diary-draft', contentInput.value);
            } else {
                localStorage.setItem('journal-sync-note-draft', contentInput.value);
            }
        } catch (e) {
            console.error('保存草稿失败:', e);
        }
    });
}

// 标签切换
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        // 保存当前内容到缓存
        contentCache[currentType] = contentInput.value;

        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentType = tab.dataset.type;

        // 恢复缓存的内容
        contentInput.value = contentCache[currentType] || '';

        // 更新占位符和显示区域
        if (currentType === 'diary') {
            contentInput.placeholder = '在这里输入你的日记...\n\n支持多行输入，粘贴长文本也没问题 😊';
            modeToggle.style.display = 'none'; // 日记模式隐藏总结开关

            // 显示/隐藏 flomo 开关（根据插件状态）
            if (pluginStates.flomo) {
                flomoToggle.style.display = 'flex';
                updateFlomoSlider();
            } else {
                flomoToggle.style.display = 'none';
            }

            // 显示/隐藏 mastodon 开关（根据插件状态）
            if (pluginStates.mastodon) {
                mastodonToggle.style.display = 'flex';
                updateMastodonSlider();
            } else {
                mastodonToggle.style.display = 'none';
            }

            // 显示日记的 Telegram 选项，隐藏笔记的 Telegram 发布区域
            if (pluginStates.telegram) {
                telegramOptionsSection.style.display = 'block';
                telegramPublishSection.style.display = 'none';
            }
        } else {
            contentInput.placeholder = '在这里输入你的笔记...\n\n支持多行输入，粘贴长文本也没问题 😊';
            modeToggle.style.display = 'flex'; // 笔记模式显示总结开关

            // 显示/隐藏 flomo 开关（根据插件状态）
            if (pluginStates.flomo) {
                flomoToggle.style.display = 'flex';
                updateFlomoSlider();
            } else {
                flomoToggle.style.display = 'none';
            }

            // 显示/隐藏 mastodon 开关（根据插件状态）
            if (pluginStates.mastodon) {
                mastodonToggle.style.display = 'flex';
                updateMastodonSlider();
            } else {
                mastodonToggle.style.display = 'none';
            }

            // 显示笔记的 Telegram 发布区域，隐藏日记的 Telegram 选项
            if (pluginStates.telegram) {
                telegramPublishSection.style.display = 'block';
                telegramOptionsSection.style.display = 'none';
            }
        }

        // 重置 TG 预览
        tgPreviewSection.style.display = 'none';
        tgPreviewContent.value = '';
        tgOptimizedContent = '';
    });
});

// 滑块点击切换
if (modeSlider) {
    modeSlider.addEventListener('click', () => {
        summarizeMode = !summarizeMode;
        if (summarizeMode) {
            modeSlider.classList.add('summarize');
            modeSliderButton.textContent = '总结';
        } else {
            modeSlider.classList.remove('summarize');
            modeSliderButton.textContent = '原文';
        }
    });
}

// flomo 滑块点击切换
if (flomoSlider) {
    flomoSlider.addEventListener('click', () => {
        flomoEnabled[currentType] = !flomoEnabled[currentType];
        updateFlomoSlider();
        // 保存到 localStorage
        try {
            localStorage.setItem('journal-sync-flomo-enabled', JSON.stringify(flomoEnabled));
        } catch (e) {
            console.error('保存 flomo 开关状态失败:', e);
        }
    });
}

// 更新 flomo 滑块状态
function updateFlomoSlider() {
    if (flomoEnabled[currentType]) {
        flomoSlider.classList.add('active');
    } else {
        flomoSlider.classList.remove('active');
    }
}

// mastodon 滑块点击切换
if (mastodonSlider) {
    mastodonSlider.addEventListener('click', () => {
        mastodonEnabled[currentType] = !mastodonEnabled[currentType];
        updateMastodonSlider();
        // 保存到 localStorage
        try {
            localStorage.setItem('journal-sync-mastodon-enabled', JSON.stringify(mastodonEnabled));
        } catch (e) {
            console.error('保存 mastodon 开关状态失败:', e);
        }
    });
}

// 更新 mastodon 滑块状态
function updateMastodonSlider() {
    if (mastodonEnabled[currentType]) {
        mastodonSlider.classList.add('active');
    } else {
        mastodonSlider.classList.remove('active');
    }
}

// 保存按钮
saveBtn.addEventListener('click', async () => {
    const content = contentInput.value.trim();

    if (!content && pendingImages.length === 0) {
        alert('请输入内容或添加图片');
        return;
    }

    // 复用已有 saveId（TG 发布可能已创建），或新建一个
    // 不再用内容比较来判断是否新建，避免先发 TG 再保存出现两条历史
    if (!currentSaveId) {
        currentSaveId = Date.now().toString();
    }
    currentSavedContent = content;
    const saveId = currentSaveId;

    // 收集当前待保存的图片文件名
    const imageFilenames = pendingImages.map(img => img.filename);

    // 立即添加到历史记录（pending 状态）
    const pendingEntry = {
        id: saveId,
        timestamp: new Date().toISOString(),
        type: currentType,
        content: content,
        status: {
            obsidian: 'pending',
            flomo: (pluginStates.flomo && flomoEnabled[currentType]) ? 'pending' : 'skipped',
            mastodon: (pluginStates.mastodon && mastodonEnabled[currentType]) ? 'pending' : 'skipped',
            nmem: pluginStates.nmem ? 'pending' : 'skipped',
            memu: pluginStates.memu ? 'pending' : 'skipped',
            mem0: (pluginStates.mem0 && currentType === 'diary') ? 'pending' : 'skipped'
        },
        telegramSends: [],
        pending: true
    };

    const existingIndex = timeline.findIndex(item => item.id === saveId);
    if (existingIndex !== -1) {
        timeline[existingIndex] = { ...timeline[existingIndex], ...pendingEntry, status: { ...timeline[existingIndex].status, ...pendingEntry.status } };
    } else {
        timeline.unshift(pendingEntry);
    }

    pendingSaves.set(saveId, timeline[existingIndex !== -1 ? existingIndex : 0]);
    savePendingSaves();
    renderTimeline();

    try {
        const options = {
            sendToTelegram: false,
            summarize: currentType === 'note' && summarizeMode,
            enableFlomo: flomoEnabled[currentType],
            enableMastodon: mastodonEnabled[currentType]
        };

        await saveContentWithRealTimeUpdate(saveId, content, currentType, options, imageFilenames);

        // 保存成功后记录图片文件名（供 TG 发布使用），然后清空预览
        lastSavedImageFilenames = imageFilenames.slice(); // 保存副本
        pendingImages = [];
        savePendingImages();
        renderImagePreview();

    } catch (error) {
        console.error('Save error:', error);
        const index = timeline.findIndex(item => item.id === saveId);
        if (index !== -1) {
            timeline[index].pending = false;
            timeline[index].failed = true;
            pendingSaves.delete(saveId);
            savePendingSaves();
            renderTimeline();
        }
    }
});

// 实时更新保存状态
async function saveContentWithRealTimeUpdate(saveId, content, type, options, imageFilenames = []) {
    try {
        const response = await fetch('/api/save-stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content,
                type,
                options,
                saveId,
                imageFilenames
            })
        });

        if (!response.ok) {
            throw new Error('保存失败');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim());

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.substring(6));
                        updateTimelineStatus(saveId, data);
                    } catch (e) {
                        console.error('Parse error:', e);
                    }
                }
            }
        }

        // 重新加载统计
        await loadStats();

    } catch (error) {
        console.error('Stream error:', error);
        throw error;
    }
}

// 更新时间线状态
function updateTimelineStatus(saveId, data) {
    const index = timeline.findIndex(item => item.id === saveId);
    if (index === -1) return;

    if (data.type === 'status') {
        // 更新单个插件状态
        timeline[index].status[data.plugin] = data.success ? 'success' : 'failed';
        pendingSaves.set(saveId, timeline[index]); // 更新待完成任务
        savePendingSaves(); // 持久化
        renderTimeline();
    } else if (data.type === 'complete') {
        // 完成
        timeline[index].pending = false;
        timeline[index].suggestion = data.suggestion;
        pendingSaves.delete(saveId); // 从待完成任务中移除
        savePendingSaves(); // 持久化
        renderTimeline();

        // 如果是日记且 Mem0 插件启用，重新加载任务列表和洞察
        if (timeline[index].type === 'diary' && pluginStates.mem0) {
            loadTasks();
            loadInsights();
        }
    }
}

// 保存内容到后端
async function saveContent(content, type, options) {
    const response = await fetch('/api/save', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            content,
            type,
            options
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '保存失败');
    }

    return await response.json();
}

// 加载历史记录
async function loadHistory() {
    try {
        const response = await fetch('/api/history?limit=20');
        const data = await response.json();

        if (data.success) {
            timeline = data.history;
            renderTimeline();
        }
    } catch (error) {
        console.error('Load history error:', error);
        timelineContainer.innerHTML = '<div class="empty-state"><p>加载历史记录失败</p></div>';
    }
}

// 加载插件状态
async function loadPluginStates() {
    try {
        const response = await fetch('/api/plugins');
        const data = await response.json();

        if (data.ok && data.plugins) {
            pluginStates = data.plugins;

            // 根据 flomo 插件状态显示/隐藏 flomo 开关
            if (pluginStates.flomo) {
                flomoToggle.style.display = 'flex';
                updateFlomoSlider();
            } else {
                flomoToggle.style.display = 'none';
            }

            // 根据 mastodon 插件状态显示/隐藏 mastodon 开关
            if (pluginStates.mastodon) {
                mastodonToggle.style.display = 'flex';
                updateMastodonSlider();
            } else {
                mastodonToggle.style.display = 'none';
            }

            // 根据 telegram 插件状态和当前类型显示/隐藏 Telegram 区域
            if (pluginStates.telegram) {
                if (currentType === 'diary') {
                    telegramOptionsSection.style.display = 'block';
                    telegramPublishSection.style.display = 'none';
                } else {
                    telegramPublishSection.style.display = 'block';
                    telegramOptionsSection.style.display = 'none';
                }
            } else {
                telegramOptionsSection.style.display = 'none';
                telegramPublishSection.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Load plugin states error:', error);
    }
}

// 加载统计信息
async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();

        if (data.success) {
            statTotal.textContent = data.stats.total;
            statDiary.textContent = data.stats.diary;
            statNote.textContent = data.stats.note;
            statToday.textContent = data.stats.today;
        }
    } catch (error) {
        console.error('Load stats error:', error);
    }
}

// 渲染时间线
function renderTimeline() {
    if (timeline.length === 0) {
        timelineContainer.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                    <path d="M2 12l10 5 10-5"/>
                </svg>
                <p>还没有保存记录，开始记录你的第一条日记或笔记吧！</p>
            </div>
        `;
        return;
    }

    timelineContainer.innerHTML = timeline.map(item => createCard(item)).join('');
}

// 创建卡片 HTML
function createCard(item) {
    const typeLabel = item.type === 'diary' ? '日记' : '笔记';
    const typeClass = item.type === 'diary' ? 'diary' : 'note';
    const time = formatTime(new Date(item.timestamp));

    const content = item.content || '';
    const cardId = `card-${item.id}`;

    // 分离文字和图片引用
    const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
    const imageUrls = [];
    let match;
    while ((match = imageRegex.exec(content)) !== null) {
        imageUrls.push(match[1]);
    }
    // 纯文字部分（去掉图片 markdown）
    const textContent = content.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();

    // 处理文字截断（1000字）
    const maxLength = 1000;
    const needsTruncate = textContent.length > maxLength;
    const displayText = needsTruncate ? textContent.substring(0, maxLength) : textContent;

    // 图片 HTML（缩略图网格，复用 image-preview-grid 样式）
    let imageHTML = '';
    if (imageUrls.length > 0) {
        const imgItems = imageUrls.map(url => {
            // assets/ 开头的路径转为 /api/image-cache/ 预览路径（如果在缓存）或直接使用
            const previewSrc = url.startsWith('assets/') ? `/api/image-cache/${encodeURIComponent(url.replace('assets/', ''))}` : url;
            return `<div class="image-preview-item" onclick="openLightbox('${previewSrc.replace(/'/g, "\\'")}')">
                <img src="${previewSrc}" alt="image" onerror="this.parentElement.style.display='none'">
            </div>`;
        }).join('');
        imageHTML = `<div class="image-preview-grid" style="max-width:50%">${imgItems}</div>`;
    }

    let contentHTML = '';
    if (textContent) {
        if (needsTruncate) {
            contentHTML = `
                <div class="timeline-card-content" id="${cardId}-content">
                    <span id="${cardId}-preview">${escapeHtml(displayText)}</span>
                    <span id="${cardId}-full" style="display: none;">${escapeHtml(textContent)}</span>
                    <a href="javascript:void(0)"
                       class="show-more-link"
                       id="${cardId}-toggle"
                       onclick="toggleContent('${cardId}')">显示剩余</a>
                </div>
            `;
        } else {
            contentHTML = `<div class="timeline-card-content">${escapeHtml(textContent)}</div>`;
        }
    }
    contentHTML += imageHTML;

    let statusHTML = '';
    if (item.status) {
        const statuses = [];

        // Obsidian (总是显示)
        const obsidianStatus = item.status.obsidian;
        if (obsidianStatus === 'pending') {
            statuses.push('<span class="status-item pending">⏳ Obsidian</span>');
        } else if (obsidianStatus === 'success' || obsidianStatus === true) {
            statuses.push('<span class="status-item success">✓ Obsidian</span>');
        } else if (obsidianStatus === 'failed' || obsidianStatus === false) {
            statuses.push('<span class="status-item failed">✗ Obsidian</span>');
        }

        // flomo (跳过则不显示)
        const flomoStatus = item.status.flomo;
        if (flomoStatus !== 'skipped') {
            if (flomoStatus === 'pending') {
                statuses.push('<span class="status-item pending">⏳ flomo</span>');
            } else if (flomoStatus === 'success' || flomoStatus === true) {
                statuses.push('<span class="status-item success">✓ flomo</span>');
            } else if (flomoStatus === 'failed' || flomoStatus === false) {
                statuses.push('<span class="status-item failed">✗ flomo</span>');
            }
        }

        // mastodon (跳过则不显示)
        const mastodonStatus = item.status.mastodon;
        if (mastodonStatus !== 'skipped') {
            if (mastodonStatus === 'pending') {
                statuses.push('<span class="status-item pending">⏳ 长毛象</span>');
            } else if (mastodonStatus === 'success' || mastodonStatus === true) {
                statuses.push('<span class="status-item success">✓ 长毛象</span>');
            } else if (mastodonStatus === 'failed' || mastodonStatus === false) {
                statuses.push('<span class="status-item failed">✗ 长毛象</span>');
            }
        }

        // nmem (跳过则不显示)
        const nmemStatus = item.status.nmem;
        if (nmemStatus !== 'skipped') {
            if (nmemStatus === 'pending') {
                statuses.push('<span class="status-item pending">⏳ Nowledge Mem</span>');
            } else if (nmemStatus === 'success' || nmemStatus === true) {
                statuses.push('<span class="status-item success">✓ Nowledge Mem</span>');
            } else if (nmemStatus === 'failed' || nmemStatus === false) {
                statuses.push('<span class="status-item failed">✗ Nowledge Mem</span>');
            }
        }

        // memu (跳过则不显示)
        const memuStatus = item.status.memu;
        if (memuStatus !== 'skipped') {
            if (memuStatus === 'pending') {
                statuses.push('<span class="status-item pending">⏳ memU</span>');
            } else if (memuStatus === 'success' || memuStatus === true) {
                statuses.push('<span class="status-item success">✓ memU</span>');
            } else if (memuStatus === 'failed' || memuStatus === false) {
                statuses.push('<span class="status-item failed">✗ memU</span>');
            }
        }

        // telegram (跳过则不显示)
        const telegramStatus = item.status.telegram;
        const hasSpecificSends = item.telegramSends && Array.isArray(item.telegramSends) && item.telegramSends.length > 0;
        const hasPendingSends = item.pendingSends && Array.isArray(item.pendingSends) && item.pendingSends.length > 0;

        // 如果没有特定频道的发送记录（和进行中的记录），才显示粗粒度的通用状态
        if (!hasSpecificSends && !hasPendingSends && telegramStatus !== 'skipped') {
            if (telegramStatus === 'pending') {
                statuses.push('<span class="status-item pending">⏳ Telegram</span>');
            } else if (telegramStatus === 'success' || telegramStatus === true) {
                statuses.push('<span class="status-item success">✓ Telegram</span>');
            } else if (telegramStatus === 'failed' || telegramStatus === false) {
                statuses.push('<span class="status-item failed">✗ Telegram</span>');
            }
        }

        // 新增：渲染独立记录的 Telegram 发送记录（成功）
        if (hasSpecificSends) {
            // 使用 Set 去重
            const uniqueChannels = [...new Set(item.telegramSends)];
            uniqueChannels.forEach(channel => {
                const shortName = channel.substring(0, 5);
                statuses.push(`<span class="status-item success">✓ Telegram: ${escapeHtml(shortName)}</span>`);
            });
        }

        // 渲染客户端正在请求中的频道路由（发送中）
        if (hasPendingSends) {
            const uniquePending = [...new Set(item.pendingSends)];
            uniquePending.forEach(channel => {
                const shortName = channel.substring(0, 5);
                statuses.push(`<span class="status-item pending">⏳ Telegram: ${escapeHtml(shortName)}</span>`);
            });
        }

        if (statuses.length > 0) {
            statusHTML = `<div class="timeline-card-status">${statuses.join('')}</div>`;
        }
    }

    return `
        <div class="timeline-card">
            <div class="timeline-card-header">
                <span class="timeline-card-type ${typeClass}">${typeLabel}</span>
                <span class="timeline-card-time">${time}</span>
            </div>
            ${contentHTML}
            ${statusHTML}
        </div>
    `;
}

// 切换内容显示/隐藏
function toggleContent(cardId) {
    const preview = document.getElementById(`${cardId}-preview`);
    const full = document.getElementById(`${cardId}-full`);
    const toggle = document.getElementById(`${cardId}-toggle`);

    if (preview.style.display === 'none') {
        // 显示预览，隐藏全文
        preview.style.display = 'inline';
        full.style.display = 'none';
        toggle.textContent = '显示剩余';
    } else {
        // 显示全文，隐藏预览
        preview.style.display = 'none';
        full.style.display = 'inline';
        toggle.textContent = '收起';
    }
}

// 格式化时间
function formatTime(date) {
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';

    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// 转义 HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 初始化
async function init() {
    console.log('[init] 开始初始化...');

    // 从 localStorage 恢复缓存内容
    try {
        const savedDiary = localStorage.getItem('journal-sync-diary-draft');
        const savedNote = localStorage.getItem('journal-sync-note-draft');
        if (savedDiary) contentCache.diary = savedDiary;
        if (savedNote) contentCache.note = savedNote;

        // 恢复当前类型的内容
        if (contentCache[currentType]) {
            contentInput.value = contentCache[currentType];
        }

        // 恢复 flomo 开关状态
        const savedFlomoEnabled = localStorage.getItem('journal-sync-flomo-enabled');
        if (savedFlomoEnabled) {
            flomoEnabled = JSON.parse(savedFlomoEnabled);
        }

        // 恢复 mastodon 开关状态
        const savedMastodonEnabled = localStorage.getItem('journal-sync-mastodon-enabled');
        if (savedMastodonEnabled) {
            mastodonEnabled = JSON.parse(savedMastodonEnabled);
        }
    } catch (e) {
        console.error('恢复草稿失败:', e);
    }

    // 恢复待完成的保存任务
    restorePendingSaves();

    await Promise.all([
        loadHistory(),
        loadStats(),
        loadPluginStates(),
        loadTasks(),
        loadInsights()
    ]);

    // 初始化历史记录按钮
    initHistoryButtons();

    // 将待完成的任务合并到 timeline 中
    if (pendingSaves.size > 0) {
        console.log('[init] 恢复待完成的保存任务:', pendingSaves.size);
        for (const [saveId, entry] of pendingSaves) {
            // 检查是否已经在 timeline 中
            const exists = timeline.find(item => item.id === saveId);
            if (!exists) {
                timeline.unshift(entry);
            }
        }
        renderTimeline();
    }

    console.log('[init] 插件状态加载完成，准备加载频道列表...');
    await loadTelegramChannels();
    console.log('[init] 初始化完成');
}

// 加载 Telegram 频道列表
async function loadTelegramChannels() {
    console.log('[loadTelegramChannels] 开始加载频道列表');
    console.log('[loadTelegramChannels] Telegram 插件状态:', pluginStates.telegram);

    if (!pluginStates.telegram) {
        console.log('[loadTelegramChannels] Telegram 插件未启用，跳过加载');
        return;
    }

    try {
        console.log('[loadTelegramChannels] 请求配置...');
        const response = await fetch('/api/config/diary');
        const data = await response.json();

        console.log('[loadTelegramChannels] 收到配置:', data);

        if (data.ok && data.config) {
            // 尝试加载频道列表
            let channels = [];

            if (data.config.tgChannels) {
                console.log('[loadTelegramChannels] tgChannels 原始值:', data.config.tgChannels);
                console.log('[loadTelegramChannels] tgChannels 类型:', typeof data.config.tgChannels);

                try {
                    channels = JSON.parse(data.config.tgChannels);
                    console.log('[loadTelegramChannels] 解析后的频道列表:', channels);
                } catch (e) {
                    console.error('[loadTelegramChannels] 解析频道列表失败:', e);
                }
            } else {
                console.log('[loadTelegramChannels] 配置中没有 tgChannels 字段');
            }

            // 如果没有频道列表但有默认频道，创建一个频道项
            if (channels.length === 0 && data.config.tgDiaryChannel) {
                console.log('[loadTelegramChannels] 使用默认频道创建列表:', data.config.tgDiaryChannel);
                channels = [{
                    id: data.config.tgDiaryChannel,
                    title: data.config.tgDiaryChannel
                }];
            }

            availableChannels = channels;
            console.log('[loadTelegramChannels] 最终频道列表:', availableChannels);

            // 填充频道选择框
            if (channels.length > 0) {
                const channelOptions = channels.map(ch =>
                    `<option value="${ch.id}">${ch.title}</option>`
                ).join('');

                console.log('[loadTelegramChannels] 生成的选项 HTML:', channelOptions);

                if (tgChannelSelect) {
                    tgChannelSelect.innerHTML = '<option value="">选择频道</option>' + channelOptions;
                    console.log('[loadTelegramChannels] 已填充笔记频道选择框');
                    // 设置默认选中
                    if (data.config.tgDiaryChannel) {
                        tgChannelSelect.value = data.config.tgDiaryChannel;
                        console.log('[loadTelegramChannels] 笔记频道默认选中:', data.config.tgDiaryChannel);
                    }
                }

                if (tgChannelSelectDiary) {
                    tgChannelSelectDiary.innerHTML = '<option value="">选择频道</option>' + channelOptions;
                    console.log('[loadTelegramChannels] 已填充日记频道选择框');
                    // 设置默认选中
                    if (data.config.tgDiaryChannel) {
                        tgChannelSelectDiary.value = data.config.tgDiaryChannel;
                        console.log('[loadTelegramChannels] 日记频道默认选中:', data.config.tgDiaryChannel);
                    }
                }
            } else {
                console.log('[loadTelegramChannels] 没有可用的频道');
            }
        } else {
            console.log('[loadTelegramChannels] API 返回失败或没有配置');
        }
    } catch (error) {
        console.error('[loadTelegramChannels] 加载 Telegram 频道失败:', error);
    }
}

// 生成 TG 发布格式
if (generateTgBtn) {
    generateTgBtn.addEventListener('click', async () => {
        const content = contentInput.value.trim();

        if (!content) {
            alert('请先输入内容');
            return;
        }

        generateTgBtn.disabled = true;
        generateTgBtn.textContent = '⏳ 生成中...';

        try {
            const response = await fetch('/api/telegram/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });

            const data = await response.json();

            if (data.ok && data.optimized) {
                tgOptimizedContent = data.optimized;
                tgPreviewContent.value = tgOptimizedContent;
                tgPreviewSection.style.display = 'block';
            } else {
                alert('生成失败: ' + (data.error || '未知错误'));
            }
        } catch (error) {
            alert('生成失败: ' + error.message);
        } finally {
            generateTgBtn.disabled = false;
            generateTgBtn.textContent = '✨ 生成 TG 发布格式';
        }
    });
}

// 发布到 TG（笔记模式）
if (publishTgBtn) {
    publishTgBtn.addEventListener('click', async () => {
        const channel = tgChannelSelect.value;

        if (!channel) {
            alert('请先选择频道');
            return;
        }

        // 获取要发布的内容
        let contentToPublish = tgPreviewContent.value.trim();

        // 如果没有生成过优化内容，询问是否直接发布原文
        if (!contentToPublish) {
            const originalContent = contentInput.value.trim();

            if (!originalContent) {
                alert('请先输入内容');
                return;
            }

            if (!confirm('要原文直接发布吗？')) {
                return;
            }

            contentToPublish = originalContent;
        }

        publishTgBtn.disabled = true;
        publishTgBtn.textContent = '⏳ ...';

        let channelNameText = '';
        if (tgChannelSelect.selectedIndex >= 0) {
            channelNameText = tgChannelSelect.options[tgChannelSelect.selectedIndex].text;
        }

        // 复用最近一次保存的 saveId（避免发布+保存出现两条历史）
        if (!currentSaveId) {
            currentSaveId = Date.now().toString();
        }
        const saveId = currentSaveId;

        // 立即更新 UI (前端虚拟 Pending 状态)
        let existingItem = timeline.find(item => item.id === saveId);
        if (!existingItem) {
            existingItem = {
                id: saveId,
                timestamp: new Date().toISOString(),
                type: 'note',
                content: contentToPublish,
                status: {},
                telegramSends: [],
                pendingSends: [channelNameText],
                pending: false
            };
            timeline.unshift(existingItem);
        } else {
            if (!existingItem.pendingSends) existingItem.pendingSends = [];
            if (!existingItem.pendingSends.includes(channelNameText)) {
                existingItem.pendingSends.push(channelNameText);
            }
        }
        renderTimeline();

        // 1 秒后释放发布按钮，允许继续操作
        setTimeout(() => {
            publishTgBtn.disabled = false;
            publishTgBtn.textContent = '📤 发布 TG';
        }, 1000);

        // imageFilenames 优先用最近保存的，其次用当前 pending 的
        const imageFilenames = lastSavedImageFilenames.length > 0
            ? lastSavedImageFilenames
            : pendingImages.map(img => img.filename);

        // 异步背景发布（不 blocking UI）
        fetch('/api/telegram/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: contentToPublish,
                channel: channel,
                saveId: saveId,
                type: 'note',
                channelName: channelNameText,
                imageFilenames: imageFilenames
            })
        }).then(async response => {
            const data = await response.json();

            // 清理对应项的 Pending 状态
            const currentItem = timeline.find(item => item.id === saveId);
            if (currentItem && currentItem.pendingSends) {
                currentItem.pendingSends = currentItem.pendingSends.filter(c => c !== channelNameText);
            }

            if (data.ok) {
                if (currentItem) {
                    if (!currentItem.telegramSends) currentItem.telegramSends = [];
                    if (!currentItem.telegramSends.includes(channelNameText)) {
                        currentItem.telegramSends.push(channelNameText);
                    }
                }
            } else {
                alert('发送到 ' + channelNameText + ' 失败: ' + (data.error || '未知错误'));
            }
            renderTimeline();
        }).catch(error => {
            const currentItem = timeline.find(item => item.id === saveId);
            if (currentItem && currentItem.pendingSends) {
                currentItem.pendingSends = currentItem.pendingSends.filter(c => c !== channelNameText);
            }
            alert('发送到 ' + channelNameText + ' 失败: ' + error.message);
            renderTimeline();
        });
    });
}

// 发布到 TG（日记模式）
if (publishTgDiaryBtn) {
    publishTgDiaryBtn.addEventListener('click', async () => {
        const channel = tgChannelSelectDiary.value;

        if (!channel) {
            alert('请先选择频道');
            return;
        }

        const content = contentInput.value.trim();

        if (!content) {
            alert('请先输入日记内容');
            return;
        }

        publishTgDiaryBtn.disabled = true;
        publishTgDiaryBtn.textContent = '⏳ ...';

        let channelNameText = '';
        if (tgChannelSelectDiary.selectedIndex >= 0) {
            channelNameText = tgChannelSelectDiary.options[tgChannelSelectDiary.selectedIndex].text;
        }

        if (!currentSaveId) {
            currentSaveId = Date.now().toString();
        }
        const saveId = currentSaveId;

        // 立即更新 UI (前端虚拟 Pending 状态)
        let existingItem = timeline.find(item => item.id === saveId);
        if (!existingItem) {
            existingItem = {
                id: saveId,
                timestamp: new Date().toISOString(),
                type: 'diary',
                content: content,
                status: {},
                telegramSends: [],
                pendingSends: [channelNameText],
                pending: false
            };
            timeline.unshift(existingItem);
        } else {
            if (!existingItem.pendingSends) existingItem.pendingSends = [];
            if (!existingItem.pendingSends.includes(channelNameText)) {
                existingItem.pendingSends.push(channelNameText);
            }
        }
        renderTimeline();

        // 1 秒后释放发布按钮，允许继续操作
        setTimeout(() => {
            publishTgDiaryBtn.disabled = false;
            publishTgDiaryBtn.textContent = '📤 发布到 Telegram';
        }, 1000);

        // imageFilenames 优先用最近保存的，其次用当前 pending 的
        const diaryImageFilenames = lastSavedImageFilenames.length > 0
            ? lastSavedImageFilenames
            : pendingImages.map(img => img.filename);

        // 异步背景发布
        fetch('/api/telegram/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: content,
                channel: channel,
                saveId: saveId,
                type: 'diary',
                channelName: channelNameText,
                imageFilenames: diaryImageFilenames
            })
        }).then(async response => {
            const data = await response.json();

            // 清理对应项的 Pending 状态
            const currentItem = timeline.find(item => item.id === saveId);
            if (currentItem && currentItem.pendingSends) {
                currentItem.pendingSends = currentItem.pendingSends.filter(c => c !== channelNameText);
            }

            if (data.ok) {
                if (currentItem) {
                    if (!currentItem.telegramSends) currentItem.telegramSends = [];
                    if (!currentItem.telegramSends.includes(channelNameText)) {
                        currentItem.telegramSends.push(channelNameText);
                    }
                }
            } else {
                alert('发送到 ' + channelNameText + ' 失败: ' + (data.error || '未知错误'));
            }
            renderTimeline();
        }).catch(error => {
            const currentItem = timeline.find(item => item.id === saveId);
            if (currentItem && currentItem.pendingSends) {
                currentItem.pendingSends = currentItem.pendingSends.filter(c => c !== channelNameText);
            }
            alert('发送到 ' + channelNameText + ' 失败: ' + error.message);
            renderTimeline();
        });
    });
}

// ==================== 任务列表功能 ====================

// 加载任务列表
async function loadTasks() {
    try {
        const response = await fetch('/api/mem0/tasks');
        const data = await response.json();

        if (data.ok && data.tasks) {
            renderTasks(data.tasks);
        }
    } catch (error) {
        console.error('加载任务失败:', error);
    }
}

// 渲染任务列表
function renderTasks(tasks) {
    const tasksContainer = document.getElementById('tasksContainer');
    const tasksCard = tasksContainer ? tasksContainer.closest('.tasks-card') : null;

    if (!tasks || tasks.length === 0) {
        tasksContainer.innerHTML = '<div class="tasks-empty">暂无任务</div>';
        // 只隐藏任务卡片本身，不影响侧边栏中的其他卡片
        if (tasksCard) tasksCard.style.display = 'none';
        updateSidebarVisibility();
        return;
    }

    // 显示任务卡片
    if (tasksCard) tasksCard.style.display = 'block';

    const tasksHTML = tasks.map(task => `
        <div class="task-item">
            <div class="task-content">
                <div class="task-title">${escapeHtml(task.title)}</div>
                ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ''}
            </div>
            <button class="task-delete" onclick="deleteTask('${task.id}')" title="删除任务">×</button>
        </div>
    `).join('');

    tasksContainer.innerHTML = tasksHTML;
    updateSidebarVisibility();
}

// 统一管理侧边栏显隐：只要侧边栏内有任何可见的 .tasks-card 就显示，否则隐藏
function updateSidebarVisibility() {
    const tasksSidebar = document.getElementById('tasksSidebar');
    if (!tasksSidebar) return;

    const cards = tasksSidebar.querySelectorAll('.tasks-card');
    const anyVisible = Array.from(cards).some(card => card.style.display !== 'none');
    tasksSidebar.style.display = anyVisible ? 'block' : 'none';
}

// 删除任务
async function deleteTask(taskId) {
    if (!confirm('确定要删除这个任务吗？')) {
        return;
    }

    try {
        const response = await fetch(`/api/mem0/tasks/${taskId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.ok) {
            // 重新加载任务列表
            await loadTasks();
        } else {
            alert('删除失败: ' + (data.error || '未知错误'));
        }
    } catch (error) {
        alert('删除失败: ' + error.message);
    }
}

// ==================== Mem0 洞察卡片功能 ====================

// 加载洞察数据
async function loadInsights() {
    try {
        // 加载配置以检查哪些卡片启用
        const configResponse = await fetch('/api/config/diary');
        const configData = await configResponse.json();
        const insightsConfig = configData.ok && configData.config ? configData.config.mem0Insights : {};

        const response = await fetch('/api/mem0/insights');
        const data = await response.json();

        if (data.ok && data.insights) {
            renderInsights(data.insights, insightsConfig);
        }
    } catch (error) {
        console.error('加载洞察失败:', error);
    }
}

// 渲染洞察数据
function renderInsights(insights, config = {}) {
    // 渲染情绪卡片（如果启用）
    if (config.emotions !== false) {
        renderEmotions(insights.emotions);
    } else {
        document.getElementById('emotionsCard').style.display = 'none';
    }

    // 渲染书影音卡片（如果启用）
    if (config.media !== false) {
        renderMedia(insights.media);
    } else {
        document.getElementById('mediaCard').style.display = 'none';
    }

    // 渲染工作卡片（如果启用）
    if (config.work !== false) {
        renderWork(insights.work);
    } else {
        document.getElementById('workCard').style.display = 'none';
    }

    // 渲染生活卡片（如果启用）
    if (config.life !== false) {
        renderLife(insights.life);
    } else {
        document.getElementById('lifeCard').style.display = 'none';
    }

    // 统一更新侧边栏显隐（由各卡片的实际可见性决定）
    updateSidebarVisibility();
}

// 渲染情绪卡片
function renderEmotions(emotions) {
    const emotionsCard = document.getElementById('emotionsCard');
    const emotionsContainer = document.getElementById('emotionsContainer');

    if (!emotions.weeklyKeywords || emotions.weeklyKeywords.length === 0) {
        emotionsCard.style.display = 'none';
        return;
    }

    emotionsCard.style.display = 'block';

    const keywordsHTML = emotions.weeklyKeywords.map(keyword =>
        `<span class="emotion-keyword">${escapeHtml(keyword)}</span>`
    ).join('');

    emotionsContainer.innerHTML = `
        <div style="padding: 10px; color: #666; font-size: 0.9em; margin-bottom: 8px;">
            本周关键词：
        </div>
        <div class="emotion-keywords">${keywordsHTML}</div>
    `;
}

// 渲染书影音卡片
function renderMedia(media) {
    const mediaCard = document.getElementById('mediaCard');
    const mediaContainer = document.getElementById('mediaContainer');

    const visibleItems = media.items.filter(item => item.visible !== false);

    if (visibleItems.length === 0) {
        mediaCard.style.display = 'none';
        return;
    }

    mediaCard.style.display = 'block';

    const typeEmoji = {
        movie: '🎬',
        book: '📚',
        music: '🎵',
        game: '🎮'
    };

    const itemsHTML = visibleItems.map(item => `
        <div class="media-item">
            <div class="media-type ${item.type}">${typeEmoji[item.type] || '📌'} ${item.type}</div>
            <div class="media-name">${escapeHtml(item.name)}</div>
            <div class="media-desc">${escapeHtml(item.description || '')}</div>
        </div>
    `).join('');

    mediaContainer.innerHTML = itemsHTML;
}

// 渲染工作卡片
function renderWork(work) {
    const workCard = document.getElementById('workCard');
    const workContainer = document.getElementById('workContainer');

    const visibleItems = work.items.filter(item => item.visible !== false).slice(0, 5);

    if (visibleItems.length === 0) {
        workCard.style.display = 'none';
        return;
    }

    workCard.style.display = 'block';

    const itemsHTML = visibleItems.map(item => `
        <div class="insight-item">
            <div class="insight-title">${escapeHtml(item.title)}</div>
            <div class="insight-desc">${escapeHtml(item.description || '')}</div>
            ${item.date ? `<div class="insight-meta">📅 ${escapeHtml(item.date)}</div>` : ''}
        </div>
    `).join('');

    workContainer.innerHTML = itemsHTML;
}

// 渲染生活卡片
function renderLife(life) {
    const lifeCard = document.getElementById('lifeCard');
    const lifeContainer = document.getElementById('lifeContainer');

    const visibleItems = life.items.filter(item => item.visible !== false).slice(0, 5);

    if (visibleItems.length === 0) {
        lifeCard.style.display = 'none';
        return;
    }

    lifeCard.style.display = 'block';

    const itemsHTML = visibleItems.map(item => `
        <div class="insight-item">
            <div class="insight-title">${escapeHtml(item.title)}</div>
            <div class="insight-desc">${escapeHtml(item.description || '')}</div>
            ${item.date ? `<div class="insight-meta">📅 ${escapeHtml(item.date)}</div>` : ''}
        </div>
    `).join('');

    lifeContainer.innerHTML = itemsHTML;
}

// 显示历史记录模态框
function showHistoryModal(category, items, title) {
    const modal = document.getElementById('historyModal');
    const modalTitle = document.getElementById('historyModalTitle');
    const modalContent = document.getElementById('historyModalContent');

    modalTitle.textContent = title;

    if (items.length === 0) {
        modalContent.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">暂无历史记录</div>';
    } else {
        let itemsHTML = '';

        if (category === 'media') {
            const typeEmoji = {
                movie: '🎬',
                book: '📚',
                music: '🎵',
                game: '🎮'
            };

            itemsHTML = items.map(item => `
                <div class="history-item">
                    <div class="history-item-content">
                        <div class="media-type ${item.type}">${typeEmoji[item.type] || '📌'} ${item.type}</div>
                        <div class="media-name">${escapeHtml(item.name)}</div>
                        <div class="media-desc">${escapeHtml(item.description || '')}</div>
                        <div class="insight-meta">添加于 ${new Date(item.createdAt).toLocaleDateString()}</div>
                    </div>
                    <div class="history-item-actions">
                        <button class="history-item-btn ${item.visible !== false ? 'hide' : 'show'}"
                                onclick="toggleMediaVisibility('${item.id}', ${item.visible === false})">
                            ${item.visible !== false ? '隐藏' : '显示'}
                        </button>
                    </div>
                </div>
            `).join('');
        } else {
            itemsHTML = items.map(item => `
                <div class="history-item">
                    <div class="history-item-content">
                        <div class="insight-title">${escapeHtml(item.title)}</div>
                        <div class="insight-desc">${escapeHtml(item.description || '')}</div>
                        <div class="insight-meta">
                            ${item.date ? `📅 ${escapeHtml(item.date)} · ` : ''}
                            添加于 ${new Date(item.createdAt).toLocaleDateString()}
                        </div>
                    </div>
                    <div class="history-item-actions">
                        <button class="history-item-btn ${item.visible !== false ? 'hide' : 'show'}"
                                onclick="toggleItemVisibility('${category}', '${item.id}', ${item.visible === false})">
                            ${item.visible !== false ? '隐藏' : '显示'}
                        </button>
                    </div>
                </div>
            `).join('');
        }

        modalContent.innerHTML = itemsHTML;
    }

    modal.style.display = 'block';
}

// 切换媒体项可见性
async function toggleMediaVisibility(itemId, visible) {
    try {
        const response = await fetch(`/api/mem0/media/${itemId}/visibility`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visible })
        });

        const data = await response.json();

        if (data.ok) {
            await loadInsights();
            // 重新打开模态框以刷新内容
            const insights = await (await fetch('/api/mem0/insights')).json();
            if (insights.ok) {
                showHistoryModal('media', insights.insights.media.history, '书影音历史记录');
            }
        } else {
            alert('操作失败: ' + (data.error || '未知错误'));
        }
    } catch (error) {
        alert('操作失败: ' + error.message);
    }
}

// 切换工作/生活项可见性
async function toggleItemVisibility(category, itemId, visible) {
    try {
        const response = await fetch(`/api/mem0/${category}/${itemId}/visibility`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visible })
        });

        const data = await response.json();

        if (data.ok) {
            await loadInsights();
            // 重新打开模态框以刷新内容
            const insights = await (await fetch('/api/mem0/insights')).json();
            if (insights.ok) {
                const title = category === 'work' ? '工作历史记录' : '生活历史记录';
                showHistoryModal(category, insights.insights[category].history, title);
            }
        } else {
            alert('操作失败: ' + (data.error || '未知错误'));
        }
    } catch (error) {
        alert('操作失败: ' + error.message);
    }
}

// 初始化历史记录按钮
function initHistoryButtons() {
    const mediaHistoryBtn = document.getElementById('mediaHistoryBtn');
    const workHistoryBtn = document.getElementById('workHistoryBtn');
    const lifeHistoryBtn = document.getElementById('lifeHistoryBtn');
    const closeHistoryModal = document.getElementById('closeHistoryModal');
    const historyModal = document.getElementById('historyModal');

    if (mediaHistoryBtn) {
        mediaHistoryBtn.addEventListener('click', async () => {
            const response = await fetch('/api/mem0/insights');
            const data = await response.json();
            if (data.ok && data.insights) {
                showHistoryModal('media', data.insights.media.history, '书影音历史记录');
            }
        });
    }

    if (workHistoryBtn) {
        workHistoryBtn.addEventListener('click', async () => {
            const response = await fetch('/api/mem0/insights');
            const data = await response.json();
            if (data.ok && data.insights) {
                showHistoryModal('work', data.insights.work.history, '工作历史记录');
            }
        });
    }

    if (lifeHistoryBtn) {
        lifeHistoryBtn.addEventListener('click', async () => {
            const response = await fetch('/api/mem0/insights');
            const data = await response.json();
            if (data.ok && data.insights) {
                showHistoryModal('life', data.insights.life.history, '生活历史记录');
            }
        });
    }

    if (closeHistoryModal) {
        closeHistoryModal.addEventListener('click', () => {
            historyModal.style.display = 'none';
        });
    }

    // 点击模态框外部关闭
    if (historyModal) {
        historyModal.addEventListener('click', (e) => {
            if (e.target === historyModal) {
                historyModal.style.display = 'none';
            }
        });
    }
}

// ============================================================
// 图片上传功能：拖拽 / 粘贴 → 缓存到后端 → 缩略图网格预览
// 点击保存时才真正写入 Obsidian assets/
// ============================================================

const imagePreviewGrid = document.getElementById('imagePreviewGrid');
const imageUploadStatus = document.getElementById('imageUploadStatus');
const lightboxOverlay = document.getElementById('lightboxOverlay');
const lightboxImage = document.getElementById('lightboxImage');

/**
 * 上传单张图片到后端缓存目录，成功后加入 pendingImages 并刷新网格
 */
async function uploadImageToCache(file) {
    if (!file || !file.type.startsWith('image/')) return;

    if (pendingImages.length >= MAX_IMAGES) {
        alert(`最多只能上传 ${MAX_IMAGES} 张图片`);
        return;
    }

    setUploadStatus(`⏳ 正在上传 ${file.name}...`);

    try {
        const formData = new FormData();
        formData.append('image', file);

        const response = await fetch('/api/upload-image', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            pendingImages.push({
                filename: data.filename,
                previewUrl: data.previewUrl
            });
            savePendingImages();
            renderImagePreview();
            setUploadStatus('');
        } else {
            setUploadStatus(`❌ 上传失败: ${data.error || '未知错误'}`);
        }
    } catch (error) {
        console.error('[ImageUpload] 上传失败:', error);
        setUploadStatus(`❌ 上传失败: ${error.message}`);
    }
}

/**
 * 渲染图片缩略图网格
 */
function renderImagePreview() {
    if (!imagePreviewGrid) return;
    imagePreviewGrid.innerHTML = '';

    pendingImages.forEach((img, index) => {
        const item = document.createElement('div');
        item.className = 'image-preview-item';

        const imgEl = document.createElement('img');
        imgEl.src = img.previewUrl;
        imgEl.alt = `图片 ${index + 1}`;
        imgEl.addEventListener('click', () => openLightbox(img.previewUrl));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'image-preview-delete';
        deleteBtn.textContent = '×';
        deleteBtn.title = '移除';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            pendingImages.splice(index, 1);
            savePendingImages();
            renderImagePreview();
        });

        item.appendChild(imgEl);
        item.appendChild(deleteBtn);
        imagePreviewGrid.appendChild(item);
    });
}

/**
 * 打开灯箱查看大图
 */
function openLightbox(src) {
    if (!lightboxOverlay || !lightboxImage) return;
    lightboxImage.src = src;
    lightboxOverlay.classList.add('active');
}

if (lightboxOverlay) {
    lightboxOverlay.addEventListener('click', () => {
        lightboxOverlay.classList.remove('active');
        lightboxImage.src = '';
    });
}

/**
 * 设置上传状态文字
 */
function setUploadStatus(text) {
    if (imageUploadStatus) imageUploadStatus.textContent = text;
}

/**
 * 批量处理图片文件（顺序上传）
 */
async function handleImageFiles(files) {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const remaining = MAX_IMAGES - pendingImages.length;
    if (remaining <= 0) {
        alert(`最多只能上传 ${MAX_IMAGES} 张图片`);
        return;
    }

    const toUpload = imageFiles.slice(0, remaining);
    if (toUpload.length < imageFiles.length) {
        alert(`已达上限，仅上传前 ${toUpload.length} 张`);
    }

    for (const file of toUpload) {
        await uploadImageToCache(file);
    }
}

// ── 粘贴事件 ──
if (contentInput) {
    contentInput.addEventListener('paste', async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'));
        if (imageItems.length === 0) return;

        e.preventDefault();
        const files = imageItems.map(item => item.getAsFile()).filter(Boolean);
        await handleImageFiles(files);
    });

    // ── 拖拽事件 ──
    contentInput.addEventListener('dragover', (e) => {
        const hasImage = Array.from(e.dataTransfer?.items || [])
            .some(item => item.type.startsWith('image/'));
        if (!hasImage) return;
        e.preventDefault();
        contentInput.classList.add('drag-over');
    });

    contentInput.addEventListener('dragleave', (e) => {
        if (!contentInput.contains(e.relatedTarget)) {
            contentInput.classList.remove('drag-over');
        }
    });

    contentInput.addEventListener('drop', async (e) => {
        contentInput.classList.remove('drag-over');
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;

        const hasImage = Array.from(files).some(f => f.type.startsWith('image/'));
        if (!hasImage) return;

        e.preventDefault();
        await handleImageFiles(files);
    });
}

/**
 * 持久化 pendingImages 到 localStorage
 */
function savePendingImages() {
    try {
        localStorage.setItem('journal-sync-pending-images', JSON.stringify(pendingImages));
    } catch (e) {}
}

/**
 * 从 localStorage 恢复 pendingImages
 */
function restorePendingImages() {
    try {
        const saved = localStorage.getItem('journal-sync-pending-images');
        if (saved) {
            pendingImages = JSON.parse(saved);
            renderImagePreview();
        }
    } catch (e) {}
}

// 恢复缓存的图片
restorePendingImages();

// 页面加载完成后初始化
init();
