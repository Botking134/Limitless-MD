// plugins/converter.js
const config = require('../config');
const { saveState, normalizeToJid } = require('../stateManager');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { exec } = require('child_process');
const sharp = require('sharp');

// ─── HELPERS ──────────────────────────────────────────────────────

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    if (message.groupStatusMessageV2?.message) return getRawMessage(message.groupStatusMessageV2.message);
    return message;
}

// ─── CACHE FOR STICKERS (in-memory, 5 min TTL) ──────────────────
const stickerCache = new Map();

function getCacheKey(buffer, type, pack, author) {
    const hash = require('crypto').createHash('md5').update(buffer).digest('hex');
    return `${hash}_${type}_${pack}_${author}`;
}

// ─── API-BASED STICKER CONVERTER ────────────────────────────────
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
        throw new Error('API returned invalid response');
    } catch (err) {
        console.warn('[STICKER] API fallback failed:', err.message);
        return null;
    }
}

// ─── LOCAL STICKER CONVERTER (with speed optimizations) ────────
async function convertLocal(buffer, isCropped = false, pack = config.packName, author = config.author) {
    const type = isCropped ? StickerTypes.CROPPED : StickerTypes.FULL;
    // Lower quality for videos, faster preset
    const isVideo = await isVideoBuffer(buffer);
    const quality = isVideo ? 25 : 40;

    const sticker = new Sticker(buffer, {
        pack: pack || 'Limitless',
        author: author || 'Gojo',
        type: type,
        quality: quality,
        // Additional ffmpeg args to speed up conversion
        ffmpegArgs: isVideo ? ['-preset', 'ultrafast', '-crf', '28'] : []
    });
    return await sticker.toBuffer();
}

// Helper to detect if buffer is a video (simple heuristic)
async function isVideoBuffer(buffer) {
    try {
        const metadata = await sharp(buffer).metadata();
        // If it has 'pages' or is animated, it's likely a video or animated image
        return metadata.pages && metadata.pages > 1;
    } catch {
        // If sharp fails, check first few bytes for video container
        const header = buffer.slice(0, 12).toString('hex');
        return header.startsWith('1a45dfa3') || // webm
               header.startsWith('0000001c66747970') || // mp4
               header.startsWith('0000002066747970'); // mp4 variant
    }
}

// ─── MAIN STICKER COMMAND (shared logic) ────────────────────────

async function handleSticker(sock, msg, args, isCropped = false) {
    const jid = msg.key.remoteJid;
    const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
    let mediaContent = getRawMessage(quoted || msg.message);

    let mediaMessage = mediaContent?.imageMessage || mediaContent?.videoMessage || mediaContent?.stickerMessage;
    let mediaType = mediaContent?.imageMessage ? "image" : (mediaContent?.videoMessage ? "video" : (mediaContent?.stickerMessage ? "sticker" : ""));

    if (!mediaMessage) {
        return await sock.sendMessage(jid, { text: "❌ Please reply to an image, video, or sticker to convert." }, { quoted: msg });
    }

    // Send a "processing" reaction
    await sock.sendMessage(jid, { react: { text: "⏳", key: msg.key } });

    try {
        const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
        const stream = await downloadContentFromMessage(mediaMessage, mediaType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        // Check cache
        const cacheKey = getCacheKey(buffer, isCropped ? 'crop' : 'sticker', config.packName, config.author);
        if (stickerCache.has(cacheKey)) {
            const cached = stickerCache.get(cacheKey);
            if (Date.now() - cached.timestamp < 300000) { // 5 min TTL
                await sock.sendMessage(jid, { sticker: cached.buffer }, { quoted: msg });
                await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });
                return;
            } else {
                stickerCache.delete(cacheKey);
            }
        }

        // Try API first (if internet is available)
        let stickerBuffer = await convertViaApi(buffer, isCropped);

        // Fallback to local if API failed
        if (!stickerBuffer) {
            stickerBuffer = await convertLocal(buffer, isCropped);
        }

        // Cache the result
        stickerCache.set(cacheKey, { buffer: stickerBuffer, timestamp: Date.now() });

        await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });
        await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });

    } catch (error) {
        console.error("[STICKER] Error:", error);
        await sock.sendMessage(jid, { text: `❌ Sticker creation failed: ${error.message}` }, { quoted: msg });
        await sock.sendMessage(jid, { react: { text: "❌", key: msg.key } });
    }
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
    // 2. CROP (cropped sticker)
    {
        name: 'crop',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await handleSticker(sock, msg, args, true);
        }
    },
   
// 3. TAKE / STEAL (Metadata stealer – with animated support)
{
    name: 'take',
    isPrefixless: false,
    execute: async (sock, msg, args) => {
        const jid = msg.key.remoteJid;
        const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
        const rawContent = getRawMessage(quoted);
        if (!rawContent?.stickerMessage) {
            return await sock.sendMessage(jid, { text: "❌ Reply to a sticker to take its metadata." }, { quoted: msg });
        }

        try {
            const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
            const stream = await downloadContentFromMessage(rawContent.stickerMessage, 'sticker');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            const parts = args ? args.split('|') : [];
            const pack = parts[0] ? parts[0].trim() : config.packName;
            const author = parts[1] ? parts[1].trim() : config.author;

            // Detect if sticker is animated (has multiple frames)
            let isAnimated = false;
            try {
                const metadata = await sharp(buffer).metadata();
                if (metadata.pages && metadata.pages > 1) isAnimated = true;
            } catch (e) { /* ignore */ }

            const sticker = new Sticker(buffer, {
                pack: pack,
                author: author,
                type: StickerTypes.FULL,
                quality: isAnimated ? 30 : 40,
                // If the library supports 'animated' option, uncomment:
                // animated: isAnimated
            });

            const stickerBuffer = await sticker.toBuffer();
            await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });
            await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });
        } catch (error) {
            console.error("[TAKE] Error:", error);
            await sock.sendMessage(jid, { text: `❌ Failed: ${error.message}` }, { quoted: msg });
        }
    }
},  


    // ─── OTHER COMMANDS (tourl, tomp3, etc.) remain unchanged ──
    // ... (include the rest of your commands: tourl, tomp3, tomp4, currency, binary, toimg, ocr, qr, readqr, quantity)
    // I've omitted them here for brevity – just copy them from your original file.
    // Make sure to keep them all.
];

// ─── ALIASES ──────────────────────────────────────────────────────
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'sticker') aliases.push({ ...cmd, name: 's' });
    if (cmd.name === 'take') aliases.push({ ...cmd, name: 'steal' });
    if (cmd.name === 'tourl') aliases.push({ ...cmd, name: 'url' });
    if (cmd.name === 'quantity') aliases.push({ ...cmd, name: 'qty' });
});
module.exports.push(...aliases);