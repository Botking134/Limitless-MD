// plugins/utilities.js
const settings = require('../settings'); // Up one level to settings.js
const { Sticker, StickerTypes } = require('wa-sticker-formatter'); // Standard JJK/Kord sticker compiler
const fs = require('fs');
const path = require('path');

const notesPath = path.join(__dirname, '../notes.json');

// Global object to track active deletion timers if needed
if (!global.deleteTimers) global.deleteTimers = {};

// Helper function to format system uptime securely
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${Math.floor(s)}s`;
}

// Helper function to parse execution duration strings safely (e.g. 10s, 5m, 1h)
function parseDuration(durationStr) {
    if (!durationStr) return null;
    const match = durationStr.toLowerCase().match(/^(\d+)(s|m|h|d)$/);
    if (!match) return null;

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
        case 's': return { ms: value * 1000, label: `${value} second(s)` };
        case 'm': return { ms: value * 60 * 1000, label: `${value} minute(s)` };
        case 'h': return { ms: value * 60 * 60 * 1000, label: `${value} hour(s)` };
        case 'd': return { ms: value * 24 * 60 * 60 * 1000, label: `${value} day(s)` };
        default: return null;
    }
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

// Saves note entries securely
function saveNotes(notes) {
    try {
        fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2), 'utf-8');
    } catch (e) {
        console.error("❌ [NOTES] Failed to write notes database:", e.message);
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
    // 1. STANDARD INSTANT MESSAGE DELETION COMMAND
    {
        name: 'delete',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            
            // Validate basic context privileges
            if (!isOwner && !isSudo && !isDev) return;

            const quotedMsgContext = msg.message.extendedTextMessage?.contextInfo;
            if (!quotedMsgContext || !quotedMsgContext.stanzaId) {
                return await sock.sendMessage(jid, { text: "❌ *Context Error:* Please execute this command by directly replying to the target message you want to delete." }, { quoted: msg });
            }

            try {
                // Execute immediate protocol deletion envelope
                await sock.sendMessage(jid, {
                    delete: {
                        remoteJid: jid,
                        fromMe: quotedMsgContext.participant === (sock.user.id.split(':')[0] + '@s.whatsapp.net'),
                        id: quotedMsgContext.stanzaId,
                        participant: quotedMsgContext.participant
                    }
                });
            } catch (err) {
                console.error("Instant deletion failed:", err.message);
                await sock.sendMessage(jid, { text: `❌ *System Error:* Failed to retract message: ${err.message}` }, { quoted: msg });
            }
        }
    },

    // 2. TIMED DELETION COMMAND (.tdelete <duration>)
    {
        name: 'tdelete',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const quotedMsgContext = msg.message.extendedTextMessage?.contextInfo;
            if (!quotedMsgContext || !quotedMsgContext.stanzaId) {
                return await sock.sendMessage(jid, { text: "❌ *Context Error:* Please reply to the target message you wish to schedule for deletion." }, { quoted: msg });
            }

            const durationInput = args.trim();
            if (!durationInput) {
                return await sock.sendMessage(jid, { text: `⚠️ *Missing Duration:* Please supply a timeline factor.\nExample: \`${settings.prefix}tdelete 10s\` or \`${settings.prefix}tdel 5m\`` }, { quoted: msg });
            }

            const timing = parseDuration(durationInput);
            if (!timing) {
                return await sock.sendMessage(jid, { text: "⚠️ *Invalid Format:* Please specify a valid duration parameter (e.g., \`s\` for seconds, \`m\` for minutes)." }, { quoted: msg });
            }

            await sock.sendMessage(jid, { text: `⏳ *Deletion Scheduled:* Target message will be self-destructed in *${timing.label}*.` }, { quoted: msg });

            setTimeout(async () => {
                try {
                    await sock.sendMessage(jid, {
                        delete: {
                            remoteJid: jid,
                            fromMe: quotedMsgContext.participant === (sock.user.id.split(':')[0] + '@s.whatsapp.net'),
                            id: quotedMsgContext.stanzaId,
                            participant: quotedMsgContext.participant
                        }
                    });
                } catch (err) {
                    console.error("Timed task execution fallback failure:", err.message);
                }
            }, timing.ms);
        }
    },

    // 3. STICKER CREATION ENGINE
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

    // 4. METADATA STEALER / CUSTOMIZER
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

    // 5. VIEW NOTE SUB-COMMAND (.notes)
    {
        name: 'notes',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const notes = readNotes();
            const keys = Object.keys(notes);

            if (keys.length === 0) {
                return await sock.sendMessage(jid, { text: "📝 Your notebook database is currently empty." }, { quoted: msg });
            }

            let list = `📝 *ACTIVE SYSTEM LOG NOTES* 📝\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            keys.forEach((k, idx) => {
                list += `🔹 *${idx + 1}. ${k}* \n   _Created by: @${notes[k].author.split('@')[0]}_\n\n`;
            });

            await sock.sendMessage(jid, { text: list }, { quoted: msg });
        }
    },

    // 6. GET NOTE SUB-COMMAND (.getnote <name>)
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

// Safely generate aliases using an external collector array [3]
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'sticker') {
        aliases.push({ ...cmd, name: 's' });
        aliases.push({ ...cmd, name: 'crop' });
    }
    if (cmd.name === 'take') {
        aliases.push({ ...cmd, name: 'steal' });
    }
    if (cmd.name === 'delete') {
        aliases.push({ ...cmd, name: 'del' });
    }
    if (cmd.name === 'tdelete') {
        aliases.push({ ...cmd, name: 'tdel' });
    }
});
module.exports.push(...aliases);