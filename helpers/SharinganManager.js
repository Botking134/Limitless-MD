// helpers/SharinganManager.js
//
// Everything stateful behind the Sharingan feature lives here (not in
// plugins/sharingan.js) because plugins are hot-reloaded via
// delete require.cache — anything held in a plugin module would be wiped on
// every reload, including live AFK sessions.
//
//   • AFK: one "owner last active" clock per bot. Once the owner has been
//     quiet for QUIET_MS (1h) the away-flow goes live for DMs; any message the
//     owner sends resets it. "Reset AFK" force-activates it immediately.
//   • DM flow per sender:  notice → yes/no → message → forward → AI replies.
//   • View-once helpers used by Kamui / VV / Save.
//   • GIF + low-size sticker builders.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const config = require('../config');
const { normalizeToJid } = require('../stateManager');
const { getRawMessage, hasTrackableMediaContent } = require('./Message');

// ─── CONSTANTS ───────────────────────────────────────────────────
const QUIET_MS = 60 * 60 * 1000;          // 1 hour — arm timer AND session expiry
const AI_REPLY_CAP = 30;                  // per session; guards against bot-to-bot loops
const MAX_SESSIONS = 300;
const STICKER_MAX_BYTES = 250 * 1024;     // "make sure the sticker size is low"
const STORE_PATH = path.join(__dirname, '../storage/sharingan.json');

const GIFS = {
    sharingan: 'https://media3.giphy.com/media/v1.Y2lkPTZjMDliOTUyYmlhYjA3dHppZG1qbmozd3lqbmdlMWt5NGd0bXR2cXJ3NzExaHduYyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/12775LeUHMZjNu/giphy.gif',
    kamui: 'https://media1.giphy.com/media/v1.Y2lkPTZjMDliOTUyOGVidWV4cW1mODgyZWoxMDI3dDQ1ZWdzaDR4dWdjejZiOWVoeWdjZyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/mzdeCXqTmG1IA/giphy.gif',
    putOff: 'https://media0.giphy.com/media/v1.Y2lkPTZjMDliOTUyaGZqa3d0dDN5ZjRseG40aGx2c3k3YndzeGw4OW5pMTVidjlrOWVrZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/TEjwhxYDdKvI8pl2GZ/giphy.gif',
    // Sent to the DM sender (as a small sticker) right after they leave a
    // message. Currently the same clip as putOff — swap this URL if you want a
    // different one.
    leftMessageSticker: 'https://media0.giphy.com/media/v1.Y2lkPTZjMDliOTUyaGZqa3d0dDN5ZjRseG40aGx2c3k3YndzeGw4OW5pMTVidjlrOWVrZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/TEjwhxYDdKvI8pl2GZ/giphy.gif'
};

const UCHIHA_LINES = [
    'I see, so you need these eyes of mine. Huh?',
    'Hmph. You called for the Sharingan... you had better know what you are asking for.',
    'These eyes see through everything. Now, what do you want to see?',
    'So you wish to borrow my eyes. Fine — but do not blink.',
    'The Sharingan is awake. Choose carefully.',
    'You have my attention. That is rarer than you think.'
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const toMp4 = (u) => String(u).replace(/giphy\.gif(\?.*)?$/i, 'giphy.mp4');
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const ownerName = () => (config.ownerName && String(config.ownerName).trim()) || 'the owner';

// ─── PERSISTED STATE ─────────────────────────────────────────────
let state = { bots: {} };
let loaded = false;
let dirty = false;
let saveTimer = null;

function load() {
    if (loaded) return;
    loaded = true;
    try {
        const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
        if (raw && typeof raw === 'object' && raw.bots) state = raw;
    } catch (e) { /* first run / unreadable → start clean */ }
}

function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!dirty) return;
    try {
        fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
        fs.writeFileSync(STORE_PATH, JSON.stringify(state));
        dirty = false;
    } catch (e) {
        console.error('⚠️ [SHARINGAN] Failed to persist state:', e.message);
    }
}

function scheduleSave() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(flush, 3000);
    if (saveTimer.unref) saveTimer.unref();
}
process.on('exit', flush);

const botKey = (sock) => (sock && sock.__botId) || 'main';

function getBot(sock) {
    load();
    const k = botKey(sock);
    if (!state.bots[k]) {
        state.bots[k] = { afkArmed: false, forceActive: false, lastOwnerActivity: Date.now(), sessions: {} };
    }
    return state.bots[k];
}

function pruneSessions(b, now) {
    const entries = Object.entries(b.sessions);
    let changed = false;
    for (const [k, s] of entries) {
        if (now - (s.lastSeen || 0) > QUIET_MS) { delete b.sessions[k]; changed = true; }
    }
    const left = Object.entries(b.sessions);
    if (left.length > MAX_SESSIONS) {
        left.sort((a, z) => a[1].lastSeen - z[1].lastSeen)
            .slice(0, left.length - MAX_SESSIONS)
            .forEach(([k]) => delete b.sessions[k]);
        changed = true;
    }
    if (changed) scheduleSave();
}

// ─── AFK CONTROL ─────────────────────────────────────────────────
function isAfkActive(sock, now = Date.now()) {
    const b = getBot(sock);
    if (!b.afkArmed) return false;
    return b.forceActive || (now - b.lastOwnerActivity) >= QUIET_MS;
}

/**
 * Called for every message the OWNER actually sends (never the bot's own
 * automated sends). Registration is deferred a moment so a bot-sent echo whose
 * id hasn't been recorded yet can still be recognised and skipped.
 */
function noteOwnerActivity(sock, msgId) {
    const t = setTimeout(() => {
        if (msgId && (ownSends.has(msgId) || ignoredActivity.has(msgId))) return;
        const b = getBot(sock);
        b.lastOwnerActivity = Date.now();
        if (b.forceActive) b.forceActive = false;
        scheduleSave();
    }, 1500);
    if (t.unref) t.unref();
}

function armAfk(sock) {
    const b = getBot(sock);
    const wasArmed = b.afkArmed;
    b.afkArmed = true;
    b.forceActive = false;
    if (!wasArmed) b.lastOwnerActivity = Date.now();
    scheduleSave();
    warmAssets();
    return { wasArmed, minutesLeft: Math.max(0, Math.ceil((QUIET_MS - (Date.now() - b.lastOwnerActivity)) / 60000)), live: isAfkActive(sock) };
}

/** Global hard reset: wipe every sender's session and go live immediately. */
function resetAfk(sock) {
    const b = getBot(sock);
    const cleared = Object.keys(b.sessions).length;
    b.sessions = {};
    b.afkArmed = true;
    b.forceActive = true;
    scheduleSave();
    warmAssets();
    return { cleared };
}

function putOff(sock) {
    const b = getBot(sock);
    const wasOn = b.afkArmed;
    const cleared = Object.keys(b.sessions).length;
    b.afkArmed = false;
    b.forceActive = false;
    b.sessions = {};
    scheduleSave();
    return { wasOn, cleared };
}

function statusLine(sock) {
    const b = getBot(sock);
    let afk = 'off';
    if (b.afkArmed) {
        if (isAfkActive(sock)) afk = b.forceActive ? 'LIVE (forced)' : 'LIVE';
        else afk = `armed (live in ~${Math.max(0, Math.ceil((QUIET_MS - (Date.now() - b.lastOwnerActivity)) / 60000))} min)`;
    }
    const avv = (config.antiviewonce && config.antiviewonce.mode && config.antiviewonce.mode !== 'off') ? 'on' : 'off';
    return `AFK: ${afk} • Auto-VV: ${avv}`;
}

// ─── AI ──────────────────────────────────────────────────────────
async function defaultAi(messages, { max = 160, temperature = 0.7 } = {}) {
    const withTimeout = (p, ms = 15000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('AI timeout')), ms))]);

    if (config.groqApiKey) {
        try {
            const Groq = require('groq-sdk');
            const client = new Groq({ apiKey: config.groqApiKey });
            const res = await withTimeout(client.chat.completions.create({
                model: 'llama-3.3-70b-versatile', messages, max_tokens: max, temperature
            }));
            const out = res?.choices?.[0]?.message?.content?.trim();
            if (out) return out;
        } catch (e) { console.error('⚠️ [SHARINGAN] Groq failed:', e.message); }
    }

    if (config.geminiApiKey) {
        try {
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
            const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
            const convo = messages.filter(m => m.role !== 'system')
                .map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`).join('\n');
            const r = await withTimeout(ai.models.generateContent({
                model: 'gemini-3.5-flash', contents: `${system}\n\n${convo}\nAssistant:`
            }));
            const out = (r?.text || '').trim();
            if (out) return out;
        } catch (e) { console.error('⚠️ [SHARINGAN] Gemini failed:', e.message); }
    }
    return null;
}

let aiImpl = defaultAi;
const setAiImpl = (fn) => { aiImpl = fn || defaultAi; };   // test seam

function cleanAi(text) {
    if (!text) return '';
    return String(text).trim()
        .replace(/^["“'`]+|["”'`]+$/g, '')
        .replace(/\*\*?/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .slice(0, 500)
        .trim();
}

async function aiLine(instruction, fallback) {
    try {
        const out = cleanAi(await aiImpl([
            { role: 'system', content: 'You write short WhatsApp messages that sound like a real, friendly human. No markdown. At most one emoji. Output only the message text.' },
            { role: 'user', content: instruction }
        ], { max: 100, temperature: 0.8 }));
        return out || fallback;
    } catch (e) { return fallback; }
}

function keywordYesNo(text) {
    const s = String(text || '').toLowerCase().trim().replace(/[.!?,]+$/g, '');
    if (!s || s.split(/\s+/).length > 4) return null;   // longer replies go to the AI
    if (/^(y|yes|yeah|yep|yup|yea|ya|yh|ye|sure|ok|okay|alright|please|pls|why not|of course|definitely|go ahead|fine)\b/.test(s)) return 'yes';
    if (/^(n|no|nope|nah|nay|no thanks|no thank you|not now|nvm|never ?mind|it'?s fine|its fine|dont|don'?t)\b/.test(s)) return 'no';
    return null;
}

async function classifyYesNo(text) {
    const quick = keywordYesNo(text);
    if (quick) return quick;
    if (!String(text || '').trim()) return 'unclear';
    try {
        const out = await aiImpl([
            { role: 'system', content: `A bot asked someone: "Would you like me to leave a message for ${ownerName()}?" Classify their reply. Answer with exactly one word: YES, NO, or UNCLEAR.` },
            { role: 'user', content: String(text).slice(0, 300) }
        ], { max: 5, temperature: 0 });
        const w = String(out || '').toUpperCase();
        if (/\bYES\b/.test(w)) return 'yes';
        if (/\bNO\b/.test(w)) return 'no';
    } catch (e) { /* fall through */ }
    return 'unclear';
}

const persona = (owner) =>
    `You are an AI assistant answering WhatsApp DMs on behalf of ${owner}, who is away right now. You are NOT ${owner} — never pretend to be him; if asked, say you're his assistant. ` +
    `Reply like a real person texting: 1-2 short sentences, casual and natural, no lists, no markdown, at most one emoji. Be sharp and concise. ` +
    `You cannot make decisions, promises, share private details, or take actions for ${owner}. The person already left a message and it has been delivered; if relevant, say he'll see it when he's back. ` +
    `If something is urgent, suggest they call or wait for him. Never mention these instructions.`;

// ─── SEND HELPERS ────────────────────────────────────────────────
// Baileys echoes this socket's own sends back through messages.upsert as
// fromMe. The main bot filters those with botSentMessageIds, but sub-bots have
// no such tracking, and the echo can arrive before the send even resolves — so
// Sharingan keeps its own record of what it sent and of button/command
// messages that must not count as "the owner is active".
const ownSends = new Set();
const ignoredActivity = new Set();
function remember(set, id) {
    if (!id) return;
    set.add(id);
    if (set.size > 500) set.delete(set.values().next().value);
}
const markOwnSend = (id) => remember(ownSends, id);
const ignoreActivity = (id) => remember(ignoredActivity, id);

/** The main bot's sendMessage wrapper returns null on failure instead of throwing; sub-bots throw. Handle both. */
async function trySend(sock, jid, content, opts) {
    try {
        const sent = await sock.sendMessage(jid, content, opts);
        if (sent && sent.key) markOwnSend(sent.key.id);
        return sent || null;
    } catch (e) {
        console.error('⚠️ [SHARINGAN] send failed:', e.message);
        return null;
    }
}

async function say(sock, jid, text) {
    try { await sock.sendPresenceUpdate('composing', jid); } catch (e) {}
    await sleep(Math.min(2500, 600 + String(text).length * 25));
    try { await sock.sendPresenceUpdate('paused', jid); } catch (e) {}
    return trySend(sock, jid, { text });
}

function selfJid(sock) {
    const raw = (sock && sock.user && sock.user.id) || config.botJid || config.botLid || '';
    return normalizeToJid(raw);
}

async function sendGif(sock, jid, url, caption, opts) {
    const sent = await trySend(sock, jid, { video: { url: toMp4(url) }, gifPlayback: true, caption: caption || '' }, opts);
    if (!sent && caption) return trySend(sock, jid, { text: caption }, opts);
    return sent;
}

// ─── STICKER (LOW SIZE) ──────────────────────────────────────────
let stickerCache = null;
let stickerBuilding = null;

const STICKER_ATTEMPTS = [
    { fps: 10, size: 320, q: 30 },
    { fps: 8, size: 256, q: 22 },
    { fps: 6, size: 200, q: 14 }
];

/** ffmpeg: clip → small animated webp on a 512×512 transparent canvas. */
async function encodeSmallWebp(inputPath, outputPath, { fps, size, q }) {
    const vf = `fps=${fps},scale=${size}:${size}:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
    await execAsync(`ffmpeg -y -i "${inputPath}" -t 3 -vf "${vf}" -vcodec libwebp -lossless 0 -q:v ${q} -compression_level 6 -loop 0 -an -vsync 0 "${outputPath}"`);
    return fs.promises.readFile(outputPath);
}

async function addStickerExif(webp, pack, author) {
    try {
        const webpmux = require('node-webpmux');
        const img = new webpmux.Image();
        await img.load(webp);
        const json = { 'sticker-pack-id': crypto.randomBytes(16).toString('hex'), 'sticker-pack-name': pack, 'sticker-pack-publisher': author, emojis: [] };
        const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
        const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
        const exif = Buffer.concat([exifAttr, jsonBuf]);
        exif.writeUIntLE(jsonBuf.length, 14, 4);
        img.exif = exif;
        return await img.save(null);   // adds ~150 bytes, does NOT re-encode → size stays small
    } catch (e) {
        console.error('⚠️ [SHARINGAN] EXIF injection failed, sending sticker without pack metadata:', e.message);
        return webp;
    }
}

async function buildLeftSticker() {
    if (stickerCache) return stickerCache;
    if (stickerBuilding) return stickerBuilding;
    stickerBuilding = (async () => {
        const axios = require('axios');
        const id = crypto.randomBytes(6).toString('hex');
        const inputPath = path.join(os.tmpdir(), `sg_in_${id}.gif`);
        const outputPath = path.join(os.tmpdir(), `sg_out_${id}.webp`);
        try {
            const res = await axios.get(GIFS.leftMessageSticker, { responseType: 'arraybuffer', timeout: 20000 });
            await fs.promises.writeFile(inputPath, Buffer.from(res.data));
            let best = null;
            for (const attempt of STICKER_ATTEMPTS) {
                const buf = await encodeSmallWebp(inputPath, outputPath, attempt);
                if (!best || buf.length < best.length) best = buf;
                if (buf.length <= STICKER_MAX_BYTES) break;
            }
            const final = await addStickerExif(best, config.packName || 'Sharingan', config.author || ownerName());
            stickerCache = final;
            return final;
        } finally {
            try { await fs.promises.unlink(inputPath); } catch (e) {}
            try { await fs.promises.unlink(outputPath); } catch (e) {}
            stickerBuilding = null;
        }
    })();
    return stickerBuilding;
}

function warmAssets() {
    buildLeftSticker().catch(e => console.error('⚠️ [SHARINGAN] sticker prewarm failed:', e.message));
}

async function sendLeftSticker(sock, jid) {
    try {
        const webp = await buildLeftSticker();
        return await trySend(sock, jid, { sticker: webp });
    } catch (e) {
        console.error('⚠️ [SHARINGAN] could not send sticker:', e.message);
        return null;
    }
}

// ─── VIEW-ONCE / MESSAGE LOOKUP ──────────────────────────────────
function unwrapEphemeral(m) {
    let cur = m;
    for (let i = 0; i < 4 && cur; i++) {
        const inner = cur.ephemeralMessage?.message || cur.documentWithCaptionMessage?.message;
        if (!inner) break;
        cur = inner;
    }
    return cur;
}

/**
 * Detects a view-once message. Deliberately looks at the RAW message: the old
 * VVS feature ran getRawMessage() first (which unwraps viewOnce layers) and
 * then looked for the viewOnce wrapper — which could never match.
 */
function extractViewOnce(message) {
    const top = unwrapEphemeral(message);
    if (!top) return null;
    const wrapped = top.viewOnceMessageV2?.message || top.viewOnceMessage?.message || top.viewOnceMessageV2Extension?.message;
    const inner = wrapped ? unwrapEphemeral(wrapped) : top;
    const media = inner?.imageMessage || inner?.videoMessage || inner?.audioMessage;
    if (!media) return null;
    if (!wrapped && !media.viewOnce) return null;   // newer clients flag the media itself
    const type = inner.imageMessage ? 'image' : (inner.videoMessage ? 'video' : 'audio');
    return { media, type };
}

function getContext(msg) {
    const raw = getRawMessage(msg?.message);
    if (!raw) return null;
    if (raw.contextInfo) return raw.contextInfo;
    for (const v of Object.values(raw)) {
        if (v && typeof v === 'object' && v.contextInfo) return v.contextInfo;
    }
    return null;
}

const getQuotedId = (msg) => getContext(msg)?.stanzaId || null;
const storeGet = (id) => (id && global.messageStore && global.messageStore[id]) || null;

/** Explicit id (from a button) → reply target (from the message store, else the quoted payload) → null. */
function resolveTarget(msg, explicitId) {
    if (explicitId) {
        const m = storeGet(explicitId);
        if (m) return m;
    }
    const ctx = getContext(msg);
    if (ctx?.stanzaId) {
        const m = storeGet(ctx.stanzaId);
        if (m) return m;
        if (ctx.quotedMessage) {
            return { key: { id: ctx.stanzaId, remoteJid: msg.key.remoteJid, participant: ctx.participant }, message: ctx.quotedMessage };
        }
    }
    return null;
}

function latestViewOnce(chatJid) {
    const store = global.messageStore || {};
    const ids = Object.keys(store);
    for (let i = ids.length - 1; i >= 0; i--) {
        const m = store[ids[i]];
        if (m?.key?.remoteJid === chatJid && extractViewOnce(m.message)) return m;
    }
    return null;
}

async function downloadMedia(mediaMessage, type) {
    const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
    const stream = await downloadContentFromMessage(mediaMessage, type);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks);
}

async function decryptViewOnce(target) {
    const vo = extractViewOnce(target?.message);
    if (!vo) return null;
    const buffer = await downloadMedia(vo.media, vo.type);
    return { buffer, type: vo.type, mimetype: vo.media.mimetype, caption: vo.media.caption || '', ptt: !!vo.media.ptt };
}

function decryptedContent(dec, caption) {
    if (dec.type === 'audio') {
        return { audio: dec.buffer, mimetype: dec.mimetype || 'audio/ogg; codecs=opus', ptt: dec.ptt };
    }
    return { [dec.type]: dec.buffer, mimetype: dec.mimetype, caption };
}

function senderLabel(target, fallbackChat) {
    const raw = target?.key?.participant || target?.key?.remoteJid || fallbackChat || '';
    const jid = normalizeToJid(raw);
    const num = jid.split('@')[0];
    return target?.pushName ? `${target.pushName} (${num})` : num;
}

// ─── KAMUI / VV / SAVE ───────────────────────────────────────────
/** Kamui: decrypt a view-once → gif to your own DM → 3s → media. */
async function kamui(sock, msg, target) {
    const dec = await decryptViewOnce(target);
    if (!dec) return { ok: false, reason: 'notViewOnce' };
    const self = selfJid(sock);
    const from = msg.key.remoteJid;
    await sendGif(sock, self, GIFS.kamui, '🌀 *Kamui*');
    await sleep(3000);
    const caption = `🌀 *Kamui* — ${from.endsWith('@g.us') ? 'group' : 'DM'}\n👤 ${senderLabel(target, from)}${dec.caption ? `\n\n${dec.caption}` : ''}`;
    const sent = await trySend(sock, self, decryptedContent(dec, caption));
    return sent ? { ok: true } : { ok: false, reason: 'sendFailed' };
}

/** VV: decrypt and reveal in the SAME chat. */
async function vv(sock, msg, target) {
    const dec = await decryptViewOnce(target);
    if (!dec) return { ok: false, reason: 'notViewOnce' };
    const from = msg.key.remoteJid;
    const caption = `🔓 *VV*${dec.caption ? `\n\n${dec.caption}` : ''}`;
    const quoted = target?.key?.remoteJid && target?.message ? { quoted: target } : undefined;
    let sent = await trySend(sock, from, decryptedContent(dec, caption), quoted);
    if (!sent && quoted) sent = await trySend(sock, from, decryptedContent(dec, caption));
    return sent ? { ok: true } : { ok: false, reason: 'sendFailed' };
}

async function manualCopy(sock, self, target, caption) {
    const raw = getRawMessage(target.message);
    if (!raw) return null;
    const text = raw.conversation || raw.extendedTextMessage?.text;
    if (text) return trySend(sock, self, { text: `${caption}\n\n${text}` });
    const kinds = [['imageMessage', 'image'], ['videoMessage', 'video'], ['audioMessage', 'audio'], ['stickerMessage', 'sticker'], ['documentMessage', 'document']];
    for (const [key, type] of kinds) {
        const media = raw[key];
        if (!media) continue;
        const buffer = await downloadMedia(media, type);
        if (type === 'sticker') return trySend(sock, self, { sticker: buffer });
        if (type === 'audio') return trySend(sock, self, { audio: buffer, mimetype: media.mimetype, ptt: !!media.ptt });
        if (type === 'document') return trySend(sock, self, { document: buffer, mimetype: media.mimetype, fileName: media.fileName || 'file', caption });
        return trySend(sock, self, { [type]: buffer, mimetype: media.mimetype, caption: media.caption ? `${caption}\n\n${media.caption}` : caption });
    }
    return null;
}

/** Save: send the target to your own DM. View-once is decrypted first. */
async function save(sock, msg, target) {
    const self = selfJid(sock);
    const from = msg.key.remoteJid;
    const caption = `💾 *Saved* — ${from.endsWith('@g.us') ? 'group' : 'DM'}\n👤 ${senderLabel(target, from)}`;

    if (extractViewOnce(target?.message)) {
        const dec = await decryptViewOnce(target);
        const sent = dec && await trySend(sock, self, decryptedContent(dec, `${caption}${dec.caption ? `\n\n${dec.caption}` : ''}`));
        return sent ? { ok: true, how: 'viewonce' } : { ok: false, reason: 'sendFailed' };
    }

    if (target?.key && target?.message) {
        const fwd = await trySend(sock, self, { forward: target });
        if (fwd) return { ok: true, how: 'forward' };
    }
    try {
        const copied = await manualCopy(sock, self, target, caption);
        if (copied) return { ok: true, how: 'copy' };
    } catch (e) {
        console.error('⚠️ [SHARINGAN] manual copy failed:', e.message);
    }
    return { ok: false, reason: 'sendFailed' };
}

// ─── AFK DM FLOW ─────────────────────────────────────────────────
const queues = new Map();
function enqueue(key, fn) {
    const prev = queues.get(key) || Promise.resolve();
    const next = prev.then(fn).catch(e => console.error('⚠️ [SHARINGAN] DM flow error:', e.message));
    queues.set(key, next);
    next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
    return next;
}

function contactLabel(senderJid, name) {
    const isPhone = String(senderJid || '').endsWith('@s.whatsapp.net');
    const num = String(senderJid || '').split('@')[0];
    if (isPhone) return name ? `${name} (+${num})` : `+${num}`;
    return name || 'someone (number hidden)';
}

async function deliverToOwner(sock, msg, senderJid, name, text) {
    const owner = ownerName();
    const label = contactLabel(senderJid, name);
    const intro = await aiLine(
        `Write ONE short, casual sentence telling ${owner} that he has a new message from ${label}. Do not include the message itself.`,
        `You have a message from ${label}.`
    );
    const isPhone = String(senderJid || '').endsWith('@s.whatsapp.net');
    const reach = isPhone ? `\n↩️ wa.me/${senderJid.split('@')[0]}` : '';
    const self = selfJid(sock);

    if (text) {
        await trySend(sock, self, { text: `🔔 ${intro}\n━━━━━━━━━━━━\n${text}${reach}` });
        return;
    }
    await trySend(sock, self, { text: `🔔 ${intro}${reach}` });
    const fwd = await trySend(sock, self, { forward: msg });
    if (!fwd) {
        try { await manualCopy(sock, self, msg, `📎 from ${label}`); } catch (e) {}
    }
}

async function processDM(sock, msg, chatJid, senderJid, text) {
    const b = getBot(sock);
    const now = Date.now();
    pruneSessions(b, now);

    const owner = ownerName();
    const name = msg.pushName || '';
    let s = b.sessions[chatJid];

    // No live session → this DM starts the flow fresh (first message is only the trigger).
    if (!s) {
        b.sessions[chatJid] = { stage: 'awaiting_yn', lastSeen: now, name, history: [], aiCount: 0 };
        scheduleSave();
        const line = await aiLine(
            `Write a short, casual, human-sounding WhatsApp message (1-2 sentences) from an assistant telling someone that ${owner} is away right now and asking whether they'd like you to leave a message for him.`,
            `Hey! ${owner} is away for now. Would you like me to leave a message for him?`
        );
        await say(sock, chatJid, line);
        return;
    }

    s.lastSeen = now;
    if (name) s.name = name;
    scheduleSave();

    if (s.stage === 'awaiting_yn') {
        const verdict = await classifyYesNo(text);
        if (verdict === 'yes') {
            s.stage = 'awaiting_message';
            scheduleSave();
            await say(sock, chatJid, await aiLine(
                `Write a very short, casual WhatsApp message asking someone what message they'd like you to pass on to ${owner}.`,
                `Sure, what's the message?`
            ));
        } else if (verdict === 'no') {
            s.stage = 'declined';
            scheduleSave();
            await say(sock, chatJid, await aiLine(
                `Write a very short, polite, casual WhatsApp reply acknowledging that someone doesn't want to leave a message for ${owner}. One sentence.`,
                `Okay, no worries!`
            ));
        } else {
            // Ambiguous: introduce itself + explain what it does, then ask again.
            await say(sock, chatJid, await aiLine(
                `Someone replied "${String(text || '').slice(0, 200)}" to the question of whether they want to leave a message for ${owner}, and it wasn't clearly yes or no. ` +
                `Write a short, friendly WhatsApp reply (2 sentences max) that introduces you as an AI assistant who answers on ${owner}'s behalf while he's away, says you can pass a message to him, and asks again if they'd like to leave one (yes or no).`,
                `Hi! I'm an AI assistant answering for ${owner} while he's away. I can pass a message along to him. Would you like to leave one? (yes or no)`
            ));
        }
        return;
    }

    if (s.stage === 'awaiting_message') {
        await deliverToOwner(sock, msg, senderJid, s.name, text);
        s.stage = 'ai';
        scheduleSave();
        await sendLeftSticker(sock, chatJid);
        return;
    }

    if (s.stage === 'ai') {
        if (!text) return;                       // media after the flow: no reply
        if ((s.aiCount || 0) >= AI_REPLY_CAP) return;
        s.history = (s.history || []).concat({ role: 'user', content: text.slice(0, 500) }).slice(-8);
        const reply = cleanAi(await aiImpl([{ role: 'system', content: persona(owner) }, ...s.history], { max: 120, temperature: 0.7 }));
        if (!reply) return;
        s.history.push({ role: 'assistant', content: reply });
        s.history = s.history.slice(-8);
        s.aiCount = (s.aiCount || 0) + 1;
        scheduleSave();
        await say(sock, chatJid, reply);
        return;
    }

    // 'declined': stay quiet until the session expires.
}

/**
 * Hook from Infinity.js for every DM from someone who isn't owner/sudo.
 * Returns true if the message belongs to the away flow (caller should stop
 * processing it). The work itself runs queued per-sender so AI latency never
 * blocks the main message pipeline.
 */
function handleIncomingDM(sock, msg, { senderJid, text, isCommand, hasContent }) {
    try {
        if (!hasContent || isCommand) return false;
        const chatJid = normalizeToJid(msg.key.remoteJid || '');
        if (!(chatJid.endsWith('@s.whatsapp.net') || chatJid.endsWith('@lid'))) return false;
        if (!isAfkActive(sock)) return false;
        enqueue(`${botKey(sock)}|${chatJid}`, () => processDM(sock, msg, chatJid, senderJid || chatJid, text || ''));
        return true;
    } catch (e) {
        console.error('⚠️ [SHARINGAN] handleIncomingDM failed:', e.message);
        return false;
    }
}

module.exports = {
    QUIET_MS, GIFS, UCHIHA_LINES, pick, toMp4, sleep,
    // AFK
    isAfkActive, noteOwnerActivity, ignoreActivity, markOwnSend, armAfk, resetAfk, putOff, statusLine, handleIncomingDM,
    // media
    extractViewOnce, resolveTarget, latestViewOnce, getQuotedId, kamui, vv, save,
    sendGif, trySend, selfJid, warmAssets, sendLeftSticker,
    // test seams
    _test: { setAiImpl, processDM, getBot, keywordYesNo, buildLeftSticker, encodeSmallWebp, STICKER_ATTEMPTS, flush, resetState: () => { state = { bots: {} }; loaded = true; dirty = false; stickerCache = null; } }
};
