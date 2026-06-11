// plugins/utilities.js
const settings = require('../settings'); 
const { saveSettings } = require('../helpers/settingsSaver'); 
const { Sticker, StickerTypes } = require('wa-sticker-formatter'); 
const fs = require('fs');
const path = require('path');

const notesPath = path.join(__dirname, '../notes.json');

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

    // 7. VIEW ONCE UNLOCKER (.vv)
    {
        name: 'vv',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return;

            const rawContent = getRawMessage(quoted);
            let mediaMessage = rawContent?.imageMessage || rawContent?.videoMessage;
            let mediaType = rawContent?.imageMessage ? "image" : (rawContent?.videoMessage ? "video" : "");

            if (!mediaMessage) return;

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                if (mediaType === "image") {
                    await sock.sendMessage(jid, { image: buffer, caption: mediaMessage.caption || "Unlocked 👁️🔓" }, { quoted: msg });
                } else if (mediaType === "video") {
                    await sock.sendMessage(jid, { video: buffer, mimetype: mediaMessage.mimetype || "video/mp4", caption: mediaMessage.caption || "Unlocked 👁️🔓" }, { quoted: msg });
                }
            } catch (error) {}
        }
    },

    // 8. STANDARD STICKER CONVERTER
    {
        name: 'sticker',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            let mediaContent = getRawMessage(quoted || msg.message);
            
            let mediaMessage = mediaContent?.imageMessage || mediaContent?.videoMessage || mediaContent?.stickerMessage;
            let mediaType = mediaContent?.imageMessage ? "image" : (mediaContent?.videoMessage ? "video" : (mediaContent?.stickerMessage ? "sticker" : ""));

            if (!mediaMessage) return;

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const sticker = new Sticker(buffer, { pack: settings.packName, author: settings.author, type: StickerTypes.FULL, quality: 75 });
                await sock.sendMessage(jid, { sticker: await sticker.toBuffer() }, { quoted: msg });
            } catch (error) {}
        }
    },

    // 9. CROPPED SQUARE STICKER (.crop - Quiet Processing)
    {
        name: 'crop',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const isMedia = msg.message.imageMessage || msg.message.videoMessage || quoted?.imageMessage || quoted?.videoMessage || quoted?.stickerMessage;

            if (!isMedia) return;

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                let mediaContent = getRawMessage(quoted || msg.message);
                let mediaType = mediaContent?.imageMessage ? "image" : (mediaContent?.videoMessage ? "video" : (mediaContent?.stickerMessage ? "sticker" : ""));

                const targetMessage = mediaType === "image" ? mediaContent.imageMessage : (mediaType === "video" ? mediaContent.videoMessage : mediaContent.stickerMessage);
                const stream = await downloadContentFromMessage(targetMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const sticker = new Sticker(buffer, { pack: settings.packName, author: settings.author, type: StickerTypes.CROPPED, quality: 75 });
                await sock.sendMessage(jid, { sticker: await sticker.toBuffer() }, { quoted: msg });
            } catch (error) {}
        }
    },

    // 10. METADATA STEALER (.take / .steal - Quiet Processing)
    {
        name: 'take',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted);
            const isSticker = rawContent?.stickerMessage;

            if (!isSticker) return;

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(rawContent.stickerMessage, 'sticker');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const parts = args.split('|');
                const packName = parts[0] ? parts[0].trim() : settings.packName;
                const publisher = parts[1] ? parts[1].trim() : settings.author;

                const sticker = new Sticker(buffer, { pack: packName, author: publisher, type: StickerTypes.FULL, quality: 100 });
                await sock.sendMessage(jid, { sticker: await sticker.toBuffer() }, { quoted: msg });
            } catch (error) {}
        }
    },

    // 11. STICKER COMMAND TRIGGERS (.setcmd - Prefix Strip fix)
    {
        name: 'setcmd',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted);
            const isSticker = rawContent?.stickerMessage;

            if (!args) {
                const keys = Object.keys(settings.stickerCommands || {});
                if (keys.length === 0) return await sock.sendMessage(jid, { text: `🔮 *No sticker commands currently registered.*` }, { quoted: msg });
                const list = keys.map((key, i) => `${i + 1}. \`${settings.stickerCommands[key]}\``).join('\n');
                return await sock.sendMessage(jid, { text: `🔮 *Active Sticker Commands:*\n\n${list}` }, { quoted: msg });
            }

            if (!settings.stickerCommands) settings.stickerCommands = {};

            let action = args.trim();
            // Automatically strips leading prefixes to resolve mapping errors (allows standard setting e.g., 'ping' instead of '.ping')
            if (action.startsWith(settings.prefix)) {
                action = action.slice(settings.prefix.length).trim();
            }

            if (action.toLowerCase() === 'list') {
                const keys = Object.keys(settings.stickerCommands);
                if (keys.length === 0) return await sock.sendMessage(jid, { text: "🔮 *No commands found.*" }, { quoted: msg });
                const list = keys.map((key, i) => `${i + 1}. \`${settings.stickerCommands[key]}\``).join('\n');
                return await sock.sendMessage(jid, { text: `🔮 *Active Sticker Commands:*\n\n${list}` }, { quoted: msg });
            }

            if (!isSticker) return await sock.sendMessage(jid, { text: "❌ Please reply to a sticker." }, { quoted: msg });

            const fileHash = rawContent.stickerMessage.fileSha256?.toString('base64');
            if (!fileHash) return;

            if (action.toLowerCase() === 'del' || action.toLowerCase() === 'delete') {
                if (!settings.stickerCommands[fileHash]) return;
                delete settings.stickerCommands[fileHash];
                return await sock.sendMessage(jid, { text: `✅ Removed command mapping.` }, { quoted: msg });
            }

            settings.stickerCommands[fileHash] = action;
            saveSettings();
            saveState();
            await sock.sendMessage(jid, { text: `✅ Command \`${action}\` mapped to sticker!` }, { quoted: msg });
        }
    },

    // 12. DEDICATED STICKER TRIGGER DELETER
    {
        name: 'delcmd',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted);
            const isSticker = rawContent?.stickerMessage;

            if (!isSticker) return await sock.sendMessage(jid, { text: "❌ Please reply to a sticker." }, { quoted: msg });

            const fileHash = rawContent.stickerMessage.fileSha256?.toString('base64');
            if (!fileHash || !settings.stickerCommands?.[fileHash]) return;

            delete settings.stickerCommands[fileHash];
            saveSettings();
            saveState();
            await sock.sendMessage(jid, { text: `✅ Trigger mapping successfully deleted!` }, { quoted: msg });
        }
    },

    // 13. REGULAR TO VIEW ONCE CONVERTER
    {
        name: 'tovv',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);
            const isMedia = rawContent?.imageMessage || rawContent?.videoMessage;

            if (!isMedia) return;

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const mediaType = rawContent.imageMessage ? "image" : "video";
                const targetMessage = rawContent.imageMessage || rawContent.videoMessage;
                const mimeType = targetMessage.mimetype || (mediaType === "image" ? "image/jpeg" : "video/mp4");

                const stream = await downloadContentFromMessage(targetMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const payload = { caption: args || targetMessage.caption || "", viewOnce: true };
                payload[mediaType] = buffer;
                payload.mimetype = mimeType;

                await sock.sendMessage(jid, payload, { quoted: msg });
            } catch (error) {}
        }
    },

    // 14. MEDIA TO DIRECT WEB URL CONVERTER (.tourl / .url - Quiet Processing)
    {
        name: 'tourl',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);
            
            let mediaMessage = rawContent?.imageMessage || rawContent?.videoMessage || rawContent?.stickerMessage || rawContent?.audioMessage || rawContent?.documentMessage;
            let mediaType = rawContent?.imageMessage ? "image" : (rawContent?.videoMessage ? "video" : (rawContent?.stickerMessage ? "sticker" : (rawContent?.audioMessage ? "audio" : "document")));

            if (!mediaMessage) return;

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const mimeType = mediaMessage.mimetype || "application/octet-stream";
                const url = await uploadToCloud(buffer, mimeType);

                await sock.sendMessage(jid, { text: `📦 *Limitless Direct URL* 🌐\n\nDirect Link: ${url}` }, { quoted: msg });
            } catch (error) {}
        }
    },

    // 15. PREFIXLESS SILENT KAMUI DM DECODER (Only Owner & Sudo)
    {
        name: 'kamui',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, senderNumber }) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return; 

            // Strict authorization check before processing prefixless kamui
            if (!isOwner && !isSudo) return; 

            const rawContent = getRawMessage(quoted);
            let mediaMessage = rawContent?.imageMessage || rawContent?.videoMessage || rawContent?.audioMessage;
            let mediaType = rawContent?.imageMessage ? "image" : (rawContent?.videoMessage ? "video" : (rawContent?.audioMessage ? "audio" : ""));
            
            if (!mediaMessage) return; 

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                await sock.sendMessage(jid, { react: { text: "🌀", key: msg.key } });

                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const senderJid = msg.key.participant || msg.key.remoteJid;
                // Silently forward decrypted media straight to DM of Owner/Sudoer who triggered it
                const targetDmJid = senderJid.endsWith('@g.us') ? (senderNumber + '@s.whatsapp.net') : senderJid;
                
                if (mediaType === 'image') {
                    await sock.sendMessage(targetDmJid, { image: buffer, caption: "🌀 *Kamui:* Decoded View Once Image" });
                } else if (mediaType === 'video') {
                    const mimeType = mediaMessage.mimetype || "video/mp4";
                    await sock.sendMessage(targetDmJid, { video: buffer, mimetype: mimeType, caption: "🌀 *Kamui:* Decoded View Once Video" });
                } else if (mediaType === 'audio') {
                    await sock.sendMessage(targetDmJid, { audio: buffer, mimetype: mediaMessage.mimetype || "audio/ogg; codecs=opus", ptt: true });
                }
            } catch (e) {}
        }
    },

    // 16. BOT LATENCY COMPARISON TEST
    {
        name: 'ping2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const { delay } = await import('@itsliaaa/baileys');

            const loadingMsg = await sock.sendMessage(jid, { text: "▮▯" }, { quoted: msg });
            const frames = ["▮▮▯", "▮▮▮", "▮▮▮▮"];

            for (const frame of frames) {
                await sock.sendMessage(jid, { text: frame, edit: loadingMsg.key });
                await delay(300); 
            }

            const msgTime = msg.messageTimestamp * 1000;
            await sock.sendMessage(jid, { text: `Latency: \`${Date.now() - msgTime}ms\``, edit: loadingMsg.key });
        }
    },

    // 17. NOTES DASHBOARD
    {
        name: 'notes',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const notes = readNotes();
            if (!args) {
                const count = Object.keys(notes).length;
                return await sock.sendMessage(jid, { text: `📝 *Notes Saved:* \`${count}\`` }, { quoted: msg });
            }

            const targetKey = args.toLowerCase().trim();
            if (notes[targetKey]) {
                return await sock.sendMessage(jid, { text: notes[targetKey].content }, { quoted: msg });
            }
        }
    },

    // 18. ADD NOTE
    {
        name: 'addnote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;
            if (!args) return;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return;

            const content = quoted.conversation || quoted.extendedTextMessage?.text || quoted.imageMessage?.caption || quoted.videoMessage?.caption || '';
            if (!content) return;

            const notes = readNotes();
            const noteKey = args.toLowerCase().trim();

            notes[noteKey] = { name: args.trim(), content, savedAt: Date.now() };
            saveNotes(notes);
            await sock.sendMessage(jid, { text: `✅ Successfully saved note: *${args.trim()}*` }, { quoted: msg });
        }
    },

    // 19. DELETE NOTE
    {
        name: 'delnote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;
            if (!args) return;

            const notes = readNotes();
            const noteKey = args.toLowerCase().trim();

            if (!notes[noteKey]) return;

            delete notes[noteKey];
            saveNotes(notes);
            await sock.sendMessage(jid, { text: `✅ Successfully deleted note: *${args.trim()}*` }, { quoted: msg });
        }
    },

    // 20. GET NOTES LIST
    {
        name: 'getnotes',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const notes = readNotes();
            const keys = Object.keys(notes);

            if (keys.length === 0) return await sock.sendMessage(jid, { text: "📝 No notes registered." }, { quoted: msg });

            let list = `📋 *ACTIVE NOTES DATABASE:*\n\n`;
            keys.forEach((key, idx) => list += `${idx + 1}. *${notes[key].name}*\n`);
            await sock.sendMessage(jid, { text: list }, { quoted: msg });
        }
    },

    // 21. GET NOTE SUB-COMMAND
    {
        name: 'getnote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;
            if (!args) return;

            const notes = readNotes();
            const targetKey = args.toLowerCase().trim();

            if (notes[targetKey]) {
                await sock.sendMessage(jid, { text: notes[targetKey].content }, { quoted: msg });
            }
        }
    },

    // 22. CONFIGURE VIEW ONCE DECRYPT REACTION EMOJI (Strictly Owner-Only)
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

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'sticker') aliases.push({ ...cmd, name: 's' });
    if (cmd.name === 'take') aliases.push({ ...cmd, name: 'steal' });
    if (cmd.name === 'tourl') aliases.push({ ...cmd, name: 'url' });
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