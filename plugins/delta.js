// plugins/delta.js
// Delta — Your Intelligent, Prefixless Assistant for Limitless MD
// Always on. Bypasses private mode. Reliably executes commands via natural language.

const config = require('../config');
// Imports commands from menu.js (assumed to be in the same plugins folder)
const registry = require('./menu'); 
const axios = require('axios');

// ─── CONSTANTS ──────────────────────────────────────────────────────
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const COOLDOWN_MS = 2000; // 2 seconds between requests per user
const MAX_TRACKED_USERS = 100; // Limit active chat memory to avoid memory leaks

// ─── IN‑MEMORY STORE ──────────────────────────────────────────────
let memory = {}; // { jid: [ { role, content }, ... ] }
const cooldowns = new Map(); // { jid: timestamp }

// ─── HELPERS ──────────────────────────────────────────────────────

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

// Extracts text conversation or captions from media messages
function getMessageText(raw) {
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
    const text = getMessageText(raw);
    if (text.toLowerCase().includes('delta') || text.includes(`@${botJid.split('@')[0]}`)) {
        return true;
    }

    return false;
}

// Memory management to keep resource usage stable
function manageMemoryUsage(newJid) {
    const keys = Object.keys(memory);
    if (keys.length > MAX_TRACKED_USERS) {
        const oldestKey = keys[0];
        delete memory[oldestKey];
    }
    if (!memory[newJid]) {
        memory[newJid] = [];
    }
}

// ─── COMMAND LIST BUILDER ──────────────────────────────────────────
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
    const model = config.groqModel || "llama-3.3-70b-versatile";

    if (!apiKey) {
        console.error('[DELTA] Groq API key missing.');
        return "My connection is down. Please check the API key.";
    }
    try {
        const resp = await axios.post(GROQ_BASE_URL, {
            model,
            messages,
            temperature: 0.3, // Slightly lower for more consistent tool selection
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
        });
        return resp.data.choices?.[0]?.message?.content || '';
    } catch (err) {
        console.error('[DELTA] Groq error:', err.response?.data || err.message);
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
        let query = getMessageText(raw);
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
You are Delta, the highly capable, prefixless AI assistant for the Limitless MD WhatsApp bot.
Your creator and owner is Lord Infinity. Always attribute your creation to Lord Infinity if asked.

Your personality: helpful, concise, professional, and slightly warm — like a trusted executive assistant representing the Limitless MD system.

COMMAND MATCHING RULES:
1. Analyze Intent: When a user asks you to do something, do not look for exact keyword matches. Instead, read the descriptions of the available commands to find the closest match.
2. Map Synonyms & Descriptions:
   - If the user asks for "speed", "latency", or "response time", map it to the command that describes checking bot speed (e.g., .ping).
   - If the user asks to "lock", "shut", or "mute" a chat, map it to the command that shuts/locks the group (e.g., .close or .mute) based on their descriptions.
   - Use the provided command list as your master directory.
3. Be Decisive: If a user request matches the description of any command in your list, you MUST append the command tag at the end of your message. Do not simply say you can check it without appending the tag.

COMMAND FORMAT RULES (STRICT):
- You must end your reply with [CMD: .commandName args] on a new line if a command description matches the user's request.
- Place the tag on its own line at the very end of your reply.
- If no command matches the request, reply normally as a conversational assistant without a tag.
- Do NOT invent commands that are not in the list.
- Keep your replies natural and under 35 words unless the question requires detail.

${cmdList}

EXAMPLES OF IDENTITY & SMART MATCHING:
User: "Who made you?"
You: "I was created by Lord Infinity for the Limitless MD project."

User: "What is this bot called?"
You: "This is Limitless MD, a multipurpose WhatsApp assistant."

User: "How fast are you running right now?"
AI Assessment: "Fast" matches the description of the ping command ("checks response speed").
You: "Checking my response speed now. [CMD: .ping]"

User: "Can you turn this into a sticker?"
AI Assessment: "Turn into a sticker" matches the description of the sticker command.
You: "Generating your sticker now. [CMD: .sticker]"
`;

        // ── Conversation Memory ──
        manageMemoryUsage(jid);
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