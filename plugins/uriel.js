// plugins/uriel.js
// Uriel — Your Intelligent, Prefixless Assistant for Limitless MD
// Always on. Bypasses private mode. Reliably executes commands via natural language.

const config = require('../config');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─── MASTER CACHE ──────────────────────────────────────────────────
let cachedRegistry = null;

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
                // Ignore loading errors for individual broken plugins
            }
        }
    } catch (err) {
        console.error('[URIEL] Failed to scan local plugins directory:', err.message);
    }
    return plugins;
}

// ─── SELF-HEALING REGISTRY SCANNER ─────────────────────────────────
function scanGlobalForRegistry() {
    try {
        const targetCommands = ['logs', 'uriel', 'ping', 'menu', 'sticker'];
        const prefix = getPrefix();

        for (const key of Object.keys(global)) {
            if (key === 'commands' || key === 'plugins') continue; 
            try {
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
            } catch (innerErr) {
                // Safely ignore secure getters
            }
        }
    } catch (e) {
        // Fallback gracefully
    }
    return null;
}

// Helper to safely merge Maps or Objects into our master registry
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

    // Point 6: Highly improved reply detection checks (since we decorateQuoted early)
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

// Point 5: Stronger decorateQuotedMessage for deep resolution of quoted media and metadata properties
function decorateQuotedMessage(msg) {
    if (!msg || msg.quoted) return;

    const raw = getRawMessage(msg.message);
    const contextInfo = raw?.extendedTextMessage?.contextInfo ||
                        raw?.imageMessage?.contextInfo ||
                        raw?.videoMessage?.contextInfo ||
                        raw?.documentMessage?.contextInfo ||
                        raw?.stickerMessage?.contextInfo ||
                        raw?.audioMessage?.contextInfo ||
                        raw?.contextInfo ||
                        msg.message?.contextInfo ||
                        msg.contextInfo;

    if (contextInfo && contextInfo.quotedMessage) {
        const quotedRaw = getRawMessage(contextInfo.quotedMessage);
        msg.quoted = {
            id: contextInfo.stanzaId,
            sender: normalizeToJid(contextInfo.participant),
            participant: normalizeToJid(contextInfo.participant),
            message: contextInfo.quotedMessage,
            text: quotedRaw?.conversation || 
                  quotedRaw?.extendedTextMessage?.text || 
                  quotedRaw?.imageMessage?.caption ||
                  quotedRaw?.videoMessage?.caption ||
                  quotedRaw?.documentMessage?.caption ||
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

// ─── Point 1 & 2: GROQ API CALL WITH 10S TIMEOUT & 8192 TOKENS ───
async function queryGroq(messages) {
    const apiKey = config.groqApiKey;
    const model = "Llama-4-Scout-17B-16E-Instruct";

    if (!apiKey) {
        console.error('[URIEL] Groq API key missing.');
        return "My connection is down. Please check the API key.";
    }
    try {
        const resp = await axios.post(GROQ_BASE_URL, {
            model,
            messages,
            temperature: 0.5,
            max_tokens: 8192 // Point 1: 8192 max tokens
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            timeout: 10000 // Point 2: 10s strict timeout
        });
        return resp.data.choices?.[0]?.message?.content || '';
    } catch (err) {
        console.error('[URIEL] Groq error:', err.response?.data || err.message);
        return "I'm having trouble thinking right now. Try again in a moment.";
    }
}

// ─── COMMAND TAG PARSER (Fixed spacing & prefix removal) ─────────
function extractCommandTag(text) {
    const match = text.match(/\[CMD:\s*([^\]]+)\]/i);
    if (!match) return null;

    const rawContent = match[1].trim(); 
    const prefix = getPrefix();

    let cleanContent = rawContent;
    if (cleanContent.startsWith(prefix)) {
        cleanContent = cleanContent.slice(prefix.length).trim();
    }

    const spaceIndex = cleanContent.indexOf(' ');
    let command = '';
    let args = '';

    if (spaceIndex === -1) {
        command = cleanContent.toLowerCase();
        args = '';
    } else {
        command = cleanContent.slice(0, spaceIndex).toLowerCase();
        args = cleanContent.slice(spaceIndex + 1).trim();
    }

    return {
        command: command, 
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

    let entry = isMap ? registry.get(command) : registry[command];

    if (!entry) {
        const withPrefix = `${prefix}${command}`;
        entry = isMap ? registry.get(withPrefix) : registry[withPrefix];
    }

    if (!entry) {
        console.warn(`[URIEL] Command not found in active registry: "${command}".`);
        return false;
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
        return false;
    }

    decorateQuotedMessage(msg);

    const formattedArgs = args ? args.split(/\s+/) : [];
    const executionContext = {
        args: formattedArgs,
        text: args,
        prefix: prefix,
        command: command,
        isOwner,
        isDev,
        isSudo,
        ...userContext
    };

    const commandFunction = typeof entry.execute === 'function' ? entry.execute : entry;

    if (typeof commandFunction !== 'function') {
        console.warn(`[URIEL] Resolved entry for "${command}" is not a valid executable function.`);
        return false;
    }

    try {
        console.log(`[URIEL] Attempting execution of command: "${command}" with args: "${args}"`);
        await commandFunction(sock, msg, args, executionContext);
        return true;
    } catch (err) {
        console.error(`[URIEL] Execution failed for command "${command}":`, err.message);
        return false;
    }
}

// ─── COMMAND EXPORT ──────────────────────────────────────────────

module.exports = {
    name: 'uriel',
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

        // Point 5 & 6: Decorate early so reply-checking handles nested quotes flawlessly
        decorateQuotedMessage(msg);

        if (!isAddressed(sock, msg)) return;

        let query = getMessageText(msg);
        if (!query) return;

        query = query.replace(/@?uriel\s*/gi, '').trim();

        // Point 3: Removed hardcoded greeting. Always passes queries to the model
        if (!query) {
            query = "Hello Uriel";
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
        // Point 2: Trimmed history length for speed optimization
        const history = memory[jid].slice(-6);

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

        let commandSuccess = false;

        // Point 4 — ─── STEP 1: Execute Command SILENTLY First ───
        if (tag) {
            commandSuccess = await executeCommand(tag, sock, msg, userContext);
        }

        // Point 4 — ─── STEP 2: Send conversational reply second ───
        if (cleanReply) {
            await sock.sendMessage(jid, { text: cleanReply }, { quoted: msg });
        }

        // Point 4 — ─── STEP 3: Immediately follow with success check message ───
        if (tag && commandSuccess) {
            await sock.sendMessage(jid, { text: "✓ Done ." }, { quoted: msg });
        }

        memory[jid].push({ role: 'user', content: query });
        memory[jid].push({ role: 'assistant', content: cleanReply || response });
        if (memory[jid].length > 30) memory[jid].splice(0, 10);
    }
};