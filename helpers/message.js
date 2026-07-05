const fs = require('fs');
const path = require('path');
const { normalizeToJid } = require('../stateManager');

const userStatsPath = path.join(__dirname, '../storage/userStats.json');

// ─── USER STATS PERSISTENCE CACHE (Optimized In-Memory Cache) ───
let cachedUserStats = null;
let isUserStatsDirty = false;

function readUserStats() {
    if (cachedUserStats) return cachedUserStats;
    try {
        if (fs.existsSync(userStatsPath)) {
            cachedUserStats = JSON.parse(fs.readFileSync(userStatsPath, 'utf-8'));
            return cachedUserStats;
        }
    } catch (e) { /* ignore */ }
    cachedUserStats = {};
    return cachedUserStats;
}

function saveUserStats(stats) {
    cachedUserStats = stats;
    isUserStatsDirty = true;
}

// Writes the cached stats to disk every 10 seconds if modified
setInterval(() => {
    if (isUserStatsDirty && cachedUserStats) {
        try {
            const dir = path.dirname(userStatsPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(userStatsPath, JSON.stringify(cachedUserStats, null, 2), 'utf-8');
            isUserStatsDirty = false;
        } catch (e) { /* ignore */ }
    }
}, 10000);

// ─── MESSAGE NORMALIZERS ──────────────────────────────────────────

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    if (message.groupStatusMessageV2?.message) return getRawMessage(message.groupStatusMessageV2.message);
    return message;
}

function cleanJid(jid) {
    if (!jid) return '';
    const raw = normalizeToJid(jid);
    return raw.split('@')[0].split(':')[0] + '@' + raw.split('@')[1];
}

// Centralized body parser supporting modern Carousel response JSONs and nested Group Statuses
function extractBodyAndTrim(msg) {
    const rawMsg = getRawMessage(msg.message) || msg.message;
    let body = rawMsg?.conversation ||
               rawMsg?.extendedTextMessage?.text ||
               rawMsg?.imageMessage?.caption ||
               rawMsg?.videoMessage?.caption ||
               msg.message?.buttonsResponseMessage?.selectedButtonId ||
               msg.message?.templateButtonReplyMessage?.selectedId ||
               '';

    if (!body && msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
        try {
            const params = JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
            if (params && params.id) {
                body = params.id;
            }
        } catch (e) { /* ignore */ }
    }

    // Handles nested Group Status V2 text extraction
    if (!body && rawMsg?.groupStatusMessageV2?.message) {
        const statusInner = getRawMessage(rawMsg.groupStatusMessageV2.message);
        body = statusInner?.conversation || 
               statusInner?.extendedTextMessage?.text || 
               statusInner?.imageMessage?.caption || 
               statusInner?.videoMessage?.caption || 
               '';
    }

    return {
        rawMsg,
        body,
        trimmedMessageBody: body.trim(),
        lowerMessage: body.trim().toLowerCase()
    };
}

module.exports = {
    getRawMessage,
    cleanJid,
    extractBodyAndTrim,
    readUserStats,
    saveUserStats,
    userStatsPath
};