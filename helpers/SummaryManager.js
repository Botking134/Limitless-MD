// helpers/SummaryManager.js
const fs = require('fs');
const path = require('path');
const config = require('../config');
const axios = require('axios');

const settingsPath = path.join(__dirname, '../storage/gclog_settings.json');
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

global.groupLogs = global.groupLogs || {};
global.gclogLastTriggers = global.gclogLastTriggers || {};
global.autoLogInterval = global.autoLogInterval || null;

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

    global.groupLogs[jid] = global.groupLogs[jid] || [];
    global.groupLogs[jid].push({
        sender: sender || 'User',
        text: text.trim(),
        time: Date.now()
    });

    // Cap the logs at 100 messages per group
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
            max_tokens: 1000  // Optimized token size for concise summaries
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
    const formattedLogs = logs.map(l => `[${l.sender}]: ${l.text}`).join('\n');

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
        `- EACH bullet point MUST be 3 elegant, and sharp sentences (or maximum 5 sentences). Write direct, punchy, and concise insights that cut straight to the core of their discussions. Do NOT write long paragraphs.\n` +
        `- Do NOT use numbers, words like "First" or "Second", or rigid lists.\n` +
        `- End with a cold, manipulative Aizen closing remark.\n\n` +
        `TITLE:\n` +
        `🪄 *GROUP LOG ANALYSIS* 🪄\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze the recent group conversation logs:\n\n${formattedLogs}` }
    ];

    return await queryGroq(messages);
}

// ─── AUTOMATIC 3-HOUR LOGGING INTERVAL LOOP ────────────────────────

if (!global.autoLogInterval) {
    global.autoLogInterval = setInterval(async () => {
        const settings = readSettings();
        const now = Date.now();

        for (const [jid, state] of Object.entries(settings)) {
            // Check if both logging and the 3-hour auto-timer are enabled
            if (jid.endsWith('@g.us') && state === 'on' && settings[jid + '_autotimer'] === 'on') {
                const lastTrigger = global.gclogLastTriggers[jid] || 0;
                const threeHours = 3 * 60 * 60 * 1000;

                if (now - lastTrigger >= threeHours) {
                    global.gclogLastTriggers[jid] = now;

                    const activeSock = global.activeSock;
                    if (activeSock) {
                        const logs = global.groupLogs[jid] || [];
                        if (logs.length >= 5) {
                            try {
                                console.log(`⏳ [GCLOG TIMER] Executing scheduled 3-hour Aizen summary for: ${jid}`);
                                const summaryResult = await generateAizenSummary(logs);
                                await activeSock.sendMessage(jid, { text: summaryResult.trim() });
                            } catch (e) {
                                console.error(`⚠️ [GCLOG TIMER] Auto summary dispatch failed for ${jid}:`, e.message);
                            }
                        }
                    }
                }
            }
        }
    }, 5 * 60 * 1000); // Polling checker runs safely every 5 minutes
}

module.exports = {
    readSettings,
    saveSettings,
    recordMessage,
    clearGroupLogs,
    generateAizenSummary
};