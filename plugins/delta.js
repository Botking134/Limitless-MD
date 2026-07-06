// plugins/delta.js
// Delta — Your Intelligent, Prefixless Assistant
// Always on. Bypasses private mode. Reliably executes commands via natural language.

const config = require('../config');
const registry = require('../commands'); // Now stores { execute, metadata }
const axios = require('axios');

// ─── CONSTANTS ──────────────────────────────────────────────────────
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const COOLDOWN_MS = 2000; // 2 seconds between requests per user

// ─── IN‑MEMORY STORE ──────────────────────────────────────────────
const memory = {}; // { jid: [ { role, content }, ... ] }
const cooldowns = new Map(); // { jid: timestamp }

// ─── HELPERS ──────────────────────────────────────────────────────

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    if (message.conversation) return message;
    return message;
}

function normalizeToJid(id) {
    if (!id) return '';
    return id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
}

function isAddressed(sock, msg) {
    const jid = msg.key.remoteJid;

    // Private chat = always addressed
    if (jid.endsWith('@s.whatsapp.net') && !jid.includes('g.us')) return true;

    const raw = getRawMessage(msg.message);
    const contextInfo = raw?.extendedTextMessage?.contextInfo ||
                        raw?.imageMessage?.contextInfo ||
                        raw?.videoMessage?.contextInfo ||
                        raw?.contextInfo ||
                        msg.message?.contextInfo;

    const botJid = sock.user?.id ? normalizeToJid(sock.user.id) : '';

    // Check reply to bot
    if (contextInfo?.participant) {
        const quoted = normalizeToJid(contextInfo.participant);
        if (quoted === botJid) return true;
    }

    // Check mentions
    const mentions = contextInfo?.mentionedJid || [];
    if (mentions.some(m => normalizeToJid(m) === botJid)) return true;

    // Check text for "delta" or @mention
    const text = raw?.conversation || raw?.extendedTextMessage?.text || '';
    if (text.toLowerCase().includes('delta') || text.includes(`@${botJid.split('@')[0]}`)) {
        return true;
    }

    return false;
}

// ─── COMMAND LIST BUILDER (Local Copy) ──────────────────────────
function buildCommandList(userContext) {
    const { isOwner, isDev, isSudo } = userContext;

    const allowed = new Set(['public']);
    if (isSudo || isDev || isOwner) allowed.add('sudo');
    if (isDev || isOwner) allowed.add('dev');
    if (isOwner || isDev) allowed.add('owner');

    const categories = {};

    for (const [key, entry] of Object.entries(registry)) {
        if (key === 'reload') continue;
        const meta = entry.metadata;
        if (!meta) continue;
        if (!allowed.has(meta.permission)) continue;

        const cat = meta.category || 'tools';
        if (!categories[cat]) categories[cat] = [];
        const display = meta.isPrefixless ? key : `.${key}`;
        const usage = meta.usage || display;
        categories[cat].push(`  ${usage} — ${meta.description || 'No description'}`);
    }

    let output = "AVAILABLE COMMANDS:\n\n";
    for (const [cat, cmds] of Object.entries(categories)) {
        output += `📂 ${cat.toUpperCase()}\n`;
        output += cmds.join('\n') + '\n\n';
    }
    return output.trim();
}

// ─── GROQ API CALL ──────────────────────────────────────────────
async function queryGroq(messages) {
    const apiKey = config.groqApiKey;
    if (!apiKey) {
        console.error('[DELTA] Groq API key missing.');
        return "My connection is down. Please check the API key.";
    }
    try {
        const resp = await axios.post(GROQ_BASE_URL, {
            model: "llama-3.3-70b-versatile",
            messages,
            temperature: 0.4, // Lower for deterministic command output
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
        });
        return resp.data.choices?.[0]?.message?.content || '';
    } catch (err) {
        console.error('[DELTA] Groq error:', err.message);
        return "I'm having trouble thinking right now. Try again in a moment.";
    }
}

// ─── COMMAND TAG PARSER ──────────────────────────────────────────
function extractCommandTag(text) {
    const match = text.match(/\[CMD:\s*(\.[a-zA-Z0-9_-]+(?:\s+.*?)?)\s*\]/);
    if (!match) return null;
    const full = match[1].trim();
    const parts = full.split(/\s+/);
    return {
        command: parts[0].replace('.', ''),
        args: parts.slice(1).join(' '),
        raw: full
    };
}

// ─── SECURE COMMAND EXECUTOR ─────────────────────────────────────
async function executeCommand(tag, sock, msg, userContext) {
    const { command, args } = tag;
    const entry = registry[command] || registry[`.${command}`];
    if (!entry) {
        console.warn(`[DELTA] Unknown command: ${command}`);
        return null;
    }

    const meta = entry.metadata;
    if (!meta) return null;

    const { isOwner, isDev, isSudo } = userContext;
    let allowed = false;
    const perm = meta.permission || 'public';

    if (perm === 'public') allowed = true;
    else if (perm === 'sudo' && (isSudo || isDev || isOwner)) allowed = true;
    else if (perm === 'dev' && (isDev || isOwner)) allowed = true;
    else if (perm === 'owner' && (isOwner || isDev)) allowed = true;

    if (!allowed) {
        console.warn(`[DELTA] Permission denied for ${command} (requires ${perm})`);
        return null;
    }

    try {
        await entry.execute(sock, msg, args, userContext);
        return true;
    } catch (err) {
        console.error(`[DELTA] Execution failed for ${command}:`, err.message);
        return false;
    }
}

// ─── COMMAND EXPORT ──────────────────────────────────────────────

module.exports = {
    name: 'delta',
    isPrefixless: true,
    description: 'Intelligent assistant that executes commands via natural language.',
    category: 'ai',
    permission: 'public',
    execute: async (sock, msg, args, userContext) => {
        const jid = msg.key.remoteJid;
        const sender = msg.key.participant || jid;

        // ── Cooldown (prevent spam) ──
        const now = Date.now();
        if (cooldowns.has(sender) && now - cooldowns.get(sender) < COOLDOWN_MS) {
            return; // Silent ignore
        }
        cooldowns.set(sender, now);

        // ── Addressing Check ──
        if (!isAddressed(sock, msg)) return;

        // ── Extract user query ──
        const raw = getRawMessage(msg.message);
        let query = raw?.conversation || raw?.extendedTextMessage?.text || '';
        if (!query) return;

        // Clean up: remove "delta" mentions so it doesn't confuse the AI
        query = query.replace(/@?delta\s*/gi, '').trim();

        if (!query) {
            await sock.sendMessage(jid, { text: "I'm here. What do you need?" }, { quoted: msg });
            return;
        }

        // ── Build System Prompt ──
        const cmdList = buildCommandList(userContext);
        const systemPrompt = `
You are Delta, a highly capable, real AI assistant for a WhatsApp bot.
Your personality: helpful, concise, professional, and slightly warm — like a trusted executive assistant.
You have access to a command library to perform actions on behalf of the user.

COMMAND FORMAT RULES (STRICT):
- If the user asks you to DO something (close group, delete a message, make a sticker, etc.), you MUST end your reply with:
  [CMD: .commandName args]
- Place the tag on its own line at the very end of your reply.
- If the user is just chatting or asking for info, reply normally WITHOUT a tag.
- Do NOT invent commands that are not listed below.
- Keep your replies natural and under 30 words unless the question requires detail.

${cmdList}

EXAMPLES:
User: "Can you close the group?"
You: "Sure, locking it now. [CMD: .close]"

User: "Delete this message" (replying to a message)
You: "Got it. Deleted. [CMD: .delete]"

User: "Who made you?"
You: "I was built by Isaac as part of the Limitless project."
`;

        // ── Conversation Memory ──
        if (!memory[jid]) memory[jid] = [];
        const history = memory[jid].slice(-10); // Keep last 10 exchanges

        const messages = [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: query }
        ];

        // ── AI Processing ──
        await sock.sendPresenceUpdate('composing', jid);
        const response = await queryGroq(messages);

        // ── Parse Tag ──
        const tag = extractCommandTag(response);
        let cleanReply = response;
        if (tag) {
            cleanReply = response.replace(/\[CMD:.*?\]/, '').trim();
        }

        // ── Send Reply ──
        if (cleanReply) {
            await sock.sendMessage(jid, { text: cleanReply }, { quoted: msg });
        }

        // ── Update Memory ──
        memory[jid].push({ role: 'user', content: query });
        memory[jid].push({ role: 'assistant', content: cleanReply || response });
        if (memory[jid].length > 30) memory[jid].splice(0, 10);

        // ── Execute Command (Bypasses private mode) ──
        if (tag) {
            await executeCommand(tag, sock, msg, userContext);
        }
    }
};