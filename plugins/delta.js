// plugins/delta.js
// Delta — Your Intelligent, Prefixless Assistant for Limitless MD
// Always on. Bypasses private mode. Reliably executes commands via natural language.

const config = require('../config');
const axios = require('axios');

// ─── SELF-HEALING REGISTRY SCANNER ─────────────────────────────────
// Scans the running process memory to find the exact object holding your commands
function scanGlobalForRegistry() {
    const targetCommands = ['logs', 'delta', 'ping', 'menu', 'sticker'];
    const prefix = config.prefix || '⚡';

    for (const key of Object.keys(global)) {
        if (key === 'commands' || key === 'plugins') continue; // Skip what we manually check next
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
                console.log(`[DELTA DEBUG] Auto-detected master commands registry at: global.${key} (${isMap ? 'Map' : 'Object'}, size: ${keysCount})`);
                return val;
            }
        }
    }
    return null;
}

// ─── DYNAMIC REGISTRY LOADER ──────────────────────────────────────
function getRegistry() {
    let registry = {};

    // 1. Try to auto-detect the real command registry in memory
    const scanned = scanGlobalForRegistry();
    if (scanned) return scanned;

    // 2. Standard fallbacks
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
                console.error('[DELTA] Could not locate commands registry source.');
                registry = {};
            }
        }
    }

    const keys = registry instanceof Map ? Array.from(registry.keys()) : Object.keys(registry);
    console.log(`[DELTA DEBUG] Fallback registry contains ${keys.length} keys.`);
    
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

    const text = getMessageText(msg);
    if (text.toLowerCase().includes('delta')) {
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

// ─── COMMAND LIST BUILDER ──────────────────────────────────────────
function buildCommandList(userContext) {
    const registry = getRegistry();
    const { isOwner, isDev, isSudo } = userContext;
    const prefix = config.prefix || '⚡';

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
        console.error('[DELTA] Groq API key missing.');
        return "My connection is down. Please check the API key.";
    }
    try {
        const resp = await axios.post(GROQ_BASE_URL, {
            model,
            messages,
            temperature: 0.3,
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
    const prefix = config.prefix || '⚡';
    const isMap = registry instanceof Map;

    let entry = isMap ? registry.get(command) : registry[command];

    if (!entry) {
        if (command.startsWith(prefix)) {
            const noPrefix = command.slice(prefix.length);
            entry = isMap ? registry.get(noPrefix) : registry[noPrefix];
        } else {
            const withPrefix = `${prefix}${command}`;
            entry = isMap ? registry.get(withPrefix) : registry[withPrefix];
        }
    }

    if (!entry) {
        console.warn(`[DELTA] Command not found in active registry: "${command}".`);
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
        console.warn(`[DELTA] Permission denied for execution of: ${command}`);
        return null;
    }

    const formattedArgs = args ? args.split(/\s+/) : [];
    const executionContext = {
        args: formattedArgs,
        text: args,
        prefix: prefix,
        command: command.replace(prefix, ''),
        isOwner,
        isDev,
        isSudo,
        ...userContext
    };

    try {
        console.log(`[DELTA] Attempting execution of command: "${command}" with args: "${args}"`);
        await entry.execute(sock, msg, executionContext, args, userContext);
        return true;
    } catch (err) {
        console.error(`[DELTA] Execution failed for command "${command}":`, err.message);
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

        const now = Date.now();
        if (cooldowns.has(sender) && now - cooldowns.get(sender) < COOLDOWN_MS) {
            return;
        }
        cooldowns.set(sender, now);

        if (!isAddressed(sock, msg)) return;

        let query = getMessageText(msg);
        if (!query) return;

        query = query.replace(/@?delta\s*/gi, '').trim();

        if (!query) {
            await sock.sendMessage(jid, { text: "I'm here. What do you need?" }, { quoted: msg });
            return;
        }

        const cmdList = buildCommandList(userContext);
        const prefix = config.prefix || '⚡';
        const systemPrompt = `
You are Delta, the highly capable, prefixless AI assistant for the Limitless MD WhatsApp bot.
Your creator and owner is Lord Infinity. Always attribute your creation to Lord Infinity if asked.

Your personality: helpful, concise, professional, and slightly warm — like a trusted executive assistant representing the Limitless MD system.

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
- Keep your replies natural and under 35 words unless the question requires detail.

${cmdList}

EXAMPLES OF IDENTITY & SMART MATCHING:
User: "Who made you?"
You: "I was created by Lord Infinity for the Limitless MD project."

User: "What is this bot called?"
You: "This is Limitless MD, a multipurpose WhatsApp assistant."

User: "How fast are you running right now?"
AI Assessment: "Fast" matches the description of the ping command ("checks response speed").
You: "Checking my response speed now. [CMD: ${prefix}ping]"

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

        console.log(`[DELTA] Raw Response: "${response}"`);

        const tag = extractCommandTag(response);
        let cleanReply = response;
        if (tag) {
            cleanReply = response.replace(/\[CMD:.*?\]/, '').trim();
            console.log(`[DELTA] Parsed Tag:`, tag);
        }

        if (cleanReply) {
            await sock.sendMessage(jid, { text: cleanReply }, { quoted: msg });
        }

        memory[jid].push({ role: 'user', content: query });
        memory[jid].push({ role: 'assistant', content: cleanReply || response });
        if (memory[jid].length > 30) memory[jid].splice(0, 10);

        if (tag) {
            await executeCommand(tag, sock, msg, userContext);
        }
    }
};