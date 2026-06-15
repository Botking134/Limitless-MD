// plugins/utilities.js
const settings = require('../settings'); 
const { saveSettings } = require('../helpers/settingsSaver'); 
const fs = require('fs');
const path = require('path');

const notesPath = path.join(__dirname, '../notes.json');

// Helper function to format system uptime
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${Math.floor(s)}s`;
}

// Duration string parser
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

// Sticky Notes file operations
function readNotes() {
    try {
        if (fs.existsSync(notesPath)) return JSON.parse(fs.readFileSync(notesPath, 'utf-8'));
    } catch (e) {}
    return {};
}

function saveNotes(notes) {
    try {
        fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2), 'utf-8');
    } catch (e) {}
}

// Recursive Helper to automatically unwrap envelopes
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

module.exports = [
    // 1. PING COMMAND
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
                await sock.sendMessage(jid, { text: `▫️ _Void speed:_   ∞\n➤ _Cursed Energy:_ _\`${networkPing * 100}ms\`_`, edit: loadingMsg.key });
            } catch (error) {}
        }
    },

    // 2. ALIVE COMMAND
    {
        name: 'alive',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const uptimeString = formatUptime(process.uptime());

            const timeOptions = { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: true, weekday: 'short', day: 'numeric', month: 'short' };
            const timeFormatter = new Intl.DateTimeFormat('en-US', timeOptions);
            const nigerianTime = timeFormatter.format(new Date());

            let weather = "Unavailable 🌀";
            try {
                const weatherRes = await fetch("https://wttr.in/Lagos?format=%c+%t");
                if (weatherRes.ok) weather = (await weatherRes.text()).trim();
            } catch (e) {}

            const compactCaption = 
                `🤞 *LIMITLESS DOMAIN ONLINE* 🤞\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `⚡ *Uptime:* \`${uptimeString}\`\n` +
                `🕒 *WAT Time:* \`${nigerianTime}\`\n` +
                `🌤️ *Weather:* \`${weather}\`\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `_“Throughout Heaven and Earth, I alone am the honoured one.”_ 🌏`;

            try {
                await sock.sendMessage(jid, { image: { url: "https://iili.io/C3yej7s.jpg" }, caption: compactCaption }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: `${compactCaption}\n\n_(Visual engine offline)_` }, { quoted: msg });
            }
        }
    },

    // 3. MESSAGE DELETER
    {
        name: 'delete',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo;
            if (!quoted || !quoted.stanzaId) return;

            try {
                const botJid = settings.botJid || (sock.user?.id ? (sock.user.id.includes('@lid') ? '' : sock.user.id.replace(/:.*/, '') + '@s.whatsapp.net') : '');
                const botLid = settings.botLid || (sock.user?.id ? (sock.user.id.includes('@lid') ? sock.user.id.replace(/:.*/, '') + '@lid' : '') : '');

                const isFromMe = quoted.participant === botJid || (botLid && quoted.participant === botLid);

                const quotedKey = { remoteJid: jid, id: quoted.stanzaId, fromMe: isFromMe, participant: quoted.participant };
                await sock.sendMessage(jid, { delete: quotedKey });
                try { await sock.sendMessage(jid, { delete: msg.key }); } catch (err) {}
            } catch (error) {}
        }
    },

    // 4. TIMED DELETER COMMAND
    {
        name: 'tdelete',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo;
            if (!quoted || !quoted.stanzaId || !args) return;

            const durationMs = parseDuration(args.trim());
            if (!durationMs) return;

            try {
                const countdownMsg = await sock.sendMessage(jid, { text: `⏳ Message will be deleted in *${args.trim()}*...` }, { quoted: msg });
                setTimeout(async () => {
                    try {
                        const botJid = settings.botJid || (sock.user?.id ? (sock.user.id.includes('@lid') ? '' : sock.user.id.replace(/:.*/, '') + '@s.whatsapp.net') : '');
                        const botLid = settings.botLid || (sock.user?.id ? (sock.user.id.includes('@lid') ? sock.user.id.replace(/:.*/, '') + '@lid' : '') : '');
                        const isFromMe = quoted.participant === botJid || (botLid && quoted.participant === botLid);

                        const quotedKey = { remoteJid: jid, id: quoted.stanzaId, fromMe: isFromMe, participant: quoted.participant };
                        await sock.sendMessage(jid, { delete: quotedKey });
                        try { await sock.sendMessage(jid, { delete: countdownMsg.key }); } catch (e) {}
                    } catch (err) {}
                }, durationMs);
            } catch (error) {}
        }
    },

    // 5. AUTOREACT MODE TOGGLE
    {
        name: 'autoreact',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return;

            const targetMode = args.toLowerCase().trim();
            if (targetMode === 'cmd' || targetMode === 'on') {
                settings.autoReact = 'cmd';
            } else if (targetMode === 'all') {
                settings.autoReact = 'all';
            } else if (targetMode === 'off') {
                settings.autoReact = 'off';
            }
            saveSettings();
            saveState();
        }
    },

    // 6. PREFIXLESS SPEED COMMAND
    {
        name: 'speed',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const { delay } = await import('@itsliaaa/baileys');

            const emojis = ["⚡", "❄", "🤞"];
            for (const emoji of emojis) {
                try {
                    await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
                    await delay(200); 
                } catch (err) {}
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

    // 7. AUTO REPOSITORY DOWNLOAD COMPILER (.gitclone)
    {
        name: 'gitclone',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a public GitHub repository URL or shorthand. Example: `Botking134/Limitless.MD`" }, { quoted: msg });

            let repoQuery = args.trim();
            let owner = "";
            let repo = "";

            const regexFull = /github\.com\/([a-zA-Z0-9\-]+)\/([a-zA-Z0-9\-\._]+)/i;
            const matchFull = repoQuery.match(regexFull);

            if (matchFull) {
                owner = matchFull[1];
                repo = matchFull[2].replace(/\.git$/i, '');
            } else {
                const parts = repoQuery.split('/');
                if (parts.length === 2) {
                    owner = parts[0].trim();
                    repo = parts[1].trim();
                }
            }

            if (!owner || !repo) {
                return await sock.sendMessage(jid, { text: "❌ Invalid GitHub repository format. Use: `username/repo-name`" }, { quoted: msg });
            }

            const statusMsg = await sock.sendMessage(jid, { text: `📥 Fetching repository archive for *${owner}/${repo}...*` }, { quoted: msg });

            try {
                const zipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball`;
                const res = await fetch(zipUrl);
                if (!res.ok) throw new Error();

                const arrayBuffer = await res.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                await sock.sendMessage(jid, {
                    document: buffer,
                    mimetype: "application/zip",
                    fileName: `${repo}-source.zip`,
                    caption: `📦 *REPOSITORY ARCHIVE READY* 📦\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
                             `• *Repository:* \`${owner}/${repo}\`\n` +
                             `• *Branch:* \`Default\`\n\n` +
                             `_Downloaded directly from GitHub secure servers._ 🤞`
                }, { quoted: msg });

                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) {}
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed to download archive. Make sure the repository is public and exists.`, edit: statusMsg.key });
            }
        }
    },

    // 8. BOT LATENCY COMPARISON TEST (.ping2)
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
                    { text: "▰▰▰▰▰▰▰▰▰▰ 100%", delay: 2000 } // Holds exactly 2 seconds (2000ms) after hitting 100%
                ];

                for (const frame of frames) {
                    await sock.sendMessage(jid, { text: frame.text, edit: loadingMsg.key });
                    await delay(frame.delay);
                }

                const msgTime = msg.messageTimestamp * 1000;
                const latency = Date.now() - msgTime;
                await sock.sendMessage(jid, { text: `Latency: \`${latency}ms\``, edit: loadingMsg.key });
            } catch (error) {}
        }
    },

    // 9. ADD NOTE COMMAND (.addnote)
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

    // 10. DELETE NOTE COMMAND (.delnote)
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

    // 11. GET STICKY NOTES SUMMARY & INSTRUCTIONS DASHBOARD (.notes)
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
                    { buttonId: `${settings.prefix}getnotes`, buttonText: { displayText: 'Get Notes 📝' }, type: 1 }
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

    // 12. LIST ALL NOTES NAMES COMMAND (.getnotes)
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

            await sock.sendMessage(jid, { text: `📝 *Sticky Notes in this Chat:*\n\n${list}\n\n👉 Use \`.getnote <title>\` to read a note.` }, { quoted: msg });
        }
    },

    // 13. GET SPECIFIC NOTE COMMAND (.getnote)
    {
        name: 'getnote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
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

    // 14. CONFIGURE VIEW ONCE DECRYPT REACTION EMOJI (Strictly Owner-Only)
    {
        name: 'vvs',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return; // Strict Owner-Only permission gate

            if (!args) {
                const current = settings.vvEmoji || '🥷';
                return await sock.sendMessage(jid, { text: `❌ Please provide an emoji. (Current: ${current})` }, { quoted: msg });
            }

            const emoji = args.trim();
            settings.vvEmoji = emoji;
            saveSettings();
            saveState();

            await sock.sendMessage(jid, { text: `✅ View Once Decryption reaction emoji configured to: ${emoji}` }, { quoted: msg });
        }
    }
];

// Reusable dynamic note saving wizard session callback handler
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

module.exports.handleNoteSession = handleNoteSession;

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
    if (cmd.name === 'ping') {
        aliases.push({ ...cmd, name: 'ping2' });
    }
});
module.exports.push(...aliases);