// helpers/FilterManager.js
const fs = require('fs');
const path = require('path');

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
    return { group: {}, pm: {} };
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

// ─── FILTER MESSAGE INTERCEPTOR ──────────────────────────────────
async function handleFilterInterceptor(sock, msg, textBody, jid) {
    if (!textBody || !jid) return false;
    if (msg.key.fromMe) return false;

    const isGroup = jid.endsWith('@g.us');
    const scopeKey = isGroup ? 'group' : 'pm';

    const data = readFilters();
    const chatFilters = data[scopeKey]?.[jid];

    if (!chatFilters || Object.keys(chatFilters).length === 0) return false;

    const lowerText = textBody.toLowerCase();

    for (const [triggerKey, filter] of Object.entries(chatFilters)) {
        const triggerLower = triggerKey.toLowerCase();
        
        // Match anywhere in the sentence (substring or word boundary)
        if (lowerText.includes(triggerLower)) {
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