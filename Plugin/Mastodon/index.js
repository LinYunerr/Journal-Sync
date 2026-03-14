import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, 'config.json');

let configCache = null;

export async function loadConfig() {
    if (configCache) return configCache;
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        configCache = JSON.parse(data);
        return configCache;
    } catch (error) {
        console.error('[Mastodon Plugin] 配置文件读取失败:', error.message);
        return { instanceUrl: '', accessToken: '', visibility: 'unlisted' };
    }
}

export async function saveConfig(config) {
    configCache = config;
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * 上传单张图片到 Mastodon，返回 media_id
 * @param {string} imagePath - 图片绝对路径
 * @param {object} config - Mastodon 配置
 * @returns {string|null} media_id 或 null（失败时）
 */
async function uploadImageToMastodon(imagePath, config) {
    try {
        const fileBuffer = await fs.readFile(imagePath);
        const filename = path.basename(imagePath);

        // 简单通过扩展名判断 MIME 类型
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.png': 'image/png', '.gif': 'image/gif',
            '.webp': 'image/webp', '.heic': 'image/heic'
        };
        const mimeType = mimeTypes[ext] || 'image/jpeg';

        // 构造 multipart/form-data（手动拼接，避免额外依赖）
        const boundary = `----FormBoundary${Date.now()}`;
        const CRLF = '\r\n';
        const head = Buffer.from(
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
            `Content-Type: ${mimeType}${CRLF}${CRLF}`
        );
        const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
        const body = Buffer.concat([head, fileBuffer, tail]);

        const mediaUrl = new URL('/api/v1/media', config.instanceUrl).href;
        const response = await fetch(mediaUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.accessToken}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length.toString()
            },
            body
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[Mastodon Plugin] 图片上传失败 (${filename}):`, errText);
            return null;
        }

        const result = await response.json();
        console.log(`[Mastodon Plugin] 图片上传成功 (${filename}): media_id=${result.id}`);
        return result.id;
    } catch (error) {
        console.error(`[Mastodon Plugin] 图片上传异常 (${imagePath}):`, error.message);
        return null;
    }
}

export async function execute({ content, options, images = [] }) {
    const config = await loadConfig();

    if (!config.instanceUrl || !config.accessToken) {
        return { success: false, error: 'Mastodon 插件未配置 (Instance URL 或 Access Token 缺失)' };
    }

    try {
        const url = new URL('/api/v1/statuses', config.instanceUrl).href;
        const visibility = config.visibility || 'unlisted';

        // 去掉正文中的图片 Markdown 引用，避免与实际上传的图片重复
        const textContent = content.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();

        // 上传图片（最多 4 张，Mastodon 限制）
        let mediaIds = [];
        if (images.length > 0) {
            const toUpload = images.slice(0, 4);
            if (images.length > 4) {
                console.warn(`[Mastodon Plugin] 图片数量 ${images.length} 超过4张限制，仅发送前4张`);
            }
            const uploaded = await Promise.all(
                toUpload.map(imgPath => uploadImageToMastodon(imgPath, config))
            );
            mediaIds = uploaded.filter(id => id !== null);
        }

        const requestBody = {
            status: textContent || '📷',  // 若内容仅图片，给个默认占位
            visibility
        };
        if (mediaIds.length > 0) {
            requestBody.media_ids = mediaIds;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.accessToken}`
            },
            body: JSON.stringify(requestBody)
        });

        const result = await response.json();

        if (!response.ok) {
            return { success: false, error: result.error || 'Mastodon 发布失败' };
        }

        return { success: true, response: result, mediaCount: mediaIds.length };
    } catch (error) {
        console.error('[Mastodon Plugin] 发送失败:', error);
        return { success: false, error: error.message };
    }
}

export default {
    execute,
    loadConfig,
    saveConfig
};
