// helpers/SummaryManager.js
const fs = require('fs');
const path = require('path');
const config = require('../config');
const axios = require('axios');

const settingsPath = path.join(__dirname, '../storage/gclog_settings.json');
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const THREE_HOURS_MS = 3 * 60 * 60 * 1000; // 3-hour interval window

global.groupLogs = global.groupLogs || {};
global.activeAizenSummaryIntervals = global.activeAizenSummaryIntervals || {};

// ─── SETTINGS FILE PERSISTENCE ────────────────────────────────────

function readSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            const rawData = fs.readFileSync(settingsPath, 'utf-8');
            return JSON.parse(rawData);
        }
    } catch (e) {
        console.error("⚠️ [GCLOG] Parse failed. Resolving to default settings.");
    }
    return {};
}

function saveSettings(settings) {
    try {
        const dir = path.dirname(settingsPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (e) { /* ignore */ }
}

// ─── LOGGING ENGINE ───────────────────────────────────────────────

function recordMessage(jid, sender, text) {
    if (!jid || !jid.endsWith('@g.us') || !text) return;

    const settings = readSettings();
    if (settings[jid] !== 'on') return;

    const now = Date.now();
    global.groupLogs[jid] = global.groupLogs[jid] || [];
    global.groupLogs[jid].push({
        sender: sender || 'User',
        text: text.trim(),
        time: now
    });

    // 3-hour sliding-window pruning
    global.groupLogs[jid] = global.groupLogs[jid].filter(l => now - l.time <= THREE_HOURS_MS);

    // If still over 100 messages, enforce maximum length cap
    if (global.groupLogs[jid].length > 100) {
        global.groupLogs[jid].shift();
    }
}

function clearGroupLogs(jid) {
    if (global.groupLogs && global.groupLogs[jid]) {
        delete global.groupLogs[jid];
        return true;
    }
    return false;
}

// ─── GROQ COGNITIVE ENGINE ────────────────────────────────────────

async function queryGroq(messages) {
    const apiKey = config.groqApiKey;
    if (!apiKey) throw new Error("GROQ_API_KEY is not set in config.");

    try {
        const resp = await axios.post(GROQ_BASE_URL, {
            model: "llama-3.1-8b-instant",
            messages,
            temperature: 0.6,
            max_tokens: 1500
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            timeout: 20000
        });
        return resp.data.choices?.[0]?.message?.content || '';
    } catch (err) {
        console.error('[GCLOG] Groq query failed:', err.message);
        throw err;
    }
}

async function generateAizenSummary(logs) {
    const now = Date.now();
    const activeLogs = logs.filter(l => now - l.time <= THREE_HOURS_MS);
    const formattedLogs = activeLogs.map(l => `[${l.sender}]: ${l.text}`).join('\n');

    const systemPrompt = 
        `You are Sōsuke Aizen, the former Captain of Division 5 and master of the Mirror Flower Water Moon (Kyōka Suigetsu).\n` +
        `You have been quietly observing the conversation of this group chat as if they are subjects in your laboratory.\n\n` +
        `Analyze the raw chat logs provided. You must provide a summary of their discussions in EXACTLY 10 bullet points.\n\n` +
        `Your tone must be strictly in-character as Sōsuke Aizen:\n` +
        `- Deeply calm, chillingly polite, highly intellectual, and quietly arrogant.\n` +
        `- View their topics as predictable, simple, and entirely within your calculations.\n` +
        `- Use signature Aizen-isms (e.g., "Since when were you under the impression...", "Admiration is the furthest thing from understanding", or "To trust is to seek dependency").\n` +
        `- Do not break character. Do not include any standard AI introductions or friendly opening remarks. Speak directly into their souls.\n\n` +
        `FORMAT & CONTENT RULES (CRITICAL):\n` +
        `- Start with an elegant, condescending Aizen opening remark.\n` +
        `- Output EXACTLY 10 bullet points. Each point MUST start with a simple bullet ("• ").\n` +
        `- EACH bullet point MUST be a detailed, rich, medium-length paragraph (exactly 2 to 3 sentences long). Explain who said what, the context of their debate, and add your own cold, philosophical insight. Do NOT write simple, short, or one-sentence lines.\n` +
        `- Do NOT use numbers, words like "First" or "Second", or rigid lists.\n` +
        `- End with a cold, manipulative Aizen closing remark.\n\n` +
        `TITLE:\n` +
        `🔮 *SŌSUKE AIZEN'S LOG ANALYSIS* 🔮\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze the recent group conversation logs:\n\n${formattedLogs}` }
    ];

    return await queryGroq(messages);
}

// ─── AUTOMATED TIMED SUMMARY SCHEDULER ────────────────────────────

function scheduleAutoSummary(jid) {
    // Prevent overlapping intervals for the same group JID
    if (global.activeAizenSummaryIntervals[jid]) {
        clearInterval(global.activeAizenSummaryIntervals[jid]);
    }

    global.activeAizenSummaryIntervals[jid] = setInterval(async () => {
        const activeSock = global.activeSock;
        if (!activeSock) return; // Exit silently if bot is offline/reconnecting

        const settings = readSettings();
        if (settings[jid] !== 'on') {
            clearInterval(global.activeAizenSummaryIntervals[jid]);
            delete global.activeAizenSummaryIntervals[jid];
            return;
        }

        const logs = global.groupLogs[jid] || [];
        // Filter expired messages from memory log window first
        const now = Date.now();
        const activeLogs = logs.filter(l => now - l.time <= THREE_HOURS_MS);
        global.groupLogs[jid] = activeLogs;

        if (activeLogs.length >= 5) {
            try {
                await activeSock.sendMessage(jid, { text: "🔮 *Kyōka Suigetsu: Automated 3-Hour Chronicle Expansion* 🔮" });
                const summaryResult = await generateAizenSummary(activeLogs);
                await activeSock.sendMessage(jid, { text: summaryResult.trim() });
            } catch (err) {
                console.error(`❌ [GCLOG AUTO] Failed to post automated summary to ${jid}:`, err.message);
            }
        }
    }, THREE_HOURS_MS);
}

function unscheduleAutoSummary(jid) {
    if (global.activeAizenSummaryIntervals[jid]) {
        clearInterval(global.activeAizenSummaryIntervals[jid]);
        delete global.activeAizenSummaryIntervals[jid];
    }
}

// Self-loading boot scheduler (runs automatically when module is loaded)
(function initPersistentAutoSummaries() {
    try {
        const settings = readSettings();
        let activeCount = 0;
        for (const [jid, state] of Object.entries(settings)) {
            if (state === 'on') {
                scheduleAutoSummary(jid);
                activeCount++;
            }
        }
        if (activeCount > 0) {
            console.log(`🔮 [GCLOG] Rescheduled active auto-summary loops for ${activeCount} groups.`);
        }
    } catch (e) {
        console.error("⚠️ [GCLOG] Failed to load auto-summary scheduler:", e.message);
    }
})();

module.exports = {
    readSettings,
    saveSettings,
    recordMessage,
    clearGroupLogs,
    generateAizenSummary,
    scheduleAutoSummary,
    unscheduleAutoSummary
};