// plugins/utilities.js
const config = require('../config');
const { saveState, normalizeToJid, getPhoneJid } = require('../stateManager');
const os = require('os');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// ─── NOTES PATH ──────────────────────────────────────────────────
const notesPath = path.join(__dirname, '../storage/notes.json');

// ─── ANIMATION LOCK ───────────────────────────────────────────────
// ping and speed both fire a rapid burst of sendMessage/edit/react calls in
// quick succession. If both get triggered close together in the same chat
// (e.g. someone runs .ping then immediately "speed"), the two bursts run
// concurrently and effectively double the request rate hitting the socket
// in that same window — a spammy-looking pattern that risks the connection
// getting flagged and force-closed, especially in a self-chat. This lock
// makes a second animated command in the same chat wait its turn instead of
// overlapping the first one.
const animatingJids = new Set();
async function withAnimationLock(jid, fn) {
    if (animatingJids.has(jid)) return; // one's already running here — skip rather than stack
    animatingJids.add(jid);
    try {
        await fn();
    } finally {
        animatingJids.delete(jid);
    }
}

// ─── NOTES LOCAL STORAGE HELPERS ─────────────────────────────────

function readNotes() {
    try {
        if (fs.existsSync(notesPath)) {
            const rawData = fs.readFileSync(notesPath, 'utf-8');
            return JSON.parse(rawData);
        }
    } catch (e) {
        console.error("⚠️ [NOTES] Parse failed. Backing up corrupted file.");
        try {
            if (fs.existsSync(notesPath)) {
                fs.renameSync(notesPath, notesPath.replace('.json', '.corrupted.json'));
            }
        } catch (backupErr) { /* ignore */ }
    }
    return {};
}

function saveNotes(notes) {
    try {
        const dir = path.dirname(notesPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2), 'utf-8');
    } catch (e) { /* ignore */ }
}

// ─── HELPERS ──────────────────────────────────────────────────────

function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${Math.floor(s)}s`;
}

// ─── DEL / TDEL HELPERS ───────────────────────────────────────────
const DEL_MAX = 50;
const DEL_GIF = "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExYWl1emR6Z3UzaDZ2ZTlqZXR5Mzl6emw2bzFmeGtycGE1dGN3ODJ3cyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3fNmJ20ErpkjK/giphy.mp4";

// `del 5` -> 5, bare `del` -> the number saved with setdel (default 1)
function parseDelCount(args) {
    const m = (args || '').toString().trim().match(/^(\d+)\b/);
    const n = m ? parseInt(m[1], 10) : (Number(config.delCount) || 1);
    return Math.min(Math.max(n, 1), DEL_MAX);
}

// Works out which recorded messages to remove.
//   reply  -> the replied message plus the ones recorded right after it, up to `count`
//   no reply -> the latest `count` recorded messages before the command
// If fewer are recorded than asked for, it takes what exists instead of failing.
async function planDeletion(sock, msg, count) {
    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean).map(x => normalizeToJid(x));

    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
    const repliedId = contextInfo?.stanzaId || null;

    const store = global.messageStore || {};
    const chat = Object.values(store).filter(m => m?.key?.remoteJid === jid && m.key.id !== msg.key.id);

    let picked = [];
    if (repliedId) {
        const idx = chat.findIndex(m => m.key.id === repliedId);
        if (idx >= 0) {
            picked = chat.slice(idx, idx + count).map(m => m.key);
        } else {
            // replied message was not recorded: still delete that one
            const sender = contextInfo.participant || contextInfo.remoteJid || '';
            picked = [{ remoteJid: jid, id: repliedId, fromMe: botIds.includes(normalizeToJid(sender)), participant: isGroup ? contextInfo.participant : undefined }];
        }
    } else {
        picked = chat.slice(-count).map(m => m.key);
        if (!picked.length) return { error: "❌ I have no recorded messages here to delete yet. Reply to a message, or try again once the chat has some." };
    }

    // Permission filter
    let botIsAdmin = false;
    if (isGroup) {
        try {
            const meta = await sock.groupMetadata(jid);
            botIsAdmin = meta.participants.some(p => botIds.includes(normalizeToJid(p.id)));
        } catch (e) { /* treated as not admin */ }
    }
    const keys = [];
    let skipped = 0;
    for (const k of picked) {
        const own = !!k.fromMe || botIds.includes(normalizeToJid(k.participant || ''));
        if (own || (isGroup && botIsAdmin)) {
            keys.push({ remoteJid: jid, id: k.id, fromMe: own, participant: (isGroup && !own) ? k.participant : undefined });
        } else skipped++;
    }
    if (!keys.length) {
        return { error: isGroup ? "❌ I need to be an admin to delete messages from other users." : "❌ You can only delete your own messages in private DMs." };
    }
    return { keys, skipped };
}

async function deleteKeys(sock, jid, keys) {
    for (const key of keys) {
        try { await sock.sendMessage(jid, { delete: key }); } catch (e) { /* ignore */ }
        if (global.messageStore) delete global.messageStore[key.id];
        if (keys.length > 1) await new Promise(r => setTimeout(r, 350));
    }
}

function parseDuration(str) {
    const match = str.match(/^(\d+)([smh])$/i);
    if (!match) return null;
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
    return null;
}

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

async function uploadToCloud(buffer, mimeType) {
    let ext = mimeType.split('/')[1] || 'bin';
    ext = ext.split(';')[0].trim();
    const filename = `file_${Date.now()}.${ext}`;

    try {
        const form = new FormData();
        form.append('files[]', buffer, { filename, contentType: mimeType });
        const response = await axios.post('https://qu.ax/upload.php', form, {
            headers: { ...form.getHeaders() }
        });
        if (response.data?.success && response.data.files?.[0]?.url) {
            return response.data.files[0].url.trim();
        }
    } catch (err) { /* ignore */ }

    try {
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', buffer, { filename, contentType: mimeType });
        const response = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: { ...form.getHeaders() }
        });
        if (response.data && typeof response.data === 'string' && response.data.startsWith('http')) {
            return response.data.trim();
        }
    } catch (err) { /* ignore */ }

    throw new Error("Cloud upload gateways failed.");
}

async function getQuickWeather() {
    try {
        const res = await axios.get("https://wttr.in/Lagos?format=%c+%t", { timeout: 2000 });
        return res.data.trim();
    } catch (e) {
        return "Unavailable 🌀";
    }
}

// ─── NOTE SESSION HANDLER ────────────────────────────────────
async function handleNoteSession(sock, msg) {
    try {
        const jid = msg.key.remoteJid;
        const rawContent = getRawMessage(msg.message);
        const text = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
        const quotedMsgId = rawContent?.contextInfo?.stanzaId;

        if (quotedMsgId && global.noteSessions && global.noteSessions[quotedMsgId]) {
            const session = global.noteSessions[quotedMsgId];
            const noteName = text.trim();
            if (!noteName) return false;

            const notes = readNotes();
            notes[jid] = notes[jid] || {};
            notes[jid][noteName.toLowerCase()] = {
                title: noteName,
                content: session.content,
                author: session.author,
                time: Date.now()
            };
            saveNotes(notes);
            delete global.noteSessions[quotedMsgId];
            await sock.sendMessage(jid, { text: `✅ Note successfully saved as *${noteName}*!` }, { quoted: msg });
            return true;
        }
    } catch (e) {
        console.error("Note session handler error:", e);
    }
    return false;
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [

// ─── AZA (Bank details setup) ────────────────────────────────
    {
        name: 'aza',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            
            // Restrict bank details actions to authorized owners and developers
            const isAuthorized = isOwner || isDev;
            if (!isAuthorized) return;

            const bankDetails = config.aza || { set: false };

            // Initiate Setup Wizard (.aza set)
            if (args && args.toLowerCase().trim() === 'set') {
                try {
                    const prompt = await sock.sendMessage(jid, {
                        text: `🏦 *BANK DETAILS CONFIGURATION WIZARD* 🏦\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `• *Step 1:* Please reply directly to *this message* with your *Account Number* (must be 5 digits or more).`
                    }, { quoted: msg });

                    // Register active session for SessionManager to intercept replies
                    global.azaSessions = global.azaSessions || {};
                    global.azaSessions[prompt.key.id] = { step: 1, ownerBot: (sock.user?.id || '').replace(/:\d+@/, '@') };
                    
                    // Auto-delete session after 5 minutes to prevent RAM memory leaks
                    setTimeout(() => {
                        if (global.azaSessions && global.azaSessions[prompt.key.id]) {
                            delete global.azaSessions[prompt.key.id];
                        }
                    }, 5 * 60 * 1000);

                } catch (e) {
                    console.error('❌ Failed to initiate Aza setup wizard:', e.message);
                }
                return;
            }

            // Display details card if already set
            if (bankDetails.set) {
                const detailsCard =
                    `🏦 *BANK ACCOUNT INFO* 🏦\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👤 *NAME:* \`${bankDetails.name}\`\n` +
                    `🏦 *BANK:* \`${bankDetails.bank}\`\n` +
                    `💳 *ACCOUNT NO:* \`${bankDetails.account}\``;

                try {
                    await sock.sendMessage(jid, { text: detailsCard }, { quoted: msg });
                } catch (e) { /* ignore dead socket */ }
                return;
            }

            // Fallback if not configured yet
            const promptText = `❌ *No Bank Details Configured!*\n\nPlease configure your bank details manually by running:\n\`${config.prefix}aza set\``;
            try {
                await sock.sendMessage(jid, { text: promptText }, { quoted: msg });
            } catch (e) { /* ignore dead socket */ }
        }
    }, 


    // 1. PING (Animated with deletion crash guards)
    {
        name: 'ping',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            await withAnimationLock(jid, async () => {
            try {
                const { delay } = await import('@itsliaaa/baileys');
                const start = Date.now();

                const loadingMsg = await sock.sendMessage(jid, { text: "[□□□□□□]" }, { quoted: msg });
                const frames = ["[□□□□□□]", "[■□□□□□]", "[■■□□□□]", "[■■■□□□]", "[■■■■□□]", "[■■■■■□]", "[■■■■■■]"];

                // One full pass through the frames is enough to read as a
                // loading animation — a second identical cycle only doubled
                // the number of rapid edit calls without adding anything
                // visible, which is the kind of burst that risks tripping
                // WhatsApp's automation detection.
                for (const frame of frames) {
                    try {
                        await sock.sendMessage(jid, { text: frame, edit: loadingMsg.key });
                    } catch (err) {
                        return; // Break immediately if the user deleted the message during the loop
                    }
                    await delay(400);
                }

                const networkPing = Date.now() - start;
                try {
                    await sock.sendMessage(jid, {
                        text: `▫️ _Void speed:_   ∞\n➤ _Cursed Energy:_ _\`${networkPing * 100}ms\`_`,
                        edit: loadingMsg.key
                    });
                } catch (err) { /* ignore */ }
            } catch (error) { /* ignore */ }
            });
        }
    },

    // 2. ALIVE (Dynamic Variable Compiler with backwards-compatible Weather check)
    {
        name: 'alive',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const uptimeString = formatUptime(process.uptime());

            const timeOptions = {
                timeZone: 'Africa/Lagos',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                weekday: 'short',
                day: 'numeric',
                month: 'short'
            };
            const timeFormatter = new Intl.DateTimeFormat('en-US', timeOptions);
            const nigerianTime = timeFormatter.format(new Date());

            const weather = await getQuickWeather();

            let ram = 'N/A';
            try {
                const memoryUsage = process.memoryUsage();
                const used = (memoryUsage.heapUsed / 1024 / 1024).toFixed(1);
                const total = (memoryUsage.heapTotal / 1024 / 1024).toFixed(1);
                ram = `${used} MB / ${total} MB`;
            } catch (e) { /* ignore */ }

            // Calculate latency on-the-fly
            let speedMs = '0ms';
            try {
                const start = Date.now();
                const tempMsg = await sock.sendMessage(jid, { text: "⚡" }, { quoted: msg });
                const diff = Date.now() - start;
                speedMs = `${Math.abs(diff)}ms`;
                try { await sock.sendMessage(jid, { delete: tempMsg.key }); } catch (e) { /* ignore */ }
            } catch (e) { /* ignore */ }

            // Dynamic String Compilation
            let template = config.aliveMessage ||
                `🤞 *LIMITLESS DOMAIN ONLINE* 🤞\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `⚡ *Uptime:* $uptime\n` +
                `🕒 *WAT Time:* $time\n` +
                `🌤️ *Weather:* $weather\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `_“Throughout Heaven and Earth, I alone am the honoured one.”_ 🌏`;

            template = template
                .replace(/\$uptime/g, uptimeString)
                .replace(/\$botspeed/g, speedMs)
                .replace(/\$time/g, nigerianTime)
                .replace(/\$weather/g, weather)
                .replace(/\$ram/g, ram)
                .replace(/\$botname/g, config.botName || 'Limitless-MD');

            const mediaUrl = config.aliveMediaUrl || "https://iili.io/C3yej7s.jpg";
            const isVideo = /\.(mp4|gif|mov|webm)/i.test(mediaUrl);

            try {
                if (isVideo) {
                    await sock.sendMessage(jid, {
                        video: { url: mediaUrl },
                        gifPlayback: true,
                        caption: template
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, {
                        image: { url: mediaUrl },
                        caption: template
                    }, { quoted: msg });
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: `${template}\n\n_(Visual engine offline)_` }, { quoted: msg });
            }
        }
    },

    // 3. ALIVE-SET (Saves custom messages, media templates, and direct replies)
    {
        name: 'alive-set',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let textTemplate = args ? args.trim() : '';

            const rawIncoming = getRawMessage(msg.message);
            const contextInfo = rawIncoming?.extendedTextMessage?.contextInfo ||
                                rawIncoming?.imageMessage?.contextInfo ||
                                rawIncoming?.videoMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;

            let mediaUrl = '';

            try {
                // Mode A: Quoted Image/Video/GIF setup (Upload to Cloud)
                if (quoted) {
                    const rawContent = getRawMessage(quoted);
                    const targetMedia = rawContent?.imageMessage || rawContent?.videoMessage;

                    if (targetMedia) {
                        await sock.sendMessage(jid, { text: "Uploading custom media template to cloud... 📤" }, { quoted: msg });
                        const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                        const mediaType = rawContent.imageMessage ? 'image' : 'video';

                        const stream = await downloadContentFromMessage(targetMedia, mediaType);
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                        const mimeType = targetMedia.mimetype || (mediaType === 'image' ? 'image/jpeg' : 'video/mp4');
                        mediaUrl = await uploadToCloud(buffer, mimeType);
                    }
                } else if (textTemplate.includes('|')) {
                    // Mode B: Split parameters by "|"
                    const parts = textTemplate.split('|');
                    textTemplate = parts[0].trim();
                    mediaUrl = parts[1].trim();
                }

                if (!textTemplate && !mediaUrl) {
                    return await sock.sendMessage(jid, {
                        text: `❌ *How to use .alive-set:*\n\n` +
                              `• *Setting Text Only:* \`.alive-set your custom text\`\n` +
                              `• *Setting Text & URL:* \`.alive-set your custom text | mediaUrl\`\n` +
                              `• *Setting Media via Reply:* Reply directly to an image/video/GIF with \`.alive-set your custom text\``
                    }, { quoted: msg });
                }

                if (textTemplate) config.aliveMessage = textTemplate;
                if (mediaUrl) config.aliveMediaUrl = mediaUrl;

                saveState();

                const successCard =
                    `✅ *ALIVE SYSTEM UPDATED* ✅\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `📝 *Message Template Saved:* \n"${config.aliveMessage || 'Default'}"\n\n` +
                    `🖼️ *Custom Media URL:* \n\`${config.aliveMediaUrl || 'Default (Gojo Graphic)'}\``;

                await sock.sendMessage(jid, { text: successCard }, { quoted: msg });

            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Customization failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 4. DELETE  —  del | del <number>   (reply = start from that message; no reply = latest messages)
    {
        name: 'delete',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const count = parseDelCount(args);
            try {
                const plan = await planDeletion(sock, msg, count);
                if (plan.error) return await sock.sendMessage(jid, { text: plan.error }, { quoted: msg });

                const gifMsg = await sock.sendMessage(jid, {
                    video: { url: DEL_GIF },
                    gifPlayback: true,
                    caption: "Amaterasu!!!!"
                });

                await deleteKeys(sock, jid, plan.keys);
                try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) { /* ignore */ }

                if (plan.keys.length < count || plan.skipped) {
                    const note = await sock.sendMessage(jid, {
                        text: `ℹ️ Deleted *${plan.keys.length}* of ${count}. ` +
                              `${plan.keys.length < count ? 'Only that many were recorded' : ''}` +
                              `${plan.skipped ? `${plan.keys.length < count ? ', and ' : ''}${plan.skipped} could not be deleted (not mine and I'm not allowed to)` : ''}.`
                    });
                    setTimeout(async () => { try { await sock.sendMessage(jid, { delete: note.key }); } catch (e) {} }, 6000);
                }

                setTimeout(async () => {
                    try { await sock.sendMessage(jid, { delete: gifMsg.key }); } catch (err) { /* ignore */ }
                }, 10000);
            } catch (error) {
                console.error("❌ [DELETE] Error:", error);
                await sock.sendMessage(jid, { text: `❌ Delete failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 4b. SETDEL  —  how many messages a bare `del` removes (default 1)
    {
        name: 'setdel',
        isPrefixless: false,
        execute: async (sock, msg, args, ctx = {}) => {
            const jid = msg.key.remoteJid;
            if (!(ctx.isOwner || ctx.isSudo || ctx.isDev || ctx.isAdmin)) return;
            const raw = (args || '').toString().trim();
            const current = Number(config.delCount) || 1;
            if (!raw) {
                return await sock.sendMessage(jid, {
                    text: `🗑️ *del* currently removes *${current}* message(s).\nChange it: \`setdel <number>\` (1-${DEL_MAX})`
                }, { quoted: msg });
            }
            const n = parseInt(raw, 10);
            if (!/^\d+$/.test(raw) || n < 1) {
                return await sock.sendMessage(jid, { text: `❌ Give a number from 1 to ${DEL_MAX}, e.g. \`setdel 5\`.` }, { quoted: msg });
            }
            config.delCount = Math.min(n, DEL_MAX);
            saveState();
            await sock.sendMessage(jid, {
                text: `✅ \`del\` will now remove *${config.delCount}* message(s).${n > DEL_MAX ? `\n(${DEL_MAX} is the maximum.)` : ''}`
            }, { quoted: msg });
        }
    },

    // 5. TDELETE  —  tdel <time> | tdel <number> <time>
    {
        name: 'tdelete',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const input = (args || '').toString().trim();
            if (!input) {
                return await sock.sendMessage(jid, { text: "❌ Provide duration, e.g. `tdel 5s`, or `tdel 3 2m` to delete 3 messages after 2 minutes." }, { quoted: msg });
            }

            // "<number> <time>"  or just "<time>" (then the setdel number is used)
            let count = Number(config.delCount) || 1;
            let timeStr = input;
            const m = input.match(/^(\d+)\s+(\S+)$/);
            if (m) { count = Math.min(Math.max(parseInt(m[1], 10), 1), DEL_MAX); timeStr = m[2]; }

            const durationMs = parseDuration(timeStr);
            if (!durationMs) {
                return await sock.sendMessage(jid, { text: "❌ Invalid duration format. Use `5s`, `2m`, `1h` — e.g. `tdel 3 2m`." }, { quoted: msg });
            }

            try {
                const plan = await planDeletion(sock, msg, count);
                if (plan.error) return await sock.sendMessage(jid, { text: plan.error }, { quoted: msg });

                const promptText = `⏳ *${plan.keys.length}* message(s) will be deleted in *${timeStr}*...`;
                const countdownMsg = await sock.sendMessage(jid, { text: promptText }, { quoted: msg });

                const gifMsg = await sock.sendMessage(jid, {
                    video: { url: DEL_GIF },
                    gifPlayback: true,
                    caption: "Amaterasu!!!!"
                });

                setTimeout(async () => {
                    await deleteKeys(sock, jid, plan.keys);
                    try { await sock.sendMessage(jid, { delete: countdownMsg.key }); } catch (e) { /* ignore */ }
                    try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) { /* ignore */ }
                    setTimeout(async () => {
                        try { await sock.sendMessage(jid, { delete: gifMsg.key }); } catch (err) { /* ignore */ }
                    }, 10000);
                }, durationMs);

            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Timed delete failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 5. AUTOREACT (Added dynamic usage warnings)
    {
        name: 'autoreact',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const targetMode = args ? args.toLowerCase().trim() : '';

            if (!args || !['cmd', 'on', 'all', 'off'].includes(targetMode)) {
                const prompt =
                    `❌ *Usage:* \`${config.prefix}autoreact <on/cmd/all/off>\`\n\n` +
                    `• *cmd / on:* React only to bot commands.\n` +
                    `• *all:* React to all incoming messages.\n` +
                    `• *off:* Disable auto-reactions completely.`;
                return await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
            }

            if (targetMode === 'cmd' || targetMode === 'on') {
                config.autoReact = 'cmd';
            } else if (targetMode === 'all') {
                config.autoReact = 'all';
            } else if (targetMode === 'off') {
                config.autoReact = 'off';
            }
            saveState();
            await sock.sendMessage(jid, { text: `✅ AutoReact set to: \`${config.autoReact}\`` }, { quoted: msg });
        }
    },

    // 6. SPEED (prefixless - Added clock negative offsets fallback)
    {
        name: 'speed',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            await withAnimationLock(jid, async () => {
            const { delay } = await import('@itsliaaa/baileys');

            const emojis = ["5⃣", "4⃣", "3⃣", "2⃣", "1⃣", "🪽"];
            for (const emoji of emojis) {
                try {
                    await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
                    await delay(200);
                } catch (err) { /* ignore */ }
            }

            const msgTime = msg.messageTimestamp * 1000;
            const internalDiff = Date.now() - msgTime;
            const internalPing = Math.abs(internalDiff); // Secure positive index offsets

            const start = Date.now();
            const sent = await sock.sendMessage(jid, { text: "⚡" }, { quoted: msg });
            const networkPing = Date.now() - start;

            await sock.sendMessage(jid, {
                text: `🤞 *Unlimited Speed:* \n\n` +
                      `> *Internal:* \`${internalPing}ms\`\n` +
                      `> *Network:* \`${networkPing}ms\``,
                edit: sent.key
            });
            });
        }
    },

    // 7. GITCLONE (Axios implementation with User-Agent, redirects and size protection limits)
    {
        name: 'gitclone',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            if (!isOwner && !isSudo && !isDev) {
                return await sock.sendMessage(jid, {
                    text: "❌ You are not authorized to use this command. Only owners, sudos, and devs can clone repositories."
                }, { quoted: msg });
            }

            if (!args) {
                return await sock.sendMessage(jid, {
                    text: "❌ Please provide a public GitHub repository URL or shorthand.\nExample: `Botking134/Limitless-MD`"
                }, { quoted: msg });
            }

            let repoQuery = args.trim();
            let owner = "";
            let repo = "";

            try {
                let cleaned = repoQuery
                    .replace(/^https?:\/\//i, '')
                    .replace(/^github\.com\//i, '')
                    .replace(/\.git$/i, '')
                    .replace(/\/+$/, '');

                // Robust forward-parsing to handle branch sub-urls safely
                const segments = cleaned.split('/');
                if (segments.length >= 2) {
                    owner = segments[0].trim();
                    repo = segments[1].trim();
                }
            } catch (parseErr) {
                return await sock.sendMessage(jid, {
                    text: "❌ Failed to parse repository URL. Please use format: `username/repo-name`"
                }, { quoted: msg });
            }

            if (!owner || !repo) {
                return await sock.sendMessage(jid, {
                    text: "❌ Invalid GitHub repository format. Use: `username/repo-name`\nExample: `Botking134/Limitless-MD`"
                }, { quoted: msg });
            }

            const statusMsg = await sock.sendMessage(jid, {
                text: `📥 Fetching repository archive for *${owner}/${repo}...*`
            }, { quoted: msg });

            try {
                const zipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball`;

                const res = await axios.get(zipUrl, {
                    responseType: 'arraybuffer',
                    headers: { 'User-Agent': 'Limitless-Bot' },
                    maxRedirects: 5
                });

                // Read length header to prevent system OOM crashes on huge files
                const contentLength = res.headers['content-length'];
                if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) {
                    return await sock.sendMessage(jid, {
                        text: "❌ Repository archive size exceeds safety threshold (50MB). Cloner aborted.",
                        edit: statusMsg.key
                    });
                }

                const buffer = Buffer.from(res.data);

                await sock.sendMessage(jid, {
                    document: buffer,
                    mimetype: "application/zip",
                    fileName: `${repo}-source.zip`,
                    caption: `📦 *REPOSITORY ARCHIVE READY* 📦\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
                             `• *Repository:* \`${owner}/${repo}\`\n` +
                             `• *Branch:* \`Default\`\n` +
                             `• *Size:* \`${(buffer.length / 1024 / 1024).toFixed(2)} MB\`\n\n` +
                             `_Downloaded directly from GitHub secure servers._ 🤞`
                }, { quoted: msg });

                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) { /* ignore */ }
            } catch (err) {
                console.error("[GITCLONE] Error:", err.message);
                await sock.sendMessage(jid, {
                    text: `❌ Failed to download repository: ${err.message}`,
                    edit: statusMsg.key
                });
            }
        }
    },

    // 8. PING2 (Different animation with deletion crash guards)
    {
        name: 'ping2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            try {
                const { delay } = await import('@itsliaaa/baileys');

                const loadingMsg = await sock.sendMessage(jid, { text: "▱▱▱▱▱▱▱▱▱▱ 0%" }, { quoted: msg });

                const frames = [
                    { text: "▰▱▱▱▱▱▱▱▱▱ 10%", delay: 300 },
                    { text: "▰▰▱▱▱▱▱▱▱▱ 30%", delay: 300 },
                    { text: "▰▰▰▰▱▱▱▱▱▱ 50%", delay: 300 },
                    { text: "▰▰▰▰▰▰▱▱▱▱ 70%", delay: 300 },
                    { text: "▰▰▰▰▰▰▰▰▰▱ 90%", delay: 300 },
                    { text: "▰▰▰▰▰▰▰▰▰▰ 100%", delay: 2000 }
                ];

                for (const frame of frames) {
                    try {
                        await sock.sendMessage(jid, { text: frame.text, edit: loadingMsg.key });
                    } catch (err) {
                        return; // Exit safely if the message is deleted mid-run
                    }
                    await delay(frame.delay);
                }

                const msgTime = msg.messageTimestamp * 1000;
                const latency = Math.abs(Date.now() - msgTime);
                await sock.sendMessage(jid, { text: `Latency: \`${latency}ms\``, edit: loadingMsg.key });
            } catch (error) { /* ignore */ }
        }
    },

    // 9. ADDNOTE (starts note wizard with automatic garbage-collection timeout)
    {
        name: 'addnote',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Format: .addnote <content>" }, { quoted: msg });

            const content = args.trim();

            try {
                const prompt = await sock.sendMessage(jid, {
                    text: `📝 *ADD NOTE WIZARD* 📝\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `👉 Please reply directly to *this message* with your desired *Note Name* to save the note.`
                }, { quoted: msg });

                global.noteSessions = global.noteSessions || {};
                global.noteSessions[prompt.key.id] = { content, author: msg.pushName || 'User', ownerBot: (sock.user?.id || '').replace(/:\d+@/, '@') };

                // Auto garbage-collection after 5 minutes to prevent RAM leak
                setTimeout(() => {
                    if (global.noteSessions && global.noteSessions[prompt.key.id]) {
                        delete global.noteSessions[prompt.key.id];
                    }
                }, 5 * 60 * 1000);

            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to initiate note setup." }, { quoted: msg });
            }
        }
    },

    // 10. DELNOTE
    {
        name: 'delnote',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Format: .delnote <title>" }, { quoted: msg });

            const title = args.trim().toLowerCase();
            const notes = readNotes();

            if (!notes[jid] || !notes[jid][title]) {
                return await sock.sendMessage(jid, { text: `❌ Note with title "${args.trim()}" not found in this chat.` }, { quoted: msg });
            }

            const originalTitle = notes[jid][title].title;
            delete notes[jid][title];
            saveNotes(notes);

            await sock.sendMessage(jid, { text: `✅ Note deleted successfully: *${originalTitle}*` }, { quoted: msg });
        }
    },

    // 11. NOTES (Modernized Dashboard - Removed legacy buttons)
    {
        name: 'notes',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const notes = readNotes();
            const totalNotes = notes[jid] ? Object.keys(notes[jid]).length : 0;

            const prompt = `📝 *STICKY NOTES SYSTEM* 📝\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                           `• *Instructions:* Save text snippets by typing \`.addnote <content>\` and replying directly to the prompt with your desired note name. To retrieve a note, use \`.getnote <name>\`.\n` +
                           `• *Total Notes in this Chat:* \`${totalNotes}\`\n\n` +
                           `👉 Type \`.getnotes\` to view saved note names in this chat.`;

            await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
        }
    },

    // 12. GETNOTES (list all note names)
    {
        name: 'getnotes',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const notes = readNotes();

            if (!notes[jid] || Object.keys(notes[jid]).length === 0) {
                return await sock.sendMessage(jid, { text: "🔮 *No notes found in this chat.*" }, { quoted: msg });
            }

            const list = Object.keys(notes[jid])
                .map((key, i) => `${i + 1}. *${notes[jid][key].title}* _(by ${notes[jid][key].author})_`)
                .join('\n');

            await sock.sendMessage(jid, {
                text: `📝 *Sticky Notes in this Chat:*\n\n${list}\n\n👉 Use \`.getnote <title>\` to read a note.`
            }, { quoted: msg });
        }
    },

    // 13. GETNOTE (retrieve specific note)
    {
        name: 'getnote',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Format: .getnote <title>" }, { quoted: msg });

            const title = args.trim().toLowerCase();
            const notes = readNotes();

            if (!notes[jid] || !notes[jid][title]) {
                return await sock.sendMessage(jid, { text: `❌ Note with title "${args.trim()}" not found in this chat.` }, { quoted: msg });
            }

            const note = notes[jid][title];
            const noteCard =
                `📝 *STICKY NOTE: ${note.title.toUpperCase()}* 📝\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `${note.content}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `👤 *Author:* \`${note.author}\`\n` +
                `🕒 *Saved:* \`${new Date(note.time).toLocaleString()}\``;

            await sock.sendMessage(jid, { text: noteCard }, { quoted: msg });
        }
    },

    
    // 17. UPTIME
    {
        name: 'uptime',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const uptime = formatUptime(process.uptime());

            const content = ` ➢ ${uptime} `;
            const width = content.length;

            const topLine    = '╔' + '═'.repeat(width) + '╗';
            const middleLine = '║' + content; 
            const bottomLine = '╚' + '═'.repeat(width) + '╝';

            const message = `${topLine}\n${middleLine}\n${bottomLine}`;
            await sock.sendMessage(jid, { text: message }, { quoted: msg });
        }
    }, 

    // 18. RUNTIME
    {
        name: 'runtime',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const uptime = formatUptime(process.uptime());

            const now = new Date();
            const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
            const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

            let ram = 'N/A';
try {
    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const usedMem = ((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024).toFixed(1);
    ram = `${usedMem} GB / ${totalMem} GB`;
} catch (e) { /* ignore */ }

            const senderName = msg.pushName || normalizeToJid(msg.key.participant || msg.key.remoteJid || '');

            const message =
`⚡ *SYSTEM ONLINE*
────────────────────
📅 *Date:* ${dateStr}
⏰ *Time:* ${timeStr}
⏳ *Uptime:* ${uptime}
💾 *RAM:* ${ram}
🤖 *Bot:* Limitless-MD v1.0.0
👑 *Owner:* ${senderName}
────────────────────`;

            await sock.sendMessage(jid, { text: message }, { quoted: msg });
        }
    }
];

// ─── ALIASES ──────────────────────────────────────────────────────

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'delete') {
        aliases.push({ ...cmd, name: 'del' });
        aliases.push({ ...cmd, name: 'dlt' });
    }
    if (cmd.name === 'tdelete') {
        aliases.push({ ...cmd, name: 'tdel' });
        aliases.push({ ...cmd, name: 'tdlt' });
    }
});
module.exports.push(...aliases);