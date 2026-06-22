// plugins/utilities.js
const config = require('../config');
const { saveState, normalizeToJid } = require('../stateManager');
const fs = require('fs');
const path = require('path');

// ─── NOTES PATH ──────────────────────────────────────────────────
const notesPath = path.join(__dirname, '../storage/notes.json');

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

function readNotes() {
    try {
        if (fs.existsSync(notesPath)) return JSON.parse(fs.readFileSync(notesPath, 'utf-8'));
    } catch (e) { /* ignore */ }
    return {};
}

function saveNotes(notes) {
    try {
        const dir = path.dirname(notesPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2), 'utf-8');
    } catch (e) { /* ignore */ }
}

// ─── NOTE SESSION HANDLER (also used by tools/addnote) ────────
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
    // 1. PING (animated)
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
                        await sock.sendMessage(jid, { text: frame, edit: loadingMsg.key });
                        await delay(400);
                    }
                    if (cycle === 0) {
                        await sock.sendMessage(jid, { text: "[□□□□□□]", edit: loadingMsg.key });
                        await delay(400);
                    }
                }

                const networkPing = Date.now() - start;
                await sock.sendMessage(jid, {
                    text: `▫️ _Void speed:_   ∞\n➤ _Cursed Energy:_ _\`${networkPing * 100}ms\`_`,
                    edit: loadingMsg.key
                });
            } catch (error) { /* ignore */ }
        }
    },

    // 2. ALIVE
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

            let weather = "Unavailable 🌀";
            try {
                const weatherRes = await fetch("https://wttr.in/Lagos?format=%c+%t");
                if (weatherRes.ok) weather = (await weatherRes.text()).trim();
            } catch (e) { /* ignore */ }

            const compactCaption =
                `🤞 *LIMITLESS DOMAIN ONLINE* 🤞\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `⚡ *Uptime:* \`${uptimeString}\`\n` +
                `🕒 *WAT Time:* \`${nigerianTime}\`\n` +
                `🌤️ *Weather:* \`${weather}\`\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `_“Throughout Heaven and Earth, I alone am the honoured one.”_ 🌏`;

            try {
                await sock.sendMessage(jid, {
                    image: { url: "https://iili.io/C3yej7s.jpg" },
                    caption: compactCaption
                }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: `${compactCaption}\n\n_(Visual engine offline)_` }, { quoted: msg });
            }
        }
    },

// 3. delete

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
            // ─── Bot admin check (group only) ──────────────────────
            if (isGroup) {
                const groupMetadata = await sock.groupMetadata(jid);
                const botJid = sock.user?.id ? normalizeToJid(sock.user.id) : '';
                const botLid = sock.user?.lid ? normalizeToJid(sock.user.lid) : '';

                const isBotAdmin = groupMetadata.participants.some(p => {
                    const pId = normalizeToJid(p.id);
                    // Check if this participant matches either the bot's phone JID or LID
                    return (botJid && (pId === botJid || (botLid && pId === botLid))) &&
                           (p.admin === 'admin' || p.admin === 'superadmin');
                });

                if (!isBotAdmin) {
                    return await sock.sendMessage(jid, {
                        text: "❌ I need to be an admin to delete messages from other users."
                    }, { quoted: msg });
                }
            }

            // ─── Determine if quoted message was sent by the bot ──
            const botJid = sock.user?.id ? normalizeToJid(sock.user.id) : '';
            const botLid = sock.user?.lid ? normalizeToJid(sock.user.lid) : '';

            // The sender of the quoted message (could be a participant or remoteJid)
            const quotedSender = contextInfo.participant || contextInfo.remoteJid || '';
            const normalizedSender = normalizeToJid(quotedSender);

            const isFromMe = (botJid && normalizedSender === botJid) ||
                             (botLid && normalizedSender === botLid);

            // ─── Build the delete key ──────────────────────────────
            const quotedKey = {
                remoteJid: jid,
                id: contextInfo.stanzaId,
                fromMe: isFromMe,
                // For group messages that are NOT from the bot, we must include the participant
                participant: (isGroup && !isFromMe && contextInfo.participant) ? contextInfo.participant : undefined
            };

            // ─── Send Amaterasu GIF ────────────────────────────────
            const gifMsg = await sock.sendMessage(jid, {
                video: { url: "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExYWl1emR6Z3UzaDZ2ZTlqZXR5Mzl6emw2bzFmeGtycGE1dGN3ODJ3cyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3fNmJ20ErpkjK/giphy.mp4" },
                gifPlayback: true,
                caption: "Amaterasu!!!!"
            });

            // ─── Delete the quoted message ─────────────────────────
            await sock.sendMessage(jid, { delete: quotedKey });

            // ─── Delete the command message itself ─────────────────
            await sock.sendMessage(jid, { delete: msg.key });

            // ─── Schedule deletion of the GIF after 10 seconds ──
            setTimeout(async () => {
                try { await sock.sendMessage(jid, { delete: gifMsg.key }); } catch (err) { /* ignore */ }
            }, 10000);

        } catch (error) {
            console.error("❌ [DELETE] Error:", error);
            await sock.sendMessage(jid, { text: `❌ Delete failed: ${error.message}` }, { quoted: msg });
        }
    }
}, 


// 4. tdelete
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
            // ─── Bot admin check (group only) ──────────────────────
            if (isGroup) {
                const groupMetadata = await sock.groupMetadata(jid);
                const botJid = sock.user?.id ? normalizeToJid(sock.user.id) : '';
                const botLid = sock.user?.lid ? normalizeToJid(sock.user.lid) : '';

                const isBotAdmin = groupMetadata.participants.some(p => {
                    const pId = normalizeToJid(p.id);
                    return (botJid && (pId === botJid || (botLid && pId === botLid))) &&
                           (p.admin === 'admin' || p.admin === 'superadmin');
                });

                if (!isBotAdmin) {
                    return await sock.sendMessage(jid, {
                        text: "❌ I need to be an admin to delete messages from other users."
                    }, { quoted: msg });
                }
            }

            // ─── Determine if quoted message was sent by the bot ──
            const botJid = sock.user?.id ? normalizeToJid(sock.user.id) : '';
            const botLid = sock.user?.lid ? normalizeToJid(sock.user.lid) : '';

            const quotedSender = contextInfo.participant || contextInfo.remoteJid || '';
            const normalizedSender = normalizeToJid(quotedSender);

            const isFromMe = (botJid && normalizedSender === botJid) ||
                             (botLid && normalizedSender === botLid);

            // ─── Build the delete key ──────────────────────────────
            const quotedKey = {
                remoteJid: jid,
                id: contextInfo.stanzaId,
                fromMe: isFromMe,
                participant: (isGroup && !isFromMe && contextInfo.participant) ? contextInfo.participant : undefined
            };

            // ─── Send Amaterasu GIF ────────────────────────────────
            const gifMsg = await sock.sendMessage(jid, {
                video: { url: "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExYWl1emR6Z3UzaDZ2ZTlqZXR5Mzl6emw2bzFmeGtycGE1dGN3ODJ3cyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3fNmJ20ErpkjK/giphy.mp4" },
                gifPlayback: true,
                caption: "Amaterasu!!!!"
            });

            // ─── Send countdown message ────────────────────────────
            const countdownMsg = await sock.sendMessage(jid, {
                text: `⏳ Message will be deleted in *${args.trim()}*...`
            }, { quoted: msg });

            // ─── Schedule deletion after the duration ──────────────
            setTimeout(async () => {
                try {
                    // Delete the quoted message
                    await sock.sendMessage(jid, { delete: quotedKey });
                    // Delete the countdown message
                    await sock.sendMessage(jid, { delete: countdownMsg.key });
                    // Delete the command message (if still there)
                    try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) { /* ignore */ }
                    // Schedule GIF deletion after 10s
                    setTimeout(async () => {
                        try { await sock.sendMessage(jid, { delete: gifMsg.key }); } catch (err) { /* ignore */ }
                    }, 10000);
                } catch (error) {
                    console.error("❌ [TDELETE] Timed delete failed:", error);
                }
            }, durationMs);

        } catch (error) {
            console.error("❌ [TDELETE] Error:", error);
            await sock.sendMessage(jid, { text: `❌ Timed delete failed: ${error.message}` }, { quoted: msg });
        }
    }
},


    // 5. AUTOREACT
    {
        name: 'autoreact',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return;

            const targetMode = args.toLowerCase().trim();
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

    // 6. SPEED (prefixless)
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
            const internalPing = Date.now() - msgTime;

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

    // 7. GITCLONE (FIXED)
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

                const parts = cleaned.split('/');
                if (parts.length >= 2) {
                    owner = parts[parts.length - 2].trim();
                    repo = parts[parts.length - 1].trim();
                } else {
                    const regex = /github\.com\/([^\/]+)\/([^\/]+)/i;
                    const match = repoQuery.match(regex);
                    if (match) {
                        owner = match[1];
                        repo = match[2].replace(/\.git$/i, '');
                    }
                }
            } catch (parseErr) {
                console.error("[GITCLONE] Parse error:", parseErr.message);
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
                console.log(`[GITCLONE] Fetching: ${zipUrl}`);

                const res = await fetch(zipUrl);
                if (!res.ok) {
                    const errorText = await res.text();
                    console.error(`[GITCLONE] HTTP ${res.status}: ${errorText}`);
                    throw new Error(`GitHub API returned ${res.status} - Repository may be private or does not exist.`);
                }

                const arrayBuffer = await res.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

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

    // 8. PING2 (different animation)
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
                    await sock.sendMessage(jid, { text: frame.text, edit: loadingMsg.key });
                    await delay(frame.delay);
                }

                const msgTime = msg.messageTimestamp * 1000;
                const latency = Date.now() - msgTime;
                await sock.sendMessage(jid, { text: `Latency: \`${latency}ms\``, edit: loadingMsg.key });
            } catch (error) { /* ignore */ }
        }
    },

    // 9. ADDNOTE (starts note wizard)
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

    // 11. NOTES (dashboard with button)
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
                           `Tapping the button below will display all saved note names.`;

            const buttonMessage = {
                text: prompt,
                buttons: [
                    { buttonId: `${config.prefix}getnotes`, buttonText: { displayText: 'Get Notes 📝' }, type: 1 }
                ],
                headerType: 1
            };

            try {
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: `${prompt}\n\n👉 Use \`.getnotes\` to view note names.` }, { quoted: msg });
            }
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

    // ─── .sc / .repo / .script ──────────────────────────────────────
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

© Limitless-MD 2026`;

            await sock.sendMessage(jid, {
                image: { url: randomImage },
                caption: messageText,
                buttons: [
                    {
                        buttonId: `${config.prefix}repo_zip`,
                        buttonText: { displayText: '📦 Zip' },
                        type: 1
                    },
                    {
                        buttonId: `${config.prefix}repo_link`,
                        buttonText: { displayText: '🔗 Repo' },
                        type: 1
                    }
                ],
                headerType: 1
            }, { quoted: msg });
        }
    },

    // ─── .sc alias ──────────────────────────────────────────────
    {
        name: 'sc',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const cmd = module.exports.find(c => c.name === 'script');
            if (cmd) await cmd.execute(sock, msg, args, { isOwner, isSudo, isDev });
        }
    },

    // ─── .repo alias ─────────────────────────────────────────────
    {
        name: 'repo',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const cmd = module.exports.find(c => c.name === 'script');
            if (cmd) await cmd.execute(sock, msg, args, { isOwner, isSudo, isDev });
        }
    },

    // ─── .uptime ──────────────────────────────────────────────────
{
    name: 'uptime',
    isPrefixless: false,
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        const uptime = formatUptime(process.uptime());

        // Content with arrow and spaces
        const content = ` ➢ ${uptime} `;
        const width = content.length;

        const topLine    = '╔' + '═'.repeat(width) + '╗';
        const middleLine = '║' + content; // No right border
        const bottomLine = '╚' + '═'.repeat(width) + '╝';

        const message = `${topLine}\n${middleLine}\n${bottomLine}`;
        await sock.sendMessage(jid, { text: message }, { quoted: msg });
    }
}, 
        // ─── .runtime ──────────────────────────────────────────────────
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
                const memoryUsage = process.memoryUsage();
                const used = (memoryUsage.heapUsed / 1024 / 1024).toFixed(1);
                const total = (memoryUsage.heapTotal / 1024 / 1024).toFixed(1);
                ram = `${used} MB / ${total} MB`;
            } catch (e) { /* ignore */ }

            // Use sender's name or JID
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