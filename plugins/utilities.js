// plugins/utilities.js
const settings = require('../settings'); // Up one level to settings.js
const { Sticker, StickerTypes } = require('wa-sticker-formatter'); // Standard JJK/Kord sticker compiler
const fs = require('fs');
const path = require('path');

const notesPath = path.join(__dirname, '../notes.json');

// Helper function to format system uptime securely
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${Math.floor(s)}s`;
}

// Notes Database Helpers
function readNotes() {
    try {
        if (fs.existsSync(notesPath)) {
            return JSON.parse(fs.readFileSync(notesPath, 'utf-8'));
        }
    } catch (e) {
        console.error("❌ [NOTES] Failed to read notes database:", e.message);
    }
    return {};
}

function saveNotes(notes) {
    try {
        fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2), 'utf-8');
    } catch (e) {
        console.error("❌ [NOTES] Failed to persist notes to database:", e.message);
    }
}

// Recursive Helper to automatically unwrap ephemeral, view-once, and document-caption envelopes
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

// Helper to crop an image, WebP Sticker, or GIF buffer to a square
async function cropToSquare(buffer) {
    try {
        let lib = {};
        try {
            const baileys = await import('@itsliaaa/baileys');
            if (typeof baileys.getImageProcessingLibrary === 'function') {
                lib = await baileys.getImageProcessingLibrary();
            }
        } catch (baileysErr) {
            console.error("Defensive Baileys dynamic fetch failed:", baileysErr.message);
        }
        
        if (lib.sharp?.default) {
            return await lib.sharp.default(buffer)
                .resize(512, 512, { fit: 'cover' })
                .toBuffer();
        }
        else if (lib.image?.Transformer) {
            const img = new lib.image.Transformer(buffer);
            return await img.resize(512, 512, 2).png();
        }
        else if (lib.jimp?.Jimp) {
            const img = await lib.jimp.Jimp.read(buffer);
            return await img.cover({ w: 512, h: 512 }).getBuffer('image/png');
        }
    } catch (e) {
        console.error("Square cropping error:", e.message);
    }
    return buffer; 
}

// Helper to convert WebP sticker buffer back to PNG buffer to force EXIF rewrites
async function forceMetadataRewrite(buffer) {
    try {
        let lib = {};
        try {
            const baileys = await import('@itsliaaa/baileys');
            if (typeof baileys.getImageProcessingLibrary === 'function') {
                lib = await baileys.getImageProcessingLibrary();
            }
        } catch (baileysErr) {}
        
        if (lib.sharp?.default) {
            return await lib.sharp.default(buffer).png().toBuffer();
        }
        else if (lib.image?.Transformer) {
            const img = new lib.image.Transformer(buffer);
            return await img.png();
        }
        else if (lib.jimp?.Jimp) {
            const img = await lib.jimp.Jimp.read(buffer);
            return await img.getBuffer('image/png');
        }
    } catch (e) {
        console.error("EXIF force rewrite error:", e.message);
    }
    return buffer; 
}

// Helper to upload media buffer natively to a multi-host pipeline
async function uploadToCloud(buffer, mimeType) {
    const ext = mimeType.split('/')[1] || 'bin';
    const filename = `file_${Date.now()}.${ext}`;

    try {
        console.log(`🌐 [UPLOADER] Trying Pixeldrain PUT...`);
        const response = await fetch(`https://pixeldrain.com/api/file/${filename}`, {
            method: 'PUT',
            body: buffer
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success && data.id) {
                console.log(`✅ [UPLOADER] Successfully uploaded to Pixeldrain: ${data.id}`);
                return `https://pixeldrain.com/api/file/${data.id}`;
            }
        }
    } catch (err) {
        console.error(`⚠️ [UPLOADER] Pixeldrain PUT failed:`, err.message);
    }

    const formData = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    formData.append('files[]', blob, filename); 

    const hosts = [
        'https://qu.ax/upload.php',
        'https://pomf2.lain.la/upload.php'
    ];

    for (const host of hosts) {
        try {
            console.log(`🌐 [UPLOADER] Trying fallback host: ${host}`);
            const response = await fetch(host, {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.files?.[0]?.url) {
                    console.log(`✅ [UPLOADER] Successfully uploaded to: ${host}`);
                    return data.files[0].url;
                }
            }
        } catch (err) {
            console.error(`⚠️ [UPLOADER] Host ${host} failed:`, err.message);
        }
    }

    throw new Error("All upload hosts failed.");
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
                const cursedEnergy = networkPing * 100;

                await sock.sendMessage(jid, {
                    text: `▫️ _Void speed:_   ∞\n` +
                          `➤ _Cursed Energy:_ _\`${cursedEnergy}ms\`_`,
                    edit: loadingMsg.key
                });
            } catch (error) {
                console.error("Ping Command Error:", error);
            }
        }
    },

    // 2. ALIVE COMMAND (Upgraded & Compacted Status Bubble)
    {
        name: 'alive',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const uptimeString = formatUptime(process.uptime());

            // 1. Resolve Nigerian Time (WAT) dynamically
            const timeOptions = {
                timeZone: 'Africa/Lagos',
                hour: '2-digit', minute: '2-digit',
                hour12: true,
                weekday: 'short', day: 'numeric', month: 'short'
            };
            const timeFormatter = new Intl.DateTimeFormat('en-US', timeOptions);
            const nigerianTime = timeFormatter.format(new Date());

            // 2. Fetch compact one-line weather metrics safely
            let weather = "Unavailable 🌀";
            try {
                const weatherRes = await fetch("https://wttr.in/Lagos?format=%c+%t");
                if (weatherRes.ok) {
                    const weatherText = await weatherRes.text();
                    weather = weatherText.trim();
                }
            } catch (e) {
                console.error("Alive weather fetch error:", e.message);
            }

            // 3. Compile sleek, non-bloated status caption
            const compactCaption = 
                `🤞 *LIMITLESS DOMAIN ONLINE* 🤞\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `⚡ *Uptime:* \`${uptimeString}\`\n` +
                `🕒 *WAT Time:* \`${nigerianTime}\`\n` +
                `🌤️ *Weather:* \`${weather}\`\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `_“Throughout Heaven and Earth, I alone am the honoured one.”_ 🌏`;

            try {
                await sock.sendMessage(jid, {
                    image: { url: "https://iili.io/C3yej7s.jpg" },
                    caption: compactCaption
                }, { quoted: msg });
            } catch (error) {
                console.error("Alive Command Error:", error);
                await sock.sendMessage(jid, { 
                    text: `${compactCaption}\n\n_(Visual engine offline)_` 
                }, { quoted: msg });
            }
        }
    },

    // 3. MESSAGE DELETER (LID-Safe)
    {
        name: 'delete',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo;

            if (!quoted || !quoted.stanzaId) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to the message you want to delete." }, { quoted: msg });
            }

            try {
                const botJid = settings.botJid || (sock.user?.id ? (sock.user.id.includes('@lid') ? '' : sock.user.id.replace(/:.*/, '') + '@s.whatsapp.net') : '');
                const botLid = settings.botLid || (sock.user?.id ? (sock.user.id.includes('@lid') ? sock.user.id.replace(/:.*/, '') + '@lid' : '') : '');

                const isFromMe = quoted.participant === botJid || (botLid && quoted.participant === botLid);

                const quotedKey = {
                    remoteJid: jid,
                    id: quoted.stanzaId,
                    fromMe: isFromMe,
                    participant: quoted.participant
                };

                await sock.sendMessage(jid, { delete: quotedKey });

                try {
                    await sock.sendMessage(jid, { delete: msg.key });
                } catch (err) {}
            } catch (error) {
                console.error("Delete Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to delete message. If inside a group, ensure the bot is an administrator." }, { quoted: msg });
            }
        }
    },

    // 4. AUTOREACT MODE TOGGLE
    {
        name: 'autoreact',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❄ *Current Autoreact Setting:* \`${settings.autoReact || 'off'}\`\n\n` +
                          `Available Options:\n` +
                          `• \`${settings.prefix}autoreact cmd\` (or \`on\`) — React with ❄ to commands.\n` +
                          `• \`${settings.prefix}autoreact all\` — React with ❄ to every single message.\n` +
                          `• \`${settings.prefix}autoreact off\` — Disable autoreact.`
                }, { quoted: msg });
            }

            const targetMode = args.toLowerCase().trim();

            if (targetMode === 'cmd' || targetMode === 'on') {
                settings.autoReact = 'cmd';
                await sock.sendMessage(jid, { text: "❄ *Autoreact Mode Updated:* `cmd` (I will react only to active commands)" }, { quoted: msg });
            } else if (targetMode === 'all') {
                settings.autoReact = 'all';
                await sock.sendMessage(jid, { text: "❄ *Autoreact Mode Updated:* `all` (I will react to every single message)" }, { quoted: msg });
            } else if (targetMode === 'off') {
                settings.autoReact = 'off';
                await sock.sendMessage(jid, { text: "❄ *Autoreact Mode Updated:* Disabled" }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: "❌ Invalid option. Use `cmd`, `all`, or `off`." }, { quoted: msg });
            }
        }
    },

    // 5. PREFIXLESS SPEED COMMAND
    {
        name: 'speed',
        isPrefixless: true,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const { delay } = await import('@itsliaaa/baileys');

            const emojis = ["⚡", "❄", "🕴", "🤞", "🥷"];
            for (const emoji of emojis) {
                try {
                    await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
                    await delay(300); 
                } catch (err) {
                    console.error("Reaction step failed:", err.message);
                }
            }

            const msgTime = msg.messageTimestamp * 1000;
            const internalPing = Date.now() - msgTime;

            const start = Date.now();
            const sent = await sock.sendMessage(jid, { text: "⚡" }, { quoted: msg });
            const networkPing = Date.now() - start;

            const statements = [
                "Are you crying? Don't worry, I'm simply the strongest. Your perception of time is basically standing still to me.",
                "Speed? Please. I don't run, the space around me just gets out of my way. You're too slow.",
                "You're lucky I'm in a good mood. Otherwise, you wouldn't even see me move.",
                "My Infinity makes your speed look like a joke. Don't compare yourself to me.",
                "To me, your actions look like they are in slow motion. I'm on a completely different level."
            ];
            const selectedStatement = statements[Math.floor(Math.random() * statements.length)];

            await sock.sendMessage(jid, {
                text: `🤞 *${selectedStatement}*\n\n` +
                      `> *Cursed amplification:* \`${internalPing}ms\`\n` +
                      `> *Reversed curse technique:* \`${networkPing}ms\``,
                edit: sent.key
            });
        }
    },

    // 6. VIEW ONCE UNLOCKER (.vv)
    {
        name: 'vv',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a View Once image or video." }, { quoted: msg });
            }

            const rawContent = getRawMessage(quoted);
            let mediaMessage = null;
            let mediaType = "";

            if (rawContent?.imageMessage) {
                mediaMessage = rawContent.imageMessage;
                mediaType = "image";
            } else if (rawContent?.videoMessage) {
                mediaMessage = rawContent.videoMessage;
                mediaType = "video";
            }

            if (!mediaMessage) {
                return await sock.sendMessage(jid, { text: "❌ Quoted message is not an image or video." }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                await sock.sendMessage(jid, { text: "Extracting from the conceptual void... 👁️🔓" }, { quoted: msg });

                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                if (mediaType === "image") {
                    await sock.sendMessage(jid, {
                        image: buffer,
                        caption: mediaMessage.caption || "Unlocked View Once Image 👁️🔓"
                    }, { quoted: msg });
                } else if (mediaType === "video") {
                    const mimeType = mediaMessage.mimetype || "video/mp4";
                    await sock.sendMessage(jid, {
                        video: buffer,
                        mimetype: mimeType,
                        caption: mediaMessage.caption || "Unlocked View Once Video 👁️🔓"
                    }, { quoted: msg });
                }

            } catch (error) {
                console.error("View Once Unlock Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to unlock View Once media." }, { quoted: msg });
            }
        }
    },

    // 7. STANDARD STICKER CONVERTER
    {
        name: 'sticker',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            let mediaContent = getRawMessage(quoted || msg.message);
            
            let mediaMessage = null;
            let mediaType = "";

            if (mediaContent?.imageMessage) {
                mediaMessage = mediaContent.imageMessage;
                mediaType = "image";
            } else if (mediaContent?.videoMessage) {
                mediaMessage = mediaContent.videoMessage;
                mediaType = "video";
            } else if (mediaContent?.stickerMessage) {
                mediaMessage = mediaContent.stickerMessage;
                mediaType = "sticker";
            }

            if (!mediaMessage) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to or attach an image or short video." }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                await sock.sendMessage(jid, { text: "Formulating sticker... 📃" }, { quoted: msg });

                const mimeType = mediaMessage.mimetype || (mediaType === "image" ? "image/jpeg" : (mediaType === "sticker" ? "image/webp" : "video/mp4"));

                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const sticker = new Sticker(buffer, {
                    pack: settings.packName,
                    author: settings.author,
                    type: StickerTypes.FULL,
                    quality: 75
                });

                const stickerBuffer = await sticker.toBuffer();

                await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });

            } catch (error) {
                console.error("Sticker Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to convert media to sticker." }, { quoted: msg });
            }
        }
    },

    // 8. CROPPED SQUARE STICKER (.crop)
    {
        name: 'crop',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const isMedia = msg.message.imageMessage || msg.message.videoMessage || quoted?.imageMessage || quoted?.videoMessage || quoted?.stickerMessage;

            if (!isMedia) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to or attach an image, gif/video, or sticker to crop." }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                await sock.sendMessage(jid, { text: "Cropping to square... 📐" }, { quoted: msg });

                let mediaContent = getRawMessage(quoted || msg.message);
                let mediaType = mediaContent?.imageMessage ? "image" : (mediaContent?.videoMessage ? "video" : (mediaContent?.stickerMessage ? "sticker" : ""));

                const targetMessage = mediaType === "image" ? mediaContent.imageMessage : (mediaType === "video" ? mediaContent.videoMessage : mediaContent.stickerMessage);
                const mimeType = targetMessage.mimetype || (mediaType === "image" ? "image/jpeg" : (mediaType === "video" ? "video/mp4" : "image/webp"));

                const stream = await downloadContentFromMessage(targetMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const sticker = new Sticker(buffer, {
                    pack: settings.packName,
                    author: settings.author,
                    type: StickerTypes.CROPPED, 
                    quality: 75
                });

                const stickerBuffer = await sticker.toBuffer();

                await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });

            } catch (error) {
                console.error("Crop Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to generate cropped sticker." }, { quoted: msg });
            }
        }
    },

    // 9. METADATA STEALER (.take / .steal)
    {
        name: 'take',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted);
            const isSticker = rawContent?.stickerMessage;

            if (!isSticker) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to the sticker you want to steal/take." }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                await sock.sendMessage(jid, { text: "Stealing metadata... 🥷" }, { quoted: msg });

                const targetMessage = rawContent.stickerMessage;

                const stream = await downloadContentFromMessage(targetMessage, 'sticker');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const parts = args.split('|');
                const packName = parts[0] ? parts[0].trim() : settings.packName;
                const publisher = parts[1] ? parts[1].trim() : settings.author;

                const sticker = new Sticker(buffer, {
                    pack: packName,
                    author: publisher,
                    type: StickerTypes.FULL,
                    quality: 100 
                });

                const stickerBuffer = await sticker.toBuffer();

                await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });

            } catch (error) {
                console.error("Take Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to customize sticker metadata." }, { quoted: msg });
            }
        }
    },

    // 10. STICKER COMMAND TRIGGERS (.setcmd)
    {
        name: 'setcmd',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;

            if (!isOwner && !isSudo) {
                return await sock.sendMessage(jid, { text: "❌ Access Denied. Only Owners and Sudo users can set sticker commands." }, { quoted: msg });
            }

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted);
            const isSticker = rawContent?.stickerMessage;

            if (!args) {
                const keys = Object.keys(settings.stickerCommands || {});
                if (keys.length === 0) {
                    return await sock.sendMessage(jid, { 
                        text: `🔮 *Limitless Sticker Commands:*\n\n_No sticker commands registered._\n\n` +
                              `• Use \`${settings.prefix}setcmd <command>\` while replying to a sticker to map it.\n` +
                              `• Use \`${settings.prefix}setcmd del\` while replying to a sticker to delete it.`
                    }, { quoted: msg });
                }
                const list = keys.map((key, i) => `${i + 1}. \`${settings.stickerCommands[key]}\` (Hash: ${key.slice(0, 10)}...)`).join('\n');
                return await sock.sendMessage(jid, { text: `🔮 *Limitless Sticker Commands List:*\n\n${list}` }, { quoted: msg });
            }

            if (!settings.stickerCommands) {
                settings.stickerCommands = {};
            }

            const action = args.trim();

            if (action.toLowerCase() === 'list') {
                const keys = Object.keys(settings.stickerCommands);
                if (keys.length === 0) {
                    return await sock.sendMessage(jid, { text: "🔮 *No sticker commands currently registered.*" }, { quoted: msg });
                }
                const list = keys.map((key, i) => `${i + 1}. \`${settings.stickerCommands[key]}\` (Hash: ${key.slice(0, 10)}...)`).join('\n');
                return await sock.sendMessage(jid, { text: `🔮 *Limitless Sticker Commands List:*\n\n${list}` }, { quoted: msg });
            }

            if (!isSticker) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a sticker with this command." }, { quoted: msg });
            }

            const fileHash = rawContent.stickerMessage.fileSha256?.toString('base64');
            if (!fileHash) {
                return await sock.sendMessage(jid, { text: "❌ Failed to read sticker file hash." }, { quoted: msg });
            }

            if (action.toLowerCase() === 'del' || action.toLowerCase() === 'delete' || action.toLowerCase() === 'remove') {
                if (!settings.stickerCommands[fileHash]) {
                    return await sock.sendMessage(jid, { text: "❌ This sticker does not have any assigned command." }, { quoted: msg });
                }
                const removedCmd = settings.stickerCommands[fileHash];
                delete settings.stickerCommands[fileHash];
                return await sock.sendMessage(jid, { text: `✅ Removed sticker command mapping for: \`${removedCmd}\`` }, { quoted: msg });
            }

            settings.stickerCommands[fileHash] = action;
            await sock.sendMessage(jid, { text: `✅ Successfully assigned command \`${action}\` to this sticker.` }, { quoted: msg });
        }
    },

    // 11. DEDICATED STICKER TRIGGER DELETER
    {
        name: 'delcmd',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) {
                return await sock.sendMessage(jid, { text: "❌ Access Denied." }, { quoted: msg });
            }

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted);
            const isSticker = rawContent?.stickerMessage;

            if (!isSticker) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to the sticker whose command you want to delete." }, { quoted: msg });
            }

            const fileHash = rawContent.stickerMessage.fileSha256?.toString('base64');
            if (!fileHash || !settings.stickerCommands?.[fileHash]) {
                return await sock.sendMessage(jid, { text: "❌ This sticker has no assigned command trigger." }, { quoted: msg });
            }

            const removedCmd = settings.stickerCommands[fileHash];
            delete settings.stickerCommands[fileHash];
            await sock.sendMessage(jid, { text: `✅ Successfully removed trigger mapping for: \`${removedCmd}\`` }, { quoted: msg });
        }
    },

    // 12. REGULAR TO VIEW ONCE CONVERTER
    {
        name: 'tovv',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);
            const isMedia = rawContent?.imageMessage || rawContent?.videoMessage;

            if (!isMedia) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to or attach an image or video." }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                await sock.sendMessage(jid, { text: "Encrypting into a fleeting glimpse... 👁️🔒" }, { quoted: msg });

                const mediaType = rawContent.imageMessage ? "image" : "video";
                const targetMessage = rawContent.imageMessage || rawContent.videoMessage;
                const mimeType = targetMessage.mimetype || (mediaType === "image" ? "image/jpeg" : "video/mp4");

                const stream = await downloadContentFromMessage(targetMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const payload = {
                    caption: args || targetMessage.caption || "",
                    viewOnce: true 
                };
                payload[mediaType] = buffer;
                payload.mimetype = mimeType;

                await sock.sendMessage(jid, payload, { quoted: msg });

            } catch (error) {
                console.error("ToVV Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to convert media to View Once." }, { quoted: msg });
            }
        }
    },

    // 13. MEDIA TO DIRECT WEB URL CONVERTER
    {
        name: 'tourl',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            
            const rawContent = getRawMessage(quoted || msg.message);
            
            let mediaMessage = null;
            let mediaType = "";

            if (rawContent?.imageMessage) { mediaMessage = rawContent.imageMessage; mediaType = "image"; }
            else if (rawContent?.videoMessage) { mediaMessage = rawContent.videoMessage; mediaType = "video"; }
            else if (rawContent?.stickerMessage) { mediaMessage = rawContent.stickerMessage; mediaType = "sticker"; }
            else if (rawContent?.audioMessage) { mediaMessage = rawContent.audioMessage; mediaType = "audio"; }
            else if (rawContent?.documentMessage) { mediaMessage = rawContent.documentMessage; mediaType = "document"; }

            if (!mediaMessage) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to or attach an image, video, sticker, audio, or document." }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                await sock.sendMessage(jid, { text: "Uploading to cloud storage... 🌐" }, { quoted: msg });

                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const mimeType = mediaMessage.mimetype || "application/octet-stream";

                const url = await uploadToCloud(buffer, mimeType);

                await sock.sendMessage(jid, {
                    text: `📦 *Limitless Cloud Link* 🌐\n\n` +
                          `• *Type:* \`${mediaType} (${mimeType.split('/')[1] || 'raw'})\`\n` +
                          `• *Direct URL:* ${url}`
                }, { quoted: msg });

            } catch (error) {
                console.error("ToURL Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to generate cloud link. Ensure your connection is stable." }, { quoted: msg });
            }
        }
    },

    // 14. PREFIXLESS SILENT KAMUI DM DECODER
    {
        name: 'kamui',
        isPrefixless: true,
        execute: async (sock, msg, args, { senderNumber }) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            
            if (!quoted) return; 
            
            const rawContent = getRawMessage(quoted);
            let mediaMessage = rawContent?.imageMessage || rawContent?.videoMessage;
            let mediaType = rawContent?.imageMessage ? "image" : (rawContent?.videoMessage ? "video" : "");
            
            if (!mediaMessage) return; 

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                await sock.sendMessage(jid, { react: { text: "🌀", key: msg.key } });

                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const targetDmJid = msg.key.participant || msg.key.remoteJid;
                
                if (mediaType === 'image') {
                    await sock.sendMessage(targetDmJid, { image: buffer, caption: "🌀 *Kamui:* Decoded View Once Image" });
                } else {
                    const mimeType = mediaMessage.mimetype || "video/mp4";
                    await sock.sendMessage(targetDmJid, { video: buffer, mimetype: mimeType, caption: "🌀 *Kamui:* Decoded View Once Video" });
                }

            } catch (e) {
                console.error("Kamui Error:", e.message);
            }
        }
    },

    // 15. BOT LATENCY COMPARISON TEST
    {
        name: 'ping2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const { delay } = await import('@itsliaaa/baileys');

            await sock.sendMessage(jid, { text: "Testing..." }, { quoted: msg });

            const loadingMsg = await sock.sendMessage(jid, { text: "▮▯▯▯▯▯▯" }, { quoted: msg });

            const frames = [];
            for (let i = 1; i <= 8; i++) {
                frames.push("▮".repeat(i) + "▯".repeat(8 - i));
            }

            for (const frame of frames) {
                await sock.sendMessage(jid, { text: frame, edit: loadingMsg.key });
                await delay(700); 
            }

            const msgTime = msg.messageTimestamp * 1000;
            const botSpeed = Date.now() - msgTime;

            await sock.sendMessage(jid, {
                text: `Latency: \`${botSpeed}ms\``,
                edit: loadingMsg.key
            });
        }
    },

    // 16. NOTES DASHBOARD & VIEWER (.notes)
    {
        name: 'notes',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            if (!isOwner && !isSudo && !isDev) return;

            const notes = readNotes();

            if (!args) {
                const count = Object.keys(notes).length;
                const prompt = `📝 *Notes Database Status:*\n\n` +
                               `• *Total Notes Saved:* \`${count}\`\n\n` +
                               `💡 _Reply to any message with \`${settings.prefix}addnote <name>\` to save a note._\n` +
                               `💡 _Use \`${settings.prefix}delnote <name>\` to remove a note._`;

                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}getnotes`, buttonText: { displayText: 'Get Notes List' }, type: 1 }
                    ],
                    headerType: 1
                };

                try {
                    return await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (e) {
                    return await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }
            }

            const targetKey = args.toLowerCase().trim();
            if (notes[targetKey]) {
                return await sock.sendMessage(jid, { text: notes[targetKey].content }, { quoted: msg });
            } else {
                return await sock.sendMessage(jid, { text: `❌ Note \`${args}\` does not exist in your database.` }, { quoted: msg });
            }
        }
    },

    // 17. ADD NOTE (.addnote <name>)
    {
        name: 'addnote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            if (!isOwner && !isSudo && !isDev) return;

            if (!args) {
                return await sock.sendMessage(jid, { text: `❌ Please provide a name for your note.\nExample: \`${settings.prefix}addnote rule1\`` }, { quoted: msg });
            }

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to the text message you want to save as a note." }, { quoted: msg });
            }

            const content = quoted.conversation || 
                            quoted.extendedTextMessage?.text || 
                            quoted.imageMessage?.caption || 
                            quoted.videoMessage?.caption || 
                            '';

            if (!content) {
                return await sock.sendMessage(jid, { text: "❌ Failed to extract readable text. Only text notes are supported." }, { quoted: msg });
            }

            const notes = readNotes();
            const noteKey = args.toLowerCase().trim();

            notes[noteKey] = {
                name: args.trim(),
                content: content,
                savedAt: Date.now()
            };

            saveNotes(notes);

            await sock.sendMessage(jid, { text: `✅ Successfully saved note: *${args.trim()}*` }, { quoted: msg });
        }
    },

    // 18. DELETE NOTE (.delnote <name>)
    {
        name: 'delnote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            if (!isOwner && !isSudo && !isDev) return;

            if (!args) {
                return await sock.sendMessage(jid, { text: `❌ Please provide the name of the note you want to delete.\nExample: \`${settings.prefix}delnote rule1\`` }, { quoted: msg });
            }

            const notes = readNotes();
            const noteKey = args.toLowerCase().trim();

            if (!notes[noteKey]) {
                return await sock.sendMessage(jid, { text: `❌ Note \`${args}\` not found in database.` }, { quoted: msg });
            }

            delete notes[noteKey];
            saveNotes(notes);

            await sock.sendMessage(jid, { text: `✅ Successfully deleted note: *${args.trim()}*` }, { quoted: msg });
        }
    },

    // 19. GET NOTES LIST (.getnotes)
    {
        name: 'getnotes',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            if (!isOwner && !isSudo && !isDev) return;

            const notes = readNotes();
            const keys = Object.keys(notes);

            if (keys.length === 0) {
                return await sock.sendMessage(jid, { text: "📝 No notes registered in your database." }, { quoted: msg });
            }

            let list = `📋 *ACTIVE NOTES DATABASE:*\n`;
            list += `━━━━━━━━━━━━━━━━━━━\n\n`;
            keys.forEach((key, idx) => {
                list += `${idx + 1}. *${notes[key].name}*\n`;
            });
            list += `\n*Total Notes:* ${keys.length}`;

            await sock.sendMessage(jid, { text: list }, { quoted: msg });
        }
    },

    // 20. GET NOTE SUB-COMMAND (.getnote <name>)
    {
        name: 'getnote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            if (!isOwner && !isSudo && !isDev) return;

            if (!args) {
                return await sock.sendMessage(jid, { text: `❌ Please provide the name of the note you want to retrieve.\nExample: \`${settings.prefix}getnote rule1\`` }, { quoted: msg });
            }

            const notes = readNotes();
            const targetKey = args.toLowerCase().trim();

            if (notes[targetKey]) {
                return await sock.sendMessage(jid, { text: notes[targetKey].content }, { quoted: msg });
            } else {
                return await sock.sendMessage(jid, { text: `❌ Note \`${args}\` not found in your database.` }, { quoted: msg });
            }
        }
    }
];

// Safely generate aliases using external collector
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'sticker') {
        aliases.push({ ...cmd, name: 's' });
    }
    if (cmd.name === 'take') {
        aliases.push({ ...cmd, name: 'steal' });
    }
    if (cmd.name === 'tourl') {
        aliases.push({ ...cmd, name: 'url' });
    }
    if (cmd.name === 'delete') {
        aliases.push({ ...cmd, name: 'del' });
    }
});
module.exports.push(...aliases);