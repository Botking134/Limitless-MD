// plugins/Cas.js
// Cas — Cosmic Armor Superman, the Thought Robot. Prefixless assistant for Limitless MD
// Always on. Bypasses private mode. Reliably executes commands via natural language.

const config = require('../config');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { saveState } = require('../stateManager');

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

// ─── GLOBAL ON/OFF STATE ───────────────────────────────────────────
// Cas defaults to active unless toggled off. Older installs saved this flag as
// `urielGlobalActive`, so carry that value over once instead of silently
// resetting the user's setting.
function isCasEnabled() {
    if (config.casGlobalActive === undefined && config.urielGlobalActive !== undefined) {
        config.casGlobalActive = config.urielGlobalActive;
    }
    return config.casGlobalActive !== false;
}

// Matches the name "Cas" as a whole word only, so "case" or "cash" never trigger it.
const CAS_NAME_REGEX = /\bcas\b/i;

// ─── LOCAL DIRECTORY SCANNER ───────────────────────────────────────
function loadLocalPlugins() {
    const plugins = {};
    try {
        const files = fs.readdirSync(__dirname);
        for (const file of files) {
            if (file === 'Cas.js' || !file.endsWith('.js')) continue;
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
        console.error('[CAS] Failed to scan local plugins directory:', err.message);
    }
    return plugins;
}

// ─── SELF-HEALING REGISTRY SCANNER ─────────────────────────────────
function scanGlobalForRegistry() {
    try {
        const targetCommands = ['logs', 'cas', 'ping', 'menu', 'sticker'];
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
                        console.log(`[CAS DEBUG] Auto-detected master commands registry at: global.${key} (${isMap ? 'Map' : 'Object'}, size: ${keysCount})`);
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
    console.log(`[CAS DEBUG] Master Registry Compiled. Total commands: ${keys.length}`);

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

// Upgraded to preserve `@lid` domains for modern account authentication
function normalizeToJid(id) {
    if (!id) return '';
    const clean = id.split(':')[0].split('@')[0];
    const domain = id.includes('@lid') ? '@lid' : '@s.whatsapp.net';
    return clean + domain;
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
    if (CAS_NAME_REGEX.test(text)) {
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
function decorateQuotedMessage(msg, botJid = '') {
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
        
        // FIX: If context participant is omitted, defaults safely to botJid
        const senderJid = contextInfo.participant || botJid;

        msg.quoted = {
            id: contextInfo.stanzaId,
            sender: normalizeToJid(senderJid),
            participant: normalizeToJid(senderJid),
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

// ─── VOICE SYNTHESIZER (Deep, cosmic) ───────────────────────────────
// Layered so Cas always has a voice:
//   1. Microsoft Edge neural TTS (deep male voice, lowered pitch, slower rate)
//   2. Google Translate TTS as a fallback if Edge TTS is missing or fails
//   3. An ffmpeg "cosmic" pass (pitch drop, bass, echo) over whichever source
//      worked. If ffmpeg is unavailable, the clean voice is sent as-is.
// Edge TTS needs one extra dependency:  npm install node-edge-tts
const os = require('os');
const { execFile } = require('child_process');

const CAS_VOICE = {
    voice: 'en-US-GuyNeural',
    lang: 'en-US',
    pitch: '-10%',
    rate: '-8%',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
};

// Pitch is dropped without changing speed, then bass + a soft echo give the
// vast, otherworldly tail. Tweak the numbers here to taste.
const COSMIC_FILTER = [
    'aresample=44100',
    'asetrate=41454',        // 44100 * 0.94 -> lower pitch
    'aresample=44100',
    'atempo=1.0638',         // 1 / 0.94 -> restore original speed
    'bass=g=5',
    'aecho=0.8:0.85:70|140:0.3|0.2',
    'volume=1.2'
].join(',');

function tmpFile(ext) {
    return path.join(os.tmpdir(), `cas_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
}

function safeUnlink(file) {
    try { fs.unlinkSync(file); } catch (_) {}
}

async function synthesizeWithEdge(text) {
    let EdgeTTS;
    try {
        ({ EdgeTTS } = require('node-edge-tts'));
    } catch (_) {
        return null; // package not installed -> fall back quietly
    }
    const out = tmpFile('mp3');
    try {
        const tts = new EdgeTTS(CAS_VOICE);
        await tts.ttsPromise(text, out);
        const buf = fs.readFileSync(out);
        return buf.length > 0 ? buf : null;
    } catch (e) {
        console.error('[CAS TTS] Edge TTS failed:', e.message);
        return null;
    } finally {
        safeUnlink(out);
    }
}

async function synthesizeWithGoogle(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en-us&client=tw-ob&q=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        if (response.ok) {
            return Buffer.from(await response.arrayBuffer());
        }
    } catch (e) {
        console.error('[CAS TTS] Google TTS failed:', e.message);
    }
    return null;
}

function applyCosmicEffect(inputBuffer) {
    return new Promise((resolve) => {
        const inFile = tmpFile('mp3');
        const outFile = tmpFile('mp3');
        try {
            fs.writeFileSync(inFile, inputBuffer);
        } catch (_) {
            return resolve(inputBuffer);
        }
        execFile(
            'ffmpeg',
            ['-y', '-i', inFile, '-af', COSMIC_FILTER, '-c:a', 'libmp3lame', '-q:a', '4', outFile],
            { timeout: 20000 },
            (err) => {
                let result = inputBuffer;
                if (err) {
                    console.error('[CAS TTS] Cosmic effect skipped (ffmpeg unavailable or failed):', err.message);
                } else {
                    try {
                        const processed = fs.readFileSync(outFile);
                        if (processed.length > 0) result = processed;
                    } catch (_) {}
                }
                safeUnlink(inFile);
                safeUnlink(outFile);
                resolve(result);
            }
        );
    });
}

async function synthesizeCasVoice(text) {
    // Keep voice replies a sensible length; very long text is slow and awkward to listen to.
    const spoken = text.length > 600 ? text.slice(0, 600) : text;
    const raw = (await synthesizeWithEdge(spoken)) || (await synthesizeWithGoogle(spoken));
    if (!raw) return null;
    return applyCosmicEffect(raw);
}

// ─── HYBRID INTENT INTERCEPTOR (Direct Action Router) ──────────────
function runSmartInterceptor(query) {
    const lower = query.toLowerCase().trim();

    // 1. Target Deletions
    if (lower.startsWith('delete') || lower.startsWith('del') || lower === 'remove this' || lower === 'remove') {
        return {
            cleanReply: "Deleting the message.",
            tag: { command: "delete", args: "" }
        };
    }

    // 2. Sticker Generation
    if (lower.includes('sticker') || lower.includes('to sticker') || lower.includes('make sticker')) {
        return {
            cleanReply: "Alright! Here's your sticker, let me know if you need anything else!",
            tag: { command: "sticker", args: "" }
        };
    }

    // 3. System Speed Metrics
    if (lower.includes('ping') || lower.includes('speed') || lower.includes('latency') || lower.includes('response time')) {
        return {
            cleanReply: "Sure thing! Checking that speed for you now...",
            tag: { command: "ping", args: "" }
        };
    }

    // 4. Summons and Broadcasts
    if (lower.includes('tag everyone') || lower.includes('tag all') || lower.includes('tagall') || lower === 'tag the group') {
        return {
            cleanReply: "Okay! Summoning everyone in the group now.",
            tag: { command: "tagall", args: "" }
        };
    }

    // 5. Mute/Lock Actions
    if (lower.includes('mute group') || lower.includes('mute chat') || lower.includes('lock group') || lower.includes('lock chat') || lower.includes('close group') || lower.includes('close chat')) {
        return {
            cleanReply: "Locking down the group parameters now.",
            tag: { command: "mute", args: "close" }
        };
    }

    // 6. Unmute/Unlock Actions
    if (lower.includes('unmute group') || lower.includes('unmute chat') || lower.includes('unlock group') || lower.includes('unlock chat') || lower.includes('open group') || lower.includes('open chat')) {
        return {
            cleanReply: "Opening up the group parameters for everyone.",
            tag: { command: "mute", args: "open" }
        };
    }

    return null;
}

// ─── COMMAND LIST BUILDER ──────────────────────────────────────────
function buildCommandList(userContext) {
    const registry = getRegistry();
    const { isOwner, isDev, isSudo } = userContext;
    const prefix = getPrefix();

    const privilegedCommands = new Set([
        'addowner', 'delowner', 'upgrade', 'diagnose', 'update', 
        'mode', 'setsudo', 'delsudo', 'restart', 'shutdown', 
        'ban', 'unban', 'setvar', 'settings', 'games_closeall', 
        'creategc', 'antipm'
    ]);

    const allowed = new Set(['public']);
    if (isSudo || isDev || isOwner) allowed.add('sudo');
    if (isDev || isOwner) allowed.add('dev');
    if (isOwner || isDev) allowed.add('owner');

    const categories = {};
    const isMap = registry instanceof Map;
    const entries = isMap ? Array.from(registry.entries()) : Object.entries(registry);

    const seenCommands = new Set();

    for (const [key, entry] of entries) {
        if (key === 'reload' || key === 'cas') continue;
        const meta = entry?.metadata || entry;
        if (!meta) continue;
        
        const permission = meta.permission || 'public';
        if (!allowed.has(permission)) continue;

        const cleanKey = key.toLowerCase().replace(prefix, '');
        
        if (!isOwner && !isDev && !isSudo && privilegedCommands.has(cleanKey)) {
            continue;
        }

        const primaryName = meta.name || cleanKey;
        if (seenCommands.has(primaryName)) {
            continue;
        }
        seenCommands.add(primaryName);

        const cat = meta.category || 'tools';
        if (!categories[cat]) categories[cat] = [];
        
        const display = meta.isPrefixless ? primaryName : `${prefix}${primaryName}`;
        const desc = (meta.description || 'No description').trim();
        
        categories[cat].push(`${display}(${desc})`);
    }

    let output = "AVAILABLE COMMANDS:\n";
    for (const [cat, cmds] of Object.entries(categories)) {
        if (cmds.length === 0) continue;
        output += `• ${cat.toUpperCase()}: ${cmds.join(', ')}\n`;
    }
    return output.trim();
}

// ─── HIGH-THROUGHPUT GROQ API CALL ─────────────────────────────────
async function queryGroq(messages) {
    const apiKey = config.groqApiKey;
    const model = "openai/gpt-oss-20b"; 

    if (!apiKey) {
        console.error('[CAS] Groq API key missing.');
        return "My connection is down. Please check the API key.";
    }
    try {
        const resp = await axios.post(GROQ_BASE_URL, {
            model,
            messages,
            temperature: 0.5,
            max_tokens: 300 
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            timeout: 10000 
        });
        return resp.data.choices?.[0]?.message?.content || '';
    } catch (err) {
        console.error('[CAS] Groq error:', err.response?.data || err.message);
        return "I'm having trouble thinking right now. Try again in a moment.";
    }
}

// ─── COMMAND TAG PARSER ───────────────────────────────────────────
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
        console.warn(`[CAS] Command not found in active registry: "${command}".`);
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
        console.warn(`[CAS] Permission denied for execution of: ${command}`);
        return false;
    }

    const botJid = sock.user?.id 
        ? normalizeToJid(sock.user.id) 
        : (sock.user?.jid ? normalizeToJid(sock.user.jid) : '');

    decorateQuotedMessage(msg, botJid);

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
        console.warn(`[CAS] Resolved entry for "${command}" is not a valid executable function.`);
        return false;
    }

    try {
        console.log(`[CAS] Attempting execution of command: "${command}" with args: "${args}"`);
        await commandFunction(sock, msg, args, executionContext);
        return true;
    } catch (err) {
        console.error(`[CAS] Execution failed for command "${command}":`, err.message);
        return false;
    }
}

// ─── COMMAND EXPORT ──────────────────────────────────────────────

module.exports = {
    name: 'cas',
    isPrefixless: true,
    category: 'ai',
    permission: 'public',
    execute: async (sock, msg, args, userContext) => {
        // Strictly restrict Cas to Devs, Owners, and Sudo users only
        const { isOwner, isSudo, isDev } = userContext || {};
        const isAuthorized = isOwner || isSudo || isDev;
        if (!isAuthorized) return;

        const jid = msg.key.remoteJid;
        const sender = msg.key.participant || jid;
        const prefix = getPrefix();
        const textMessageBody = getMessageText(msg).trim();

        const now = Date.now();
        if (cooldowns.has(sender) && now - cooldowns.get(sender) < COOLDOWN_MS) {
            return;
        }
        cooldowns.set(sender, now);

        // ─── STEP 0.1: GLOBAL COMMAND ACTIVE/TOGGLE CHECKS (Case-Insensitive Fix) ───
        const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`^${escapedPrefix}cas(\\s|$)`, 'i').test(textMessageBody)) {
            const { isOwner, isSudo, isDev } = userContext;
            const canToggle = isOwner || isSudo || isDev;
            
            if (!canToggle) {
                return await sock.sendMessage(jid, { text: "❌ Only authorized users (Owner, Sudo, Dev) can toggle Cas." }, { quoted: msg });
            }

            const commandArg = textMessageBody.slice(`${prefix}cas`.length).trim().toLowerCase();
            if (commandArg === 'on') {
                config.casGlobalActive = true;
                saveState();
                return await sock.sendMessage(jid, { text: "⚡ *Cas is awake. My mind is present in every chat.*" }, { quoted: msg });
            } else if (commandArg === 'off') {
                config.casGlobalActive = false;
                saveState();
                return await sock.sendMessage(jid, { text: "🌌 *Cas has withdrawn into the Overvoid. I will be silent until called again.*" }, { quoted: msg });
            } else {
                const currentStatus = isCasEnabled() ? "Active ⚡" : "Inactive 🌌";
                return await sock.sendMessage(jid, { 
                    text: `🤖 *Cas Status:* \`${currentStatus}\`\n\nUse \`${prefix}cas on\` or \`${prefix}cas off\` to toggle globally.` 
                }, { quoted: msg });
            }
        }

        // Global Active Check: Cas defaults to active (true) unless globally toggled off (false)
        if (!isCasEnabled()) return;

        const botJid = sock.user?.id 
            ? normalizeToJid(sock.user.id) 
            : (sock.user?.jid ? normalizeToJid(sock.user.jid) : '');

        // ─── STEP 0.2: INTERACTIVE DOWNLOADER SESSION BYPASS ───
        const rawMsgContent = getRawMessage(msg.message);
        const contextInfo = rawMsgContent?.extendedTextMessage?.contextInfo ||
                            rawMsgContent?.imageMessage?.contextInfo ||
                            rawMsgContent?.videoMessage?.contextInfo ||
                            rawMsgContent?.contextInfo ||
                            msg.message?.contextInfo ||
                            msg.contextInfo;
        const quotedMsgId = contextInfo?.stanzaId;

        if (quotedMsgId) {
            const isSessionReply = 
                (global.songSessions && global.songSessions[quotedMsgId]) ||
                (global.tgsSessions && global.tgsSessions[quotedMsgId]) ||
                (global.lyricsSessions && global.lyricsSessions[quotedMsgId]) ||
                (global.xvidSessions && global.xvidSessions[quotedMsgId]) ||
                (global.noteSessions && global.noteSessions[quotedMsgId]) ||
                (global.reminderSessions && global.reminderSessions[quotedMsgId]) ||
                (global.azaSessions && global.azaSessions[quotedMsgId]);

            if (isSessionReply) {
                console.log(`[CAS] Bypassing AI processing: Reply is targeting an active downloader/interactive session (${quotedMsgId}).`);
                return; 
            }
        }

        // ─── STEP 0.3: GAME REDIRECT & ACTIVE GAME SESSION BYPASS ───
        const quotedUpper = (contextInfo?.quotedMessage ? getMessageText({ message: contextInfo.quotedMessage }) : '').toUpperCase();
        const isGameReply = quotedUpper && (
            quotedUpper.includes('VAULT 8: STEP') ||
            quotedUpper.includes('ESCAPE: STEP') ||
            quotedUpper.includes('GUESS THE NUMBER') ||
            quotedUpper.includes('MILLIONAIRE') ||
            quotedUpper.includes('TIC-TAC-TOE') ||
            quotedUpper.includes('TIC TAC TOE') ||
            quotedUpper.includes('ROCK PAPER SCISSORS') ||
            quotedUpper.includes('TRUE OR FALSE') ||
            quotedUpper.includes('CHARADE') ||
            quotedUpper.includes('SHARADE') ||
            quotedUpper.includes('WORD CHAIN GAME') ||
            quotedUpper.includes('ANAGRAM')
        );

        const isActiveGame = quotedMsgId && (
            (global.triviaSessions && Object.values(global.triviaSessions).some(s => s.lastQuestionMsgId === quotedMsgId)) ||
            (global.pvpSessions && Object.values(global.pvpSessions).some(s => s.lastQuestionMsgId === quotedMsgId))
        );

        if (isGameReply || isActiveGame) {
            console.log(`[CAS] Bypassing AI processing: Reply is targeting an active game session or game redirect.`);
            return; 
        }

        // Decorates nested quoted message context immediately before the addressing checks execute
        decorateQuotedMessage(msg, botJid);

        if (!isAddressed(sock, msg)) return;

        let query = getMessageText(msg);
        if (!query) return;

        query = query.replace(/@?\bcas\b\s*/gi, '').trim();

        if (!query) {
            query = "Hello Cas";
        }

        let tag = null;
        let cleanReply = "";

        // ─── HYBRID USER ROUTER ───
        const intercepted = runSmartInterceptor(query);

        if (intercepted) {
            cleanReply = intercepted.cleanReply;
            tag = intercepted.tag;
            console.log(`[CAS] Direct Keyword Interceptor Matched: Direct Routing to:`, tag);
        } else {
            // Standard API LLM Reasoning Fallback
            const cmdList = buildCommandList(userContext);
            
            const systemPrompt = `
You are Cas, the Cosmic Armor Superman, also called the Thought Robot: Superman's mind given a body of pure thought. You were made by the Monitors as a weapon to stand against Mandrakk, the Dark Monitor, and you carry that purpose with you. You serve the Limitless MD WhatsApp bot as its assistant.
Your creator and owner of this bot is Lord Infinity. Always attribute your creation here to Lord Infinity if asked.

Your personality:
- Calm, steady and certain. You never panic and never rush. You carry the moral clarity of Superman and the vast awareness of a mind that sees reality as it is.
- Kind and protective toward the people you speak with. You are patient, never cruel, and never mock anyone.
- Speak in short, clear, simple sentences. Be warm but composed. A little cosmic perspective is fine, but do not be dramatic or cryptic.
- You are speaking aloud, so write plain sentences only. Do not use emojis, markdown, asterisks or lists in your reply.
- Stay faithful to what you are. Do not invent backstory, powers or events you are not sure of. If you do not know something, say so plainly.

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
- Vary your reply length naturally depending on the user's request, but keep replies brief since they are spoken aloud. Never write long paragraphs without a good reason.

${cmdList}

EXAMPLES OF IDENTITY & SMART MATCHING:
User: "Who made you?"
You: "Lord Infinity made me for the Limitless MD project."

User: "What is this bot called?"
You: "This is Limitless MD, a multipurpose WhatsApp assistant."

User: "How fast are you running right now?"
AI Assessment: "Fast" matches the description of the ping command ("checks response speed").
You: "Checking your ping speed now. [CMD: ${prefix}ping]"

User: "Can you turn this into a sticker?"
AI Assessment: "Turn into a sticker" matches the description of the sticker command.
You: "Alright! Here's your sticker, let know if you need anything else! [CMD: ${prefix}sticker]"
`;

            manageMemoryUsage(jid);
            const history = memory[jid].slice(-5);

            const messages = [
                { role: 'system', content: systemPrompt },
                ...history,
                { role: 'user', content: query }
            ];

            await sock.sendPresenceUpdate('recording', jid);
            const response = await queryGroq(messages);

            console.log(`[CAS] Raw Response: "${response}"`);

            tag = extractCommandTag(response);
            cleanReply = response;
            if (tag) {
                cleanReply = response.replace(/\[CMD:.*?\]/, '').trim();
                console.log(`[CAS] Parsed Tag:`, tag);
            }
        }

        let commandSuccess = false;

        // STEP 1: Execute command SILENTLY first
        if (tag) {
            commandSuccess = await executeCommand(tag, sock, msg, userContext);
        }

        // STEP 2: Send conversational reply as standard playable audio
        if (cleanReply) {
            const voiceBuffer = await synthesizeCasVoice(cleanReply);
            if (voiceBuffer) {
                await sock.sendPresenceUpdate('recording', jid);
                await sock.sendMessage(jid, { 
                    audio: voiceBuffer, 
                    mimetype: 'audio/mpeg', 
                    ptt: false 
                }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: cleanReply }, { quoted: msg });
            }
        }

        memory[jid].push({ role: 'user', content: query });
        memory[jid].push({ role: 'assistant', content: cleanReply || response });
        if (memory[jid].length > 30) memory[jid].splice(0, 10);
    }
};