// helpers/Summary.js

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

// Container-Safe Groq request handler using Config API Key & Llama-3.1-8B
async function queryGroq(messages, model = "llama-3.1-8b-instant") {
    // Fetch the secure API key from your config file
    const apiKey = config.groqApiKey;
    if (!apiKey) {
        throw new Error("Groq API key is not configured in config.groqApiKey");
    }
    
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

// Fixed to query Groq using Satoru Gojo's Llama-3.1-8b summary system with Race-Condition Protection
async function triggerSummary(sock, cleanChatJid) {
    const currentLogs = readGcLogs();
    const logs = currentLogs[cleanChatJid] || [];
    if (logs.length === 0) return;

    // 1. Capture exact state of logs before async call to prevent race conditions
    const logsToProcess = [...logs];
    const lastProcessedTime = logsToProcess[logsToProcess.length - 1]?.time || 0;

    const logString = logsToProcess.map(l => `[${new Date(l.time).toLocaleTimeString()}] ${l.sender}: ${l.text}`).join('\n');
    const prompt = "You are Satoru Gojo, the strongest Jujutsu Sorcerer. Summarize these group conversation logs. You must output exactly 10 bullet points. Keep your tone playful, informal, cocky, and teasing (as Satoru Gojo). Do not include any intro, outro, or conversational filler.";

    try {
        const responseText = await queryGroq([
            { role: "system", content: "You are Satoru Gojo." },
            { role: "user", content: `${prompt}\n\nHere are the chat logs:\n${logString}` }
        ], "llama-3.1-8b-instant");

        if (responseText) {
            const activeSocket = global.activeSock || sock;
            await activeSocket.sendMessage(cleanChatJid, { 
                text: `🤞 *LIMITLESS DOMAIN 3‑HOUR CONVERSATION SUMMARY:*\n\n${responseText.trim()}` 
            });
            
            // 2. Fetch fresh logs that may have been updated during the network delay
            const freshLogs = readGcLogs();
            
            // Clear only the processed logs up to the captured timestamp
            freshLogs[cleanChatJid] = (freshLogs[cleanChatJid] || []).filter(l => l.time > lastProcessedTime);
            saveGcLogs(freshLogs);
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