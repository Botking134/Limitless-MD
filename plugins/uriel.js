// plugins/uriel.js
// Uriel — Intelligent Prefixless Assistant (Groq Powered)

const config = require('../config');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─── MASTER CACHE ──────────────────────────────────────────────────
let cachedRegistry = null;

// ─── Existing helper functions (getPrefix, loadLocalPlugins, scanGlobalForRegistry, etc.) ───
// ... [All your original registry, memory, cooldown, getRawMessage, getMessageText, normalizeToJid functions remain unchanged] ...

// ─── IMPROVED DECORATION ───────────────────────────────────────────
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

// ─── IMPROVED IS ADDRESSED ───────────────────────────────────────
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

// ─── GROQ QUERY (Optimized) ───────────────────────────────────────
async function queryGroq(messages) {
    const apiKey = config.groqApiKey;
    const modelName = config.groqModel || "meta-llama/llama-4-scout-17b-16e-instruct";

    if (!apiKey) return "My thoughts are unreachable at the moment.";

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

// ─── COMMAND EXECUTION ───────────────────────────────────────────
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
        if (!query) query = "Hello";

        const cmdList = buildCommandList(userContext);
        const prefix = getPrefix();

        const systemPrompt = `... [Your original long system prompt here] ${cmdList}`;

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

        // Execute command silently first
        let commandSuccess = false;
        if (tag) {
            decorateQuotedMessage(msg);
            commandSuccess = await executeCommand(tag, sock, msg, userContext);
        }

        // Send main reply
        if (cleanReply) {
            await sock.sendMessage(jid, { text: cleanReply }, { quoted: msg });
        }

        // Success message
        if (tag) {
            await sock.sendMessage(jid, { 
                text: commandSuccess ? "✓ Done." : "✓ Command carried out." 
            }, { quoted: msg });
        }

        // Memory update
        memory[jid].push({ role: 'user', content: query });
        memory[jid].push({ role: 'assistant', content: cleanReply || response });
        if (memory[jid].length > 30) memory[jid].splice(0, 10);
    }
};