// plugins/sticker.js
const config = require('../config');
const { saveState, normalizeToJid } = require('../stateManager');
const { setVar } = require('../vars');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');

// ─── HARDCODED CREDENTIALS ────────────────────────────────────────
const KLIPY_API_KEY = '7wvbG3l5iJ1h21e3beb2xebaZuglezPhnMIHiJ0ooZodo39pceCYOxTQtKGOYMw6';

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

const stickerCache = new Map();

function getCacheKey(buffer, type, pack, author) {
    const hash = require('crypto').createHash('md5').update(buffer).digest('hex');
    return `${hash}_${type}_${pack}_${author}`;
}

async function isVideoBuffer(buffer) {
    try {
        const metadata = await sharp(buffer).metadata();
        return metadata.pages && metadata.pages > 1;
    } catch {
        const header = buffer.slice(0, 12).toString('hex');
        return header.startsWith('1a45dfa3') || // webm
               header.startsWith('0000001c66747970') || // mp4
               header.startsWith('0000002066747970');
    }
}

async function convertViaApi(buffer, isCropped = false) {
    try {
        const form = new FormData();
        form.append('file', buffer, { filename: 'media', contentType: 'application/octet-stream' });
        form.append('crop', isCropped ? 'true' : 'false');
        form.append('pack', config.packName || 'Limitless');
        form.append('author', config.author || 'Gojo');

        const response = await axios.post('https://apis.davidcyril.name.ng/converter/sticker', form, {
            headers: { ...form.getHeaders() },
            timeout: 15000
        });

        if (response.data && response.data.success && response.data.sticker) {
            return Buffer.from(response.data.sticker, 'base64');
        }
        return null;
    } catch (err) {
        return null;
    }
}

async function convertLocal(buffer, isCropped = false, pack = config.packName, author = config.author) {
    const type = isCropped ? StickerTypes.CROPPED : StickerTypes.FULL;
    const isVideo = await isVideoBuffer(buffer);
    const quality = isVideo ? 25 : 40;

    const sticker = new Sticker(buffer, {
        pack: pack || 'Limitless',
        author: author || 'Gojo',
        type: type,
        quality: quality,
        ffmpegArgs: isVideo ? ['-preset', 'ultrafast', '-crf', '28'] : []
    });
    return await sticker.toBuffer();
}

async function handleSticker(sock, msg, args, isCropped = false) {
    const jid = msg.key.remoteJid;
    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
    const quoted = contextInfo?.quotedMessage;
    
    let mediaContent = getRawMessage(quoted || msg.message);
    let mediaMessage = mediaContent?.imageMessage || mediaContent?.videoMessage || mediaContent?.stickerMessage;
    let mediaType = mediaContent?.imageMessage ? "image" : (mediaContent?.videoMessage ? "video" : (mediaContent?.stickerMessage ? "sticker" : ""));

    if (!mediaMessage) {
        return await sock.sendMessage(jid, { text: "❌ Please reply to an image, video, or sticker to convert." }, { quoted: msg });
    }

    try {
        await sock.sendMessage(jid, { react: { text: "⏳", key: msg.key } });
        const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
        const stream = await downloadContentFromMessage(mediaMessage, mediaType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        const cacheKey = getCacheKey(buffer, isCropped ? 'crop' : 'sticker', config.packName, config.author);
        if (stickerCache.has(cacheKey)) {
            const cached = stickerCache.get(cacheKey);
            if (Date.now() - cached.timestamp < 300000) {
                await sock.sendMessage(jid, { sticker: cached.buffer }, { quoted: msg });
                await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });
                return;
            }
        }

        let stickerBuffer = await convertViaApi(buffer, isCropped);
        if (!stickerBuffer) {
            stickerBuffer = await convertLocal(buffer, isCropped);
        }

        stickerCache.set(cacheKey, { buffer: stickerBuffer, timestamp: Date.now() });

        await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });
        await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });

    } catch (error) {
        console.error("❌ [STICKER] Error:", error.message);
        await sock.sendMessage(jid, { text: `❌ Sticker creation failed: ${error.message}` }, { quoted: msg });
    }
}

// ─── SVG MEME OVERLAY GENERATOR ──────────────────────────────────
function generateMemeSvg(topText, bottomText) {
    const escapeXml = (str) => str.replace(/[&<>'"]/g, (c) => {
        switch (c) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case "'": return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });

    const topEscaped = escapeXml((topText || '').toUpperCase());
    const bottomEscaped = escapeXml((bottomText || '').toUpperCase());

    return Buffer.from(`
        <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
            <style>
                .meme-text {
                    font-family: 'Impact', 'Arial Black', sans-serif;
                    font-size: 50px;
                    font-weight: bold;
                    fill: white;
                    stroke: black;
                    stroke-width: 4px;
                    text-anchor: middle;
                    dominant-baseline: middle;
                }
            </style>
            ${topEscaped ? `<text x="256" y="55" class="meme-text">${topEscaped}</text>` : ''}
            ${bottomEscaped ? `<text x="256" y="455" class="meme-text">${bottomEscaped}</text>` : ''}
        </svg>
    `);
}

// ─── KLIPY PACK FETCHER (.sp / .sp2) ─────────────────────────────
async function klipySearch(query, { onlyAnimated = false, limit = 6 } = {}) {
    // Klipy's public endpoint is a drop-in swap for Tenor's v2 search API
    // (same query shape, just a different host). The old /v1/gifs/search
    // path with key+api_key both in the query string doesn't exist on
    // Klipy's servers, so every call was silently returning nothing.
    const url = `https://api.klipy.com/v2/search?q=${encodeURIComponent(query)}&key=${KLIPY_API_KEY}&limit=${limit}`;

    const { data } = await axios.get(url, { timeout: 15000 });

    const items = data?.results || data?.data?.data || data?.data || (Array.isArray(data) ? data : []);
    if (!items.length) {
        console.error(`⚠️ [SP/SP2] Klipy returned no items for "${query}". Raw response:`, JSON.stringify(data).slice(0, 500));
        return [];
    }

    return items.map(item => {
        return item?.media_formats?.gif?.url ||
               item?.media_formats?.tinygif?.url ||
               item?.media_formats?.mediumgif?.url ||
               item?.gif_url ||
               item?.media?.gif?.url ||
               item?.images?.original?.url ||
               item?.file?.url ||
               item?.url ||
               null;
    }).filter(Boolean);
}

async function buildPackFromQuery(sock, msg, args, { onlyAnimated }) {
    const jid = msg.key.remoteJid;
    const query = (args || '').trim();

    if (!query) {
        return await sock.sendMessage(jid, {
            text: `❌ *Usage:* \`${config.prefix}${onlyAnimated ? 'sp2' : 'sp'} <search term>\`\n*Example:* \`${config.prefix}${onlyAnimated ? 'sp2' : 'sp'} Goku\``
        }, { quoted: msg });
    }

    let gifUrls;
    try {
        gifUrls = await klipySearch(query, { onlyAnimated, limit: 6 });
    } catch (err) {
        return await sock.sendMessage(jid, { text: `❌ Klipy API Error: ${err.message}` }, { quoted: msg });
    }

    if (!gifUrls.length) {
        return await sock.sendMessage(jid, { text: `❌ No results found on Klipy for "${query}".` }, { quoted: msg });
    }

    await sock.sendMessage(jid, {
        text: `📦 *Building "${query}" pack via Klipy* — fetching ${gifUrls.length} sticker(s)...`
    }, { quoted: msg });

    let delivered = 0;
    for (const url of gifUrls) {
        try {
            const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
            const buffer = Buffer.from(res.data);

            const sticker = new Sticker(buffer, {
                pack: query,
                author: config.author || 'Limitless',
                type: StickerTypes.FULL,
                quality: 35,
                ffmpegArgs: ['-preset', 'ultrafast', '-crf', '28']
            });

            const stickerBuffer = await sticker.toBuffer();
            await sock.sendMessage(jid, { sticker: stickerBuffer });
            delivered++;
        } catch (err) {
            console.error(`⚠️ [SP/SP2] Failed to convert one result for "${query}":`, err.message);
        }
        await new Promise(resolve => setTimeout(resolve, 1200));
    }

    await sock.sendMessage(jid, {
        text: delivered > 0
            ? `✅ Delivered ${delivered}/${gifUrls.length} stickers for *"${query}"*.`
            : `❌ Couldn't convert any results for "${query}" into stickers.`
    }, { quoted: msg });
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 1. STICKER
    {
        name: 'sticker',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await handleSticker(sock, msg, args, false);
        }
    },

    // 2. CROP
    {
        name: 'crop',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await handleSticker(sock, msg, args, true);
        }
    },

    // 3. TAKE / STEAL
    {
        name: 'take',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted);

            if (!rawContent?.stickerMessage) {
                return await sock.sendMessage(jid, { text: "❌ Reply to a sticker to modify its pack name and author." }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(rawContent.stickerMessage, 'sticker');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const parts = args ? args.split('|') : [];
                const pack = parts[0] ? parts[0].trim() : config.packName;
                const author = parts[1] ? parts[1].trim() : config.author;

                let isAnimated = false;
                try {
                    const metadata = await sharp(buffer).metadata();
                    if (metadata.pages && metadata.pages > 1) isAnimated = true;
                } catch (e) { /* ignore */ }

                const sticker = new Sticker(buffer, {
                    pack: pack,
                    author: author,
                    type: StickerTypes.FULL,
                    quality: isAnimated ? 30 : 40
                });

                const stickerBuffer = await sticker.toBuffer();
                await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });
                await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 4. PACKNAME (Config Pack & Author)
    {
        name: 'packname',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            if (!args || !args.trim()) {
                return await sock.sendMessage(jid, { 
                    text: `❌ *Format:* \`${config.prefix}packname <pack_name>\` or \`${config.prefix}packname <pack_name> | <author>\`\n\n*Examples:*\n• \`${config.prefix}packname Isaac\`\n• \`${config.prefix}packname Isaac | Lord Isaac\`` 
                }, { quoted: msg });
            }

            let newPack = config.packName;
            let newAuthor = config.author;

            if (args.includes('|')) {
                const parts = args.split('|');
                newPack = parts[0].trim();
                newAuthor = parts[1].trim();
            } else {
                newPack = args.trim();
            }

            config.packName = newPack;
            config.author = newAuthor;

            try {
                setVar('packName', newPack);
                setVar('author', newAuthor);
                saveState();
            } catch (e) { /* ignore state save */ }

            await sock.sendMessage(jid, {
                text: `✅ *Sticker Pack Branding Updated!* \n\n• *Pack Name:* \`${newPack}\`\n• *Author:* \`${newAuthor}\``
            }, { quoted: msg });
        }
    },

    // 5. SMEME (Sticker Meme with Default Bottom Text)
    {
        name: 'smeme',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);

            const mediaMessage = rawContent?.imageMessage || rawContent?.stickerMessage;
            if (!mediaMessage) {
                return await sock.sendMessage(jid, { text: "❌ Reply to an image or static sticker to create a meme sticker." }, { quoted: msg });
            }

            if (!args || !args.trim()) {
                return await sock.sendMessage(jid, { text: `❌ *Usage:* Reply to media with \`${config.prefix}smeme <text>\` or \`${config.prefix}smeme top text | bottom text\`` }, { quoted: msg });
            }

            let topText = '';
            let bottomText = '';

            const input = args.trim();
            if (input.includes('|')) {
                const parts = input.split('|');
                topText = parts[0].trim();
                bottomText = parts[1].trim();
            } else if (input.toLowerCase().startsWith('top ')) {
                topText = input.slice(4).trim();
            } else if (input.toLowerCase().startsWith('bottom ')) {
                bottomText = input.slice(7).trim();
            } else {
                // DEFAULT IS BOTTOM TEXT
                bottomText = input;
            }

            await sock.sendMessage(jid, { react: { text: "⏳", key: msg.key } });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const mediaType = rawContent?.imageMessage ? 'image' : 'sticker';
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                // 1. Convert to 512x512 PNG using Sharp
                const baseImage = await sharp(buffer).resize(512, 512, { fit: 'cover' }).png().toBuffer();

                // 2. Generate and composite SVG Meme Text
                const svgOverlay = generateMemeSvg(topText, bottomText);
                const memedBuffer = await sharp(baseImage)
                    .composite([{ input: svgOverlay, top: 0, left: 0 }])
                    .png()
                    .toBuffer();

                // 3. Format into WhatsApp WebP Sticker
                const sticker = new Sticker(memedBuffer, {
                    pack: config.packName || 'Limitless',
                    author: config.author || 'Gojo',
                    type: StickerTypes.FULL,
                    quality: 50
                });

                const stickerBuffer = await sticker.toBuffer();
                await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });
                await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });

            } catch (error) {
                console.error("❌ [SMEME] Error:", error.message);
                await sock.sendMessage(jid, { text: `❌ Failed to create meme sticker: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 6. FIXPACK (Repair Broken Sticker Pack Messages)
    {
        name: 'fixpack',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            const rawQuoted = getRawMessage(quoted);

            const packMsg = rawQuoted?.stickerPackMessage || rawQuoted?.stickerPackMessageV2;

            if (!packMsg) {
                return await sock.sendMessage(jid, { text: "❌ Please reply directly to a broken WhatsApp Sticker Pack message." }, { quoted: msg });
            }

            try {
                const { generateWAMessageFromContent, proto } = await import('@itsliaaa/baileys');

                const statusMsg = await sock.sendMessage(jid, { text: "🔧 Repairing sticker pack CDN manifest..." }, { quoted: msg });

                // Construct fresh sticker pack message payload
                const repairedPayload = {
                    stickerPackMessage: {
                        name: packMsg.name || "Sticker Pack",
                        publisher: packMsg.publisher || config.author || "Limitless",
                        stickers: packMsg.stickers || []
                    }
                };

                const msgProto = generateWAMessageFromContent(jid, proto.Message.fromObject(repairedPayload), { userJid: sock.user.id });
                await sock.relayMessage(jid, msgProto.message, { messageId: msgProto.key.id });

                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) { /* ignore */ }

            } catch (err) {
                console.error("❌ [FIXPACK] Failed:", err.message);
                await sock.sendMessage(jid, { text: `❌ Failed to repair sticker pack: ${err.message}` }, { quoted: msg });
            }
        }
    },

    // 7. SP (Query-based pack from Klipy)
    {
        name: 'sp',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await buildPackFromQuery(sock, msg, args, { onlyAnimated: false });
        }
    },

    // 8. SP2 (Query-based pack from Klipy)
    {
        name: 'sp2',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await buildPackFromQuery(sock, msg, args, { onlyAnimated: true });
        }
    },

    // 9. UNPACK (Extract All Stickers 1-by-1 Every 2 Seconds)
    {
        name: 'unpack',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            const rawQuoted = getRawMessage(quoted);

            const packMsg = rawQuoted?.stickerPackMessage || rawQuoted?.stickerPackMessageV2;

            if (!packMsg || !packMsg.stickers || packMsg.stickers.length === 0) {
                return await sock.sendMessage(jid, { text: "❌ Please reply directly to a WhatsApp Sticker Pack message." }, { quoted: msg });
            }

            const stickers = packMsg.stickers;
            const total = stickers.length;

            const statusMsg = await sock.sendMessage(jid, { 
                text: `📦 *Unpacking Sticker Pack: "${packMsg.name || 'Pack'}"*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n• *Total Stickers:* \`${total}\`\n• *Delivery Interval:* \`1 sticker every 2s\`\n\nStarting delivery...` 
            }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');

                let delivered = 0;
                for (const stickerObj of stickers) {
                    try {
                        const stream = await downloadContentFromMessage(stickerObj, 'sticker');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                        if (buffer && buffer.length > 0) {
                            await sock.sendMessage(jid, { sticker: buffer });
                            delivered++;
                        }
                    } catch (stickerErr) {
                        console.error(`⚠️ [UNPACK] Sticker ${delivered + 1} download failed:`, stickerErr.message);
                    }

                    // Strict 2-second delay between dispatches
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

                await sock.sendMessage(jid, { 
                    text: `✅ *Unpacking Complete!* Successfully delivered \`${delivered}/${total}\` stickers from *"${packMsg.name || 'Pack'}"*.` 
                }, { quoted: msg });

            } catch (err) {
                console.error("❌ [UNPACK] Global failure:", err.message);
                await sock.sendMessage(jid, { text: `❌ Unpacking failed: ${err.message}` }, { quoted: msg });
            }
        }
    }
];

// ─── ALIASES ──────────────────────────────────────────────────────
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'sticker') aliases.push({ ...cmd, name: 's' });
    if (cmd.name === 'take') aliases.push({ ...cmd, name: 'steal' });
});
module.exports.push(...aliases);