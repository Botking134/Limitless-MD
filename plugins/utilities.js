const config = require('../config');
const { saveState, normalizeToJid, getPhoneJid } = require('../stateManager');
const os = require('os');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// ─── NOTES PATH ──────────────────────────────────────────────────
const notesPath = path.join(__dirname, '../storage/notes.json');

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
    // 1. PING (Animated with deletion crash guards)
    {
        name: 'ping',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            try {
                const { delay } = await import('@itsliaaa/baileys');
                const start = Date.now();

                const loadingMsg = await sock.sendMessage(jid, { text: "[□□□□□□]" }, { quoted: msg });
                const frames = ["[□□□□□□]", "[■□□□□□]", "[■■□□□□]", "[■■■□□□]", "[■■■■□□]", "[■■■■■□]", "[■■■■■■]"];

                for (let cycle = 0; cycle < 2; cycle++) {
                    for (const frame of frames) {
                        if (cycle > 0 && frame === "[□□□□□□]") continue;
                        try {
                            await sock.sendMessage(jid, { text: frame, edit: loadingMsg.key });
                        } catch (err) {
                            return; // Break immediately if the user deleted the message during the loop
                        }
                        await delay(400);
                    }
                    if (cycle === 0) {
                        try {
                            await sock.sendMessage(jid, { text: "[□□□□□□]", edit: loadingMsg.key });
                        } catch (err) { return; }
                        await delay(400);
                    }
                }

                const networkPing = Date.now() - start;
                try {
                    await sock.sendMessage(jid, {
                        text: `▫️ _Void speed:_   ∞\n➤ _Cursed Energy:_ _\`${networkPing * 100}ms\`_`,
                        edit: loadingMsg.key
                    });
                } catch (err) { /* ignore */ }
            } catch (error) { /* ignore */ }
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

    // 4. DELETE (Safe DM, LID checks, and deletion crash guards)
    {
        name: 'delete',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
            if (!contextInfo || !contextInfo.stanzaId) {
                return await sock.sendMessage(jid, { text: "❌ Reply to a message to delete." }, { quoted: msg });
            }

            try {
                const botJid = sock.user?.id ? normalizeToJid(sock.user.id) : '';
                const botLid = sock.user?.lid ? normalizeToJid(sock.user.lid) : '';

                const quotedSender = contextInfo.participant || contextInfo.remoteJid || '';
                const normalizedSender = normalizeToJid(quotedSender);

                const isFromMe = (botJid && normalizedSender === botJid) ||
                                 (botLid && normalizedSender === botLid);

                // Safe DM check: block trying to delete other user's message in private DMs
                if (!isGroup && !isFromMe) {
                    return await sock.sendMessage(jid, { text: "❌ You can only delete your own messages in private DMs." }, { quoted: msg });
                }

                // Group Admin check
                if (isGroup && !isFromMe) {
                    const groupMetadata = await sock.groupMetadata(jid);
                    const isBotAdmin = groupMetadata.participants.some(p => {
                        const pId = normalizeToJid(p.id);
                        return (botJid && pId === botJid) || (botLid && pId === botLid);
                    });

                    if (!isBotAdmin) {
                        return await sock.sendMessage(jid, {
                            text: "❌ I need to be an admin to delete messages from other users."
                        }, { quoted: msg });
                    }
                }

                const quotedKey = {
                    remoteJid: jid,
                    id: contextInfo.stanzaId,
                    fromMe: isFromMe,
                    participant: (isGroup && !isFromMe && contextInfo.participant) ? contextInfo.participant : undefined
                };

                const gifMsg = await sock.sendMessage(jid, {
                    video: { url: "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExYWl1emR6Z3UzaDZ2ZTlqZXR5Mzl6emw2bzFmeGtycGE1dGN3ODJ3cyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3fNmJ20ErpkjK/giphy.mp4" },
                    gifPlayback: true,
                    caption: "Amaterasu!!!!"
                });

                await sock.sendMessage(jid, { delete: quotedKey });
                try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) { /* ignore */ }

                setTimeout(async () => {
                    try { await sock.sendMessage(jid, { delete: gifMsg.key }); } catch (err) { /* ignore */ }
                }, 10000);

            } catch (error) {
                console.error("❌ [DELETE] Error:", error);
                await sock.sendMessage(jid, { text: `❌ Delete failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 5. TDELETE (Timed Delete - Safe DM checks & try-catch timeouts)
    {
        name: 'tdelete',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
            if (!contextInfo || !contextInfo.stanzaId) {
                return await sock.sendMessage(jid, { text: "❌ Reply to a message and specify a duration." }, { quoted: msg });
            }

            if (!args) {
                return await sock.sendMessage(jid, { text: "❌ Provide duration (e.g., `5s`, `2m`, `1h`)." }, { quoted: msg });
            }

            const durationMs = parseDuration(args.trim());
            if (!durationMs) {
                return await sock.sendMessage(jid, { text: "❌ Invalid duration format. Use `5s`, `2m`, `1h`." }, { quoted: msg });
            }

            try {
                const botJid = sock.user?.id ? normalizeToJid(sock.user.id) : '';
                const botLid = sock.user?.lid ? normalizeToJid(sock.user.lid) : '';

                const quotedSender = contextInfo.participant || contextInfo.remoteJid || '';
                const normalizedSender = normalizeToJid(quotedSender);

                const isFromMe = (botJid && normalizedSender === botJid) ||
                                 (botLid && normalizedSender === botLid);

                if (!isGroup && !isFromMe) {
                    return await sock.sendMessage(jid, { text: "❌ You can only delete your own messages in private DMs." }, { quoted: msg });
                }

                if (isGroup && !isFromMe) {
                    const groupMetadata = await sock.groupMetadata(jid);
                    const isBotAdmin = groupMetadata.participants.some(p => {
                        const pId = normalizeToJid(p.id);
                        return (botJid && pId === botJid) || (botLid && pId === botLid);
                    });

                    if (!isBotAdmin) {
                        return await sock.sendMessage(jid, {
                            text: "❌ I need to be an admin to delete messages from other users."
                        }, { quoted: msg });
                    }
                }

                const quotedKey = {
                    remoteJid: jid,
                    id: contextInfo.stanzaId,
                    fromMe: isFromMe,
                    participant: (isGroup && !isFromMe && contextInfo.participant) ? contextInfo.participant : undefined
                };

                const promptText = `⏳ Message will be deleted in *${args.trim()}*...`;
                const countdownMsg = await sock.sendMessage(jid, { text: promptText }, { quoted: msg });

                const gifMsg = await sock.sendMessage(jid, {
                    video: { url: "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExYWl1emR6Z3UzaDZ2ZTlqZXR5Mzl6emw2bzFmeGtycGE1dGN3ODJ3cyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3fNmJ20ErpkjK/giphy.mp4" },
                    gifPlayback: true,
                    caption: "Amaterasu!!!!"
                });

                // Isolated try-catch timeout block
                setTimeout(async () => {
                    try { await sock.sendMessage(jid, { delete: quotedKey }); } catch (e) { /* ignore */ }
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
                global.noteSessions[prompt.key.id] = { content, author: msg.pushName || 'User' };

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

    // 14. SCRIPT (Modernized - Removed legacy buttons)
    {
        name: 'script',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            const images = [
                "https://files.catbox.moe/gnp8q2.jpeg",
                "https://files.catbox.moe/rmaqfn.jpeg"
            ];
            const randomImage = images[Math.floor(Math.random() * images.length)];

            const messageText =
`🤖 *Limitless-MD - AI Bot* 🤖

I Am A Multifunctional WhatsApp Bot Built With Baileys Library, Assembled By My Creator *Infinity*

{BOT INFORMATION}
- *Creator* : Infinity
- *Version* : 1.0.0
- *Type* : Multi-Device (Baileys)
- *Mode* : Public / Private
- *Runtime* : ${formatUptime(process.uptime())}
- *Commands* : 100+ Features

© Limitless-MD 2026\n\n` +
`👉 To clone the source repository directly, use command:\n\`${config.prefix}gitclone Botking134/Limitless-MD\``;

            try {
                await sock.sendMessage(jid, {
                    image: { url: randomImage },
                    caption: messageText
                }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: messageText }, { quoted: msg });
            }
        }
    },

    // 15. SC (Script alias)
    {
        name: 'sc',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const cmd = module.exports.find(c => c.name === 'script');
            if (cmd) await cmd.execute(sock, msg, args, { isOwner, isSudo, isDev });
        }
    },

    // 16. REPO (Script alias)
    {
        name: 'repo',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const cmd = module.exports.find(c => c.name === 'script');
            if (cmd) await cmd.execute(sock, msg, args, { isOwner, isSudo, isDev });
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