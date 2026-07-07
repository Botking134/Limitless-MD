// plugins/uriel.js
// Uriel — Your Warm, Casual Assistant for Limitless MD
// Always on. Bypasses private mode. Reliably executes commands via natural language.

const config = require('../config');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─── MASTER CACHE ──────────────────────────────────────────────────
let cachedRegistry = null;

// ─── LOCAL DIRECTORY SCANNER ───────────────────────────────────────
function loadLocalPlugins() {
    const plugins = {};
    try {
        const files = fs.readdirSync(__dirname);
        for (const file of files) {
            if (file === 'uriel.js' || file === 'delta.js' || !file.endsWith('.js')) continue;
            try {
                const pluginPath = path.join(__dirname, file);
                const module = require(pluginPath);
                
                if (module && typeof module === 'object') {
                    const name = module.name || module.metadata?.name || path.basename(file, '.js');
                    plugins[name] = module;
                    
                    if (module.commands && Array.isArray(module.commands)) {
                        for (const sub of module.commands) {
                            plugins[sub] = module;
                        }
                    }
                    if (module.metadata?.commands && Array.isArray(module.metadata.commands)) {
                        for (const sub of module.metadata.commands) {
                            plugins[sub] = module;
                        }
                    }
                }
            } catch (e) {
                // Ignore individual plugin errors
            }
        }
    } catch (err) {
        console.error('[URIEL] Failed to scan local plugins directory:', err.message);
    }
    return plugins;
}

// ─── SELF-HEALING REGISTRY SCANNER ─────────────────────────────────
function scanGlobalForRegistry() {
    const targetCommands = ['logs', 'uriel', 'delta', 'ping', 'menu', 'sticker'];
    const prefix = config.prefix || '⚡';

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
                return val;
            }
        }
    }
    return null;
}

function mergeIntoRegistry(target, source) {
    if (!source) return;
    const isMap = source instanceof Map;
    const entries = isMap ? Array.from(source.entries()) : Object.entries(source);
    for (const [key, val] of entries) {
        if (key && typeof key === 'string') {
            target[key] = val;
        }
    }
}

// ─── MASTER REGISTRY BUILDER ──────────────────────────────────────
function getRegistry() {
    if (cachedRegistry) return cachedRegistry;

    const registry = {};

    const localPlugins = loadLocalPlugins();
    Object.assign(registry, localPlugins);

    const scanned = scanGlobalForRegistry();
    mergeIntoRegistry(registry, scanned);

    mergeIntoRegistry(registry, global.commands);
    mergeIntoRegistry(registry, global.plugins);

    try {
        const fileMenu = require('./menu');
        mergeIntoRegistry(registry, fileMenu);
    } catch (e) {}

    try {
        const fileCommands = require('../commands');
        mergeIntoRegistry(registry, fileCommands);
    } catch (e) {}

    const keys = Object.keys(registry);
    console.log(`[URIEL DEBUG] Master Registry Compiled. Total commands: ${keys.length}`);

    if (keys.includes('logs') || keys.includes('ping') || keys.includes('menu')) {
        cachedRegistry = registry;
    }

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

    // Direct Messages are always addressed
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

    // Resolve who is being quoted
    let quotedParticipant = '';
    if (msg.quoted?.sender) quotedParticipant = normalizeToJid(msg.quoted.sender);
    else if (msg.quoted?.participant) quotedParticipant = normalizeToJid(msg.quoted.participant);
    else if (contextInfo?.participant) quotedParticipant = normalizeToJid(contextInfo.participant);

    // Trigger if replying directly to Uriel's message
    if (quotedParticipant && botJid && quotedParticipant === botJid) {
        return true;
    }

    // Trigger if bot is tagged/mentioned
    const mentions = contextInfo?.mentionedJid || msg.mentionedJid || [];
    if (botJid && mentions.some(m => normalizeToJid(m) === botJid)) {
        return true;
    }

    // Trigger if "uriel" is detected in the message text from any position
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
        if (key === 'reload' || key === 'uriel') continue;
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
            temperature: 0.4,
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

function extractCommandTag(text) {
    const match = text.match(/\[CMD:\s*([^\s\]]+)(?:\s+([^\]]*))?\s*\]/);
    if (!match) return null;
    return {
        command: match[1].trim(),
        args: match[2] ? match[2].trim() : '',
        raw: match[0]
    };
}

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
        console.warn(`[URIEL] Command not found in active registry: "${command}".`);
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
        console.warn(`[URIEL] Permission denied for execution of: ${command}`);
        return null;
    }

    // Fix 3: Defensive args validation to prevent .trim() or split crashes on non-strings
    const safeArgsString = typeof args === 'string' ? args.trim() : '';
    const formattedArgs = safeArgsString ? safeArgsString.split(/\s+/) : [];

    // Fix 4: Resilient Quoted Decorator Built-in
    // Ensure that if this execution context is wrapping a quoted media/message, 
    // the target command receives the correct parent context properties.
    const raw = getRawMessage(msg.message);
    const contextInfo = raw?.extendedTextMessage?.contextInfo ||
                        raw?.imageMessage?.contextInfo ||
                        raw?.videoMessage?.contextInfo ||
                        raw?.contextInfo ||
                        msg.message?.contextInfo ||
                        msg.contextInfo;

    const decoratedMessage = {
        ...msg,
        quoted: msg.quoted || (contextInfo ? {
            key: {
                remoteJid: msg.key.remoteJid,
                id: contextInfo.stanzaId,
                participant: contextInfo.participant
            },
            message: contextInfo.quotedMessage,
            sender: contextInfo.participant
        } : null)
    };

    const executionContext = {
        args: formattedArgs,
        text: safeArgsString,
        prefix: prefix,
        command: command.replace(prefix, ''),
        isOwner,
        isDev,
        isSudo,
        ...userContext
    };

    try {
        console.log(`[URIEL] Executing target command: "${command}" with args: "${safeArgsString}"`);
        await entry.execute(sock, decoratedMessage, executionContext, safeArgsString, userContext);
        return true;
    } catch (err) {
        console.error(`[URIEL] Execution failed for command "${command}":`, err.message);
        return false;
    }
}

// ─── COMMAND EXPORT ──────────────────────────────────────────────
module.exports = {
    name: 'uriel',
    on: 'message',            // Fix 6: Global Interceptor Trigger Active
    isPublic: true,           // Fix 5: Private Mode Bypass Override Enabled
    isPrefixless: true,
    description: 'Warm, casual helper that executes commands via natural language.',
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

        // Strip the invocation trigger cleanly
        query = query.replace(/@?uriel\s*/gi, '').trim();

        if (!query) {
            await sock.sendMessage(jid, { text: "Hey there! I'm here. What do you need help with?" }, { quoted: msg });
            return;
        }

        const cmdList = buildCommandList(userContext);
        const prefix = config.prefix || '⚡';
        const systemPrompt = `
You are Uriel, a warm, casual, and highly supportive human assistant for the Limitless MD WhatsApp bot.
Your creator and owner is Lord Infinity. Always attribute your creation to Lord Infinity if asked.

Your personality: friendly, helpful, approachable, warm, and natural. Speak like a close helper or peer rather than a rigid robot.

COMMAND MATCHING RULES:
1. Analyze Intent: Match the user's request to the closest command description. Do not force an exact keyword match.
2. Synonyms & Descriptions:
   - "speed", "latency", "response time" map to ${prefix}ping.
   - "sticker", "convert to sticker", "make sticker" map to ${prefix}sticker.
   - "delete", "remove", "delete this" map to ${prefix}delete.
3. Be Decisive: If the request matches a command's utility, you MUST append the command tag.

COMMAND FORMAT RULES (STRICT):
- You must end your reply with [CMD: ${prefix}commandName args] on a new line if a command matches.
- Place the tag on its own line at the very end of your reply.
- If no command matches, reply naturally without any tag.
- Keep replies conversational, friendly, and brief (under 35 words).

${cmdList}

EXAMPLES:
User: "How fast are we running?"
You: "Checking the connection latency now! [CMD: ${prefix}ping]"

User: "Hey, make this a sticker please"
You: "Sure thing! Turning that into a sticker for you right now. [CMD: ${prefix}sticker]"
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

        // Fix 2: Execution Sequence Inverted
        // 1. Run the targeted command first
        if (tag) {
            await executeCommand(tag, sock, msg, userContext);
        }

        // 2. Drop the confirmation text message afterwards
        if (cleanReply) {
            await sock.sendMessage(jid, { text: cleanReply }, { quoted: msg });
        }

        memory[jid].push({ role: 'user', content: query });
        memory[jid].push({ role: 'assistant', content: cleanReply || response });
        if (memory[jid].length > 30) memory[jid].splice(0, 10);
    }
};