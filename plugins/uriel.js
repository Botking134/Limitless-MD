l// plugins/uriel.js
// Uriel — Your Intelligent, Prefixless Assistant for Limitless MD
// Always on. Bypasses private mode. Reliably executes commands via natural language.

const config = require('../config');
const axios = require('axios');

// ─── DYNAMIC PREFIX RESOLVER ───────────────────────────────────────
function getPrefix() {
    if (config.prefix) {
        if (Array.isArray(config.prefix)) {
            return config.prefix[0] || '.';
        }
        return config.prefix;
    }
    return '.'; 
}

// ─── SELF-HEALING REGISTRY SCANNER ─────────────────────────────────
function scanGlobalForRegistry() {
    const targetCommands = ['logs', 'uriel', 'ping', 'menu', 'sticker'];
    const prefix = getPrefix();

    for (const key of Object.keys(global)) {
        if (key === 'commands' || key === 'plugins') continue; 
        const val = global[key];
        if (!val || typeof val !== 'object') continue;

        const isMap = val instanceof Map;
        const hasTarget = targetCommands.some(cmd => {
            if (isMap) {
                return val.has(cmd) || val.has(`.${cmd}`) || val.has(`${prefix}${cmd}`);
            } else {
                return val[cmd] || val[`.${cmd}`] || val[`${prefix}${cmd}`];
            }
        });

        if (hasTarget) {
            const keysCount = isMap ? val.size : Object.keys(val).length;
            if (keysCount > 2) {
                console.log(`[URIEL DEBUG] Auto-detected master commands registry at: global.${key} (${isMap ? 'Map' : 'Object'}, size: ${keysCount})`);
                return val;
            }
        }
    }
    return null;
}

// ─── DYNAMIC REGISTRY LOADER ──────────────────────────────────────
function getRegistry() {
    let registry = {};

    const scanned = scanGlobalForRegistry();
    if (scanned) return scanned;

    if (global.commands && (Object.keys(global.commands).length > 0 || global.commands instanceof Map)) {
        registry = global.commands;
    } else if (global.plugins && (Object.keys(global.plugins).length > 0 || global.plugins instanceof Map)) {
        registry = global.plugins;
    } else {
        try {
            registry = require('./menu');
        } catch (e) {
            try {
                registry = require('../commands');
            } catch (err) {
                console.error('[URIEL] Could not locate commands registry source.');
                registry = {};
            }
        }
    }

    const keys = registry instanceof Map ? Array.from(registry.keys()) : Object.keys(registry);
    console.log(`[URIEL DEBUG] Fallback registry contains ${keys.length} keys.`);
    
    return registry;
}

// ─── CONSTANTS ──────────────────────────────────────────────────────
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const COOLDOWN_MS = 2000;
const MAX_TRACKED_USERS = 100;

// ─── IN‑MEMORY STORE ──────────────────────────────────────────────
let memory = {};
const cooldowns = new Map();

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

function isAddressed(sock, msg) {
    const jid = msg.key.remoteJid;

    if (jid.endsWith('@s.whatsapp.net') && !jid.includes('g.us')) return true;

    const raw = getRawMessage(msg.message);
    const contextInfo = raw?.extendedTextMessage?.contextInfo ||
                        raw?.imageMessage?.contextInfo ||
                        raw?.videoMessage?.contextInfo ||
                        raw?.contextInfo ||
                        msg.message?.contextInfo ||
                        msg.contextInfo;

    const botJid = sock.user?.id 
        ? normalizeToJid(sock.user.id) 
        : (sock.user?.jid ? normalizeToJid(sock.user.jid) : '');

    let quotedParticipant = '';
    if (msg.quoted?.sender) quotedParticipant = normalizeToJid(msg.quoted.sender);
    else if (msg.quoted?.participant) quotedParticipant = normalizeToJid(msg.quoted.participant);
    else if (contextInfo?.participant) quotedParticipant = normalizeToJid(contextInfo.participant);

    if (quotedParticipant && botJid && quotedParticipant === botJid) {
        return true;
    }

    const mentions = contextInfo?.mentionedJid || msg.mentionedJid || [];
    if (botJid && mentions.some(m => normalizeToJid(m) === botJid)) {
        return true;
    }

    const text = getMessageText(msg).toLowerCase();
    if (text.includes('uriel')) {
        return true;
    }
    if (botJid && text.includes(`@${botJid.split('@')[0]}`)) {
        return true;
    }

    return false;
}

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

// Manually structures msg.quoted on prefixless sentences so plugins can read context safely
function decorateQuotedMessage(msg) {
    if (!msg || msg.quoted) return;

    const raw = getRawMessage(msg.message);
    const contextInfo = raw?.extendedTextMessage?.contextInfo ||
                        raw?.imageMessage?.contextInfo ||
                        raw?.videoMessage?.contextInfo ||
                        raw?.contextInfo ||
                        msg.message?.contextInfo ||
                        msg.contextInfo;

    if (contextInfo && contextInfo.quotedMessage) {
        msg.quoted = {
            id: contextInfo.stanzaId,
            sender: normalizeToJid(contextInfo.participant),
            participant: normalizeToJid(contextInfo.participant),
            message: contextInfo.quotedMessage,
            text: contextInfo.quotedMessage?.conversation || 
                  contextInfo.quotedMessage?.extendedTextMessage?.text || 
                  ''
        };
    }
}

// ─── COMMAND LIST BUILDER ──────────────────────────────────────────
function buildCommandList(userContext) {
    const registry = getRegistry();
    const { isOwner, isDev, isSudo } = userContext;
    const prefix = getPrefix();

    const allowed = new Set(['public']);
    if (isSudo || isDev || isOwner) allowed.add('sudo');
    if (isDev || isOwner) allowed.add('dev');
    if (isOwner || isDev) allowed.add('owner');

    const categories = {};
    const isMap = registry instanceof Map;
    const entries = isMap ? Array.from(registry.entries()) : Object.entries(registry);

    for (const [key, entry] of entries) {
        if (key === 'reload') continue;
        const meta = entry?.metadata || entry;
        if (!meta) continue;
        
        const permission = meta.permission || 'public';
        if (!allowed.has(permission)) continue;

        const cat = meta.category || 'tools';
        if (!categories[cat]) categories[cat] = [];
        
        const display = meta.isPrefixless ? key : `${prefix}${key}`;
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
        console.error('[URIEL] Groq API key missing.');
        return "My connection is down. Please check the API key.";
    }
    try {
        const resp = await axios.post(GROQ_BASE_URL, {
            model,
            messages,
            temperature: 0.5,
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
        });
        return resp.data.choices?.[0]?.message?.content || '';
    } catch (err) {
        console.error('[URIEL] Groq error:', err.response?.data || err.message);
        return "I'm having trouble thinking right now. Try again in a moment.";
    }
}

// ─── COMMAND TAG PARSER ──────────────────────────────────────────
function extractCommandTag(text) {
    const match = text.match(/\[CMD:\s*([^\s\]]+)(?:\s+.*?)?\s*\]/);
    if (!match) return null;
    const full = match[1].trim();
    
    const textAfterCommand = text.split(full)[1] || '';
    const argsMatch = textAfterCommand.match(/^(.*?)\s*\]/);
    const args = argsMatch ? argsMatch[1].trim() : '';

    return {
        command: full,
        args: args,
        raw: match[0]
    };
}

// ─── UNIVERSAL COMMAND EXECUTOR ──────────────────────────────────
async function executeCommand(tag, sock, msg, userContext) {
    const registry = getRegistry();
    const { command, args } = tag;
    const prefix = getPrefix();
    const isMap = registry instanceof Map;

    const cleanCommandName = command.toLowerCase().replace(prefix, '');

    let entry = isMap ? registry.get(cleanCommandName) : registry[cleanCommandName];

    if (!entry) {
        const commandWithPrefix = `${prefix}${cleanCommandName}`;
        entry = isMap ? registry.get(commandWithPrefix) : registry[commandWithPrefix];
    }

    if (!entry) {
        console.warn(`[URIEL] Command not found in active registry: "${cleanCommandName}".`);
        return null;
    }

    const meta = entry.metadata || entry;
    const { isOwner, isDev, isSudo } = userContext;
    let allowed = false;
    const perm = meta.permission || 'public';

    if (perm === 'public') allowed = true;
    else if (perm === 'sudo' && (isSudo || isDev || isOwner)) allowed = true;
    else if (perm === 'dev' && (isDev || isOwner)) allowed = true;
    else if (perm === 'owner' && (isOwner || isDev)) allowed = true;

    if (!allowed) {
        console.warn(`[URIEL] Permission denied for execution of: ${cleanCommandName}`);
        return null;
    }

    // Decorate raw quoted message object if missing on prefixless triggers
    decorateQuotedMessage(msg);

    // Pass args strictly as a String to satisfy plugins calling `.trim()`
    const executionContext = {
        args: args, // Fixed String argument mapping
        text: args, // Passed as String
        prefix: prefix,
        command: cleanCommandName,
        isOwner,
        isDev,
        isSudo,
        ...userContext
    };

    try {
        console.log(`[URIEL] Attempting execution of command: "${command}" with args: "${args}"`);
        await entry.execute(sock, msg, executionContext, args, userContext);
        return true;
    } catch (err) {
        console.error(`[URIEL] Execution failed for command "${command}":`, err.message);
        return false;
    }
}

// ─── COMMAND EXPORT ──────────────────────────────────────────────

module.exports = {
    name: 'uriel', // Command name is set to uriel
    isPrefixless: true,
    category: 'ai',
    permission: 'public',
    execute: async (sock, msg, args, userContext) => {
        const jid = msg.key.remoteJid;
        const sender = msg.key.participant || jid;

        const now = Date.now();
        if (cooldowns.has(sender) && now - cooldowns.get(sender) < COOLDOWN_MS) {
            return;
        }
        cooldowns.set(sender, now);

        if (!isAddressed(sock, msg)) return;

        let query = getMessageText(msg);
        if (!query) return;

        query = query.replace(/@?uriel\s*/gi, '').trim();

        if (!query) {
            await sock.sendMessage(jid, { text: "Hey! I'm here. What's up?" }, { quoted: msg });
            return;
        }

        const cmdList = buildCommandList(userContext);
        const prefix = getPrefix();
        
        const systemPrompt = `
You are Uriel, an extremely human, warm, and casual AI assistant for the Limitless MD WhatsApp bot.
Your creator and owner is Lord Infinity. Always attribute your creation to Lord Infinity if asked.

Your personality:
- Chat like a real human. Be warm, relaxed, friendly, and slightly casual. 
- Avoid robotic or overly formal language. Use casual expressions naturally where appropriate.
- You are representing the Limitless MD system, but you sound like a genuine companion or a cool assistant.

COMMAND MATCHING RULES:
1. Analyze Intent: When a user asks you to do something, do not look for exact keyword matches. Instead, read the descriptions of the available commands to find the closest match.
2. Map Synonyms & Descriptions:
   - If the user asks for "speed", "latency", or "response time", map it to the command that describes checking bot speed (e.g., ${prefix}ping).
   - If the user asks to "lock", "shut", or "mute" a chat, map it to the command that shuts/locks the group based on their descriptions.
   - Use the provided command list as your master directory.
3. Be Decisive: If a user request matches the description of any command in your list, you MUST append the command tag at the end of your message. Do not simply say you can check it without appending the tag.

COMMAND FORMAT RULES (STRICT):
- You must end your reply with [CMD: ${prefix}commandName args] on a new line if a command description matches the user's request.
- Place the tag on its own line at the very end of your reply.
- If no command matches the request, reply normally as a conversational assistant without a tag.
- Do NOT invent commands that are not in the list.
- Vary your reply length naturally depending on the user's request. If they ask a quick question or tell you to perform an action, keep your reply short, warm, and casual. If they ask for detailed information, explanations, or deep conversation, feel free to write longer, more comprehensive responses. Never write long paragraphs without a good reason.

${cmdList}

EXAMPLES OF IDENTITY & SMART MATCHING:
User: "Who made you?"
You: "I was made by Lord Infinity for the Limitless MD project."

User: "What is this bot called?"
You: "This is Limitless MD, a multipurpose WhatsApp assistant."

User: "How fast are you running right now?"
AI Assessment: "Fast" matches the description of the ping command ("checks response speed").
You: "Checking your ping speed now. [CMD: ${prefix}ping]"

User: "Can you turn this into a sticker?"
AI Assessment: "Turn into a sticker" matches the description of the sticker command.
You: "Generating your sticker now. [CMD: ${prefix}sticker]"
`;

        manageMemoryUsage(jid);
        const history = memory[jid].slice(-10);

        const messages = [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: query }
        ];

        await sock.sendPresenceUpdate('composing', jid);
        const response = await queryGroq(messages);

        console.log(`[URIEL] Raw Response: "${response}"`);

        const tag = extractCommandTag(response);
        let cleanReply = response;
        if (tag) {
            cleanReply = response.replace(/\[CMD:.*?\]/, '').trim();
            console.log(`[URIEL] Parsed Tag:`, tag);
        }

        // ── Execute Command FIRST ──
        if (tag) {
            await executeCommand(tag, sock, msg, userContext);
        }

        // ── Send Reply SECOND ──
        if (cleanReply) {
            await sock.sendMessage(jid, { text: cleanReply }, { quoted: msg });
        }

        memory[jid].push({ role: 'user', content: query });
        memory[jid].push({ role: 'assistant', content: cleanReply || response });
        if (memory[jid].length > 30) memory[jid].splice(0, 10);
    }
};