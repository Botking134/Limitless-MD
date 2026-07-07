// plugins/uriel.js
// Uriel — Your Intelligent, Prefixless Assistant (Groq Powered)

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

// ─── DYNAMIC PREFIX RESOLVER ───────────────────────────────────────
function getPrefix() {
    if (config.prefix) {
        if (Array.isArray(config.prefix)) return config.prefix[0] || '.';
        return config.prefix;
    }
    return '.';
}

// ─── LOCAL DIRECTORY SCANNER ───────────────────────────────────────
function loadLocalPlugins() {
    const plugins = {};
    try {
        const files = fs.readdirSync(__dirname);
        for (const file of files) {
            if (file === 'uriel.js' || !file.endsWith('.js')) continue;
            try {
                const pluginPath = path.join(__dirname, file);
                const module = require(pluginPath);
                if (module && typeof module === 'object') {
                    const name = module.name || module.metadata?.name || path.basename(file, '.js');
                    plugins[name] = module;
                    if (module.commands && Array.isArray(module.commands)) {
                        for (const sub of module.commands) plugins[sub] = module;
                    }
                    if (module.metadata?.commands && Array.isArray(module.metadata.commands)) {
                        for (const sub of module.metadata.commands) plugins[sub] = module;
                    }
                }
            } catch (e) {}
        }
    } catch (err) {
        console.error('[URIEL] Failed to scan local plugins:', err.message);
    }
    return plugins;
}

// [Keep your original scanGlobalForRegistry, mergeIntoRegistry, getRegistry functions here]

function scanGlobalForRegistry() { /* your original code */ }
function mergeIntoRegistry(target, source) { /* your original code */ }
function getRegistry() { /* your original code */ }

// ─── RAW MESSAGE HELPERS ──────────────────────────────────────────
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

function getMessageText(msg) {
    if (!msg) return '';
    if (typeof msg === 'string') return msg;
    if (msg.body) return msg.body;
    if (msg.text) return msg.text;

    const raw = getRawMessage(msg.message);
    if (!raw) return '';

    return (
        raw.conversation ||
        raw.extendedTextMessage?.text ||
        raw.imageMessage?.caption ||
        raw.videoMessage?.caption ||
        raw.documentMessage?.caption ||
        ''
    );
}

function normalizeToJid(id) {
    if (!id) return '';
    return id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
}

function manageMemoryUsage(newJid) {
    const keys = Object.keys(memory);
    if (keys.length > MAX_TRACKED_USERS) delete memory[keys[0]];
    if (!memory[newJid]) memory[newJid] = [];
}

// ─── IMPROVED DECORATION & ADDRESS ───────────────────────────────
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
            text: contextInfo.quotedMessage?.conversation || contextInfo.quotedMessage?.extendedTextMessage?.text || ''
        };
    }
    return msg;
}

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

// ─── GROQ ─────────────────────────────────────────────────────────
async function queryGroq(messages) {
    const apiKey = config.groqApiKey;
    const modelName = config.groqModel || "meta-llama/llama-4-scout-17b-16e-instruct";

    if (!apiKey) return "My connection is momentarily unreachable.";

    try {
        const resp = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: modelName,
            messages: messages.slice(-8),
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
You are Uriel, an extremely human, warm, and casual AI assistant... 
[PASTE YOUR FULL ORIGINAL SYSTEM PROMPT HERE]
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
            await sock.sendMessage(jid, { text: commandSuccess ? "✓ Done." : "✓ Command carried out." }, { quoted: msg });
        }

        memory[jid].push({ role: 'user', content: query });
        memory[jid].push({ role: 'assistant', content: cleanReply || response });
        if (memory[jid].length > 30) memory[jid].splice(0, 10);
    }
};