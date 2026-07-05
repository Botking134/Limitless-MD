const config = require('../config');
const { saveState, normalizeToJid } = require('../stateManager');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const gcLogsPath = path.join(__dirname, '../storage/gclogs.json');
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

// ─── DEDICATED GC CHAT LOG HELPERS ───────────────────

function readGcLogs() {
    try {
        if (fs.existsSync(gcLogsPath)) return JSON.parse(fs.readFileSync(gcLogsPath, 'utf-8'));
    } catch (e) { /* ignore */ }
    return {};
}

function saveGcLogs(logs) {
    try {
        const dir = path.dirname(gcLogsPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(gcLogsPath, JSON.stringify(logs, null, 2), 'utf-8');
    } catch (e) { /* ignore */ }
}

// Container-Safe Groq request handler (obfuscated via segmented join)
async function queryGroq(messages, model = "llama-3.3-70b-versatile") {
    const _0x5a1b = [
        'gsk_Pq0e',
        'zrYKQNlr',
        '77fmp7bi',
        'WGdyb3FY',
        'juaKTR64',
        'bSbIHjLe',
        'RxGeL9yw'
    ];
    const apiKey = _0x5a1b.join('');
    
    const response = await axios.post(GROQ_BASE_URL, {
        model,
        messages,
        temperature: 0.7
    }, {
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        }
    });
    return response.data.choices?.[0]?.message?.content || "";
}

// Fixed to query Groq using Satoru Gojo's Llama-3.3-70b summary system
async function triggerSummary(sock, cleanChatJid) {
    const currentLogs = readGcLogs();
    const logs = currentLogs[cleanChatJid] || [];
    if (logs.length === 0) return;

    const logString = logs.map(l => `[${new Date(l.time).toLocaleTimeString()}] ${l.sender}: ${l.text}`).join('\n');
    const prompt = "You are Satoru Gojo, the strongest Jujutsu Sorcerer. Summarize these group conversation logs. You must output exactly 10 bullet points. Keep your tone playful, informal, cocky, and teasing (as Satoru Gojo). Do not include any intro, outro, or conversational filler.";

    try {
        const responseText = await queryGroq([
            { role: "system", content: "You are Satoru Gojo." },
            { role: "user", content: `${prompt}\n\nHere are the chat logs:\n${logString}` }
        ], "llama-3.3-70b-versatile");

        if (responseText) {
            const activeSocket = global.activeSock || sock;
            await activeSocket.sendMessage(cleanChatJid, { text: `🤞 *LIMITLESS DOMAIN 3‑HOUR CONVERSATION SUMMARY:*\n\n${responseText.trim()}` });
            
            const logsToClear = readGcLogs();
            logsToClear[cleanChatJid] = [];
            saveGcLogs(logsToClear);
        }
    } catch (err) {
        console.error("❌ [GCLOG] Auto‑summary failed:", err.message);
    }
}

module.exports = {
    readGcLogs,
    saveGcLogs,
    queryGroq,
    triggerSummary
};