// helpers/FilterManager.js
const fs = require('fs');
const path = require('path');
const config = require('../config');

const filtersPath = path.join(__dirname, '../storage/filters.json');
const mediaDir = path.join(__dirname, '../storage/filters_media');

function readFilters() {
    try {
        if (fs.existsSync(filtersPath)) {
            return JSON.parse(fs.readFileSync(filtersPath, 'utf-8'));
        }
    } catch (e) {
        console.error("⚠️ [FILTERS] Failed to parse filters file.");
    }
    return { globalGroup: {}, globalPM: {} };
}

function saveFilters(data) {
    try {
        const dir = path.dirname(filtersPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filtersPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) { /* ignore */ }
}

function ensureMediaDir() {
    try {
        if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
    } catch (e) { /* ignore */ }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── FILTER MESSAGE INTERCEPTOR ──────────────────────────────────
async function handleFilterInterceptor(sock, msg, textBody, jid) {
    if (!textBody || !jid) return false;
    if (msg.key.fromMe) return false;

    // 1. PREFIX BYPASS: Ignore messages that start with the active prefix
    const activePrefix = Array.isArray(config.prefix) ? (config.prefix[0] || '.') : (config.prefix || '.');
    if (textBody.startsWith(activePrefix)) {
        return false;
    }

    const isGroup = jid.endsWith('@g.us');
    const scopeKey = isGroup ? 'globalGroup' : 'globalPM';

    const data = readFilters();
    const chatFilters = data[scopeKey];

    if (!chatFilters || Object.keys(chatFilters).length === 0) return false;

    for (const [triggerKey, filter] of Object.entries(chatFilters)) {
        const escapedTrigger = escapeRegExp(triggerKey.toLowerCase());
        
        // 2. WORD BOUNDARY REGEX: Ensures exact word/phrase matching
        const regex = new RegExp(`(?:^|\\s|\\b)${escapedTrigger}(?:$|\\s|\\b)`, 'i');

        if (regex.test(textBody)) {
            try {
                if (filter.type === 'text') {
                    await sock.sendMessage(jid, { text: filter.content }, { quoted: msg });
                    return true;
                }

                if (filter.filePath && fs.existsSync(filter.filePath)) {
                    const buffer = fs.readFileSync(filter.filePath);

                    if (filter.type === 'image') {
                        await sock.sendMessage(jid, { image: buffer, caption: filter.caption || '' }, { quoted: msg });
                    } else if (filter.type === 'video') {
                        await sock.sendMessage(jid, { video: buffer, mimetype: filter.mimetype || 'video/mp4', caption: filter.caption || '' }, { quoted: msg });
                    } else if (filter.type === 'audio') {
                        await sock.sendMessage(jid, { audio: buffer, mimetype: filter.mimetype || 'audio/mpeg', ptt: filter.ptt || false }, { quoted: msg });
                    } else if (filter.type === 'sticker') {
                        await sock.sendMessage(jid, { sticker: buffer }, { quoted: msg });
                    } else if (filter.type === 'document') {
                        await sock.sendMessage(jid, { document: buffer, mimetype: filter.mimetype || 'application/octet-stream', fileName: filter.fileName || 'file' }, { quoted: msg });
                    }
                    return true;
                }
            } catch (err) {
                console.error(`❌ [FILTER INTERCEPTOR] Execution failed for "${triggerKey}":`, err.message);
            }
        }
    }
    return false;
}

module.exports = {
    readFilters,
    saveFilters,
    ensureMediaDir,
    mediaDir,
    handleFilterInterceptor
};