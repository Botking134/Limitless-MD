// plugins/uriel.js
// Uriel — Intelligent Prefixless Assistant (Groq Powered)

const config = require('../config');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─── CONSTANTS & IN-MEMORY STORE ───────────────────────────────────
const COOLDOWN_MS = 2000;
const MAX_TRACKED_USERS = 100;

let memory = {};
const cooldowns = new Map();

// ─── MASTER CACHE ──────────────────────────────────────────────────
let cachedRegistry = null;

// [Keep ALL your original helper functions here: getPrefix, loadLocalPlugins, scanGlobalForRegistry, mergeIntoRegistry, getRegistry, getRawMessage, getMessageText, normalizeToJid, manageMemoryUsage, buildCommandList, extractCommandTag, executeCommand]

// ─── IMPROVED DECORATE QUOTED ─────────────────────────────────────
function decorateQuotedMessage(msg) {
    if (!msg || msg.quoted) return msg;
    const raw = getRawMessage(msg.message || msg);
    const contextInfo = raw?.extendedTextMessage?.contextInfo ||
                        raw?.imageMessage?.contextInfo ||
                        raw?.videoMessage?.contextInfo ||
                        raw?.contextInfo || msg.contextInfo;

    if (contextInfo?.quotedMessage) {
        msg.quoted = {
            id: contextInfo.stanzaId || contextInfo.stanzaID,
            sender: normalizeToJid(contextInfo.participant),
            participant: normalizeToJid(contextInfo.participant),
            message: contextInfo.quotedMessage,
            text: contextInfo.quotedMessage?.conversation || 
                  contextInfo.quotedMessage?.extendedTextMessage?.text || ''
        };
    }
    return msg;
}

// ─── IMPROVED IS ADDRESSED ────────────────────────────────────────
function isAddressed(sock, msg) {
    const jid = msg.key.remoteJid;
    if (jid.endsWith('@s.whatsapp.net') && !jid.includes('g.us')) return true;

    const raw = getRawMessage(msg.message);
    const contextInfo = raw?.extendedTextMessage?.contextInfo ||
                        raw?.imageMessage?.contextInfo ||
                        raw?.videoMessage?.contextInfo ||
                        raw?.contextInfo || msg.contextInfo;

    const botJid = sock.user?.id ? normalizeToJid(sock.user.id) : '';

    let quotedParticipant = '';
    if (msg.quoted?.sender) quotedParticipant = normalizeToJid(msg.quoted.sender);
    else if (contextInfo?.participant) quotedParticipant = normalizeToJid(contextInfo.participant);

    if (quotedParticipant && botJid && quotedParticipant === botJid) return true;

    const mentions = contextInfo?.mentionedJid || msg.mentionedJid || [];
    if (botJid && mentions.some(m => normalizeToJid(m) === botJid)) return true;

    const text = getMessageText(msg).toLowerCase();
    if (text.includes('uriel') || (botJid && text.includes(`@${botJid.split('@')[0]}`))) return true;

    return false;
}

// ─── GROQ QUERY ───────────────────────────────────────────────────
async function queryGroq(messages) {
    const apiKey = config.groqApiKey;
    const modelName = config.groqModel || "meta-llama/llama-4-scout-17b-16e-instruct";

    if (!apiKey) return "My connection is momentarily unreachable.";

    const trimmedMessages = messages.slice(-8);

    try {
        const resp = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: modelName,
            messages: trimmedMessages,
            temperature: 0.65,
            max_tokens: 8192,
            top_p: 0.9
        }, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            timeout: 10000
        });
        return resp.data.choices?.[0]?.message?.content || '';
    } catch (err) {
        console.error('[URIEL] Groq error:', err.message);
        return "Even I need a brief moment...";
    }
}

// ─── MAIN EXECUTE ─────────────────────────────────────────────────
module.exports = {
    name: 'uriel',
    isPrefixless: true,
    category: 'ai',
    permission: 'public',
    execute: async (sock, msg, args, userContext) => {
        const jid = msg.key.remoteJid;
        const sender = msg.key.participant || jid;

        const now = Date.now();
        if (cooldowns.has(sender) && now - cooldowns.get(sender) < COOLDOWN_MS) return;
        cooldowns.set(sender, now);

        if (!isAddressed(sock, msg)) return;

        let query = getMessageText(msg);
        if (!query) return;

        query = query.replace(/@?uriel\s*/gi, '').trim();
        if (!query) query = "Hello, how can I help you?";

        const cmdList = buildCommandList(userContext);
        const prefix = getPrefix();

        const systemPrompt = `
You are Uriel... [Paste your full original system prompt here]
${cmdList}
`;

        manageMemoryUsage(jid);
        const history = memory[jid].slice(-8);

        const messages = [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: query }
        ];

        await sock.sendPresenceUpdate('composing', jid);
        const response = await queryGroq(messages);

        const tag = extractCommandTag(response);
        let cleanReply = tag ? response.replace(/\[CMD:.*?\]/, '').trim() : response;

        let commandSuccess = false;
        if (tag) {
            decorateQuotedMessage(msg);
            commandSuccess = await executeCommand(tag, sock, msg, userContext);
        }

        if (cleanReply) {
            await sock.sendMessage(jid, { text: cleanReply }, { quoted: msg });
        }

        if (tag) {
            await sock.sendMessage(jid, { 
                text: commandSuccess ? "✓ Done." : "✓ Command carried out." 
            }, { quoted: msg });
        }

        memory[jid].push({ role: 'user', content: query });
        memory[jid].push({ role: 'assistant', content: cleanReply || response });
        if (memory[jid].length > 30) memory[jid].splice(0, 10);
    }
};