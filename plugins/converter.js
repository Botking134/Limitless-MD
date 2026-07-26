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

// ─── CATBOX PRIMARY UPLOAD HELPER ─────────────────────────────────
async function uploadToCatbox(buffer, mimeType) {
    let ext = mimeType.split('/')[1] || 'bin';
    ext = ext.split(';')[0].trim();
    if (ext === 'jpeg') ext = 'jpg';
    const filename = `file_${Date.now()}.${ext}`;

    // Host 1: Catbox.moe (PRIMARY)
    try {
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', buffer, { filename, contentType: mimeType });

        const response = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: { ...form.getHeaders() },
            timeout: 30000
        });

        if (response.data && typeof response.data === 'string' && response.data.trim().startsWith('http')) {
            return response.data.trim();
        }
    } catch (err) {
        console.error("⚠️ [CATBOX PRIMARY FAILED, TRYING QU.AX FALLBACK]:", err.message);
    }

    // Host 2: qu.ax (SECONDARY FALLBACK)
    try {
        const form = new FormData();
        form.append('files[]', buffer, { filename, contentType: mimeType });
        const response = await axios.post('https://qu.ax/upload.php', form, {
            headers: { ...form.getHeaders() },
            timeout: 30000
        });
        if (response.data?.success && response.data.files?.[0]?.url) {
            return response.data.files[0].url.trim();
        }
    } catch (err) { /* ignore */ }

    throw new Error("Catbox upload failed.");
}

// Google Gen AI SDK Text integration supporting gemini-3.5-flash with live search grounding
async function queryGeminiText(prompt, textContent, model = "gemini-3.5-flash", useSearch = true) {
    try {
        const apiKey = config.geminiApiKey;
        if (!apiKey) {
            throw new Error("Gemini API key is missing in config.");
        }
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey: apiKey });

        const configPayload = useSearch ? { tools: [{ googleSearch: {} }] } : {};

        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: `${prompt}\n\nContent:\n"${textContent}"`,
                config: configPayload
            });
            return response.text || "";
        } catch (sdkErr) {
            const response = await ai.models.generateContent({
                model: model,
                contents: `${prompt}\n\nContent:\n"${textContent}"`
            });
            return response.text || response.output || "";
        }
    } catch (e) {
        console.error("Gemini text query failed:", e.message);
        throw e;
    }
}

// ─── CACHE FOR STICKERS (in-memory, 5 min TTL) ──────────────────
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
        return header.startsWith('1a45dfa3') || 
               header.startsWith('0000001c66747970') || 
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

    await sock.sendMessage(jid, { react: { text: "⏳", key: msg.key } });

    try {
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
            } else {
                stickerCache.delete(cacheKey);
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
        console.error("[STICKER] Error:", error.message);
        await sock.sendMessage(jid, { text: `❌ Sticker creation failed: ${error.message}` }, { quoted: msg });
    }
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 1. CONVERT MEDIA TO DIRECT CATBOX URL (.url / .tourl)
    {
        name: 'tourl',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);
            
            let mediaMessage = rawContent?.imageMessage || 
                               rawContent?.videoMessage || 
                               rawContent?.stickerMessage || 
                               rawContent?.audioMessage || 
                               rawContent?.documentMessage;
            
            let mediaType = rawContent?.imageMessage ? "image" : 
                           (rawContent?.videoMessage ? "video" : 
                           (rawContent?.stickerMessage ? "sticker" : 
                           (rawContent?.audioMessage ? "audio" : "document")));

            if (!mediaMessage) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to an image, video, audio, sticker, or document." }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const mimeType = mediaMessage.mimetype || (mediaType === 'sticker' ? 'image/webp' : 'application/octet-stream');
                const url = await uploadToCatbox(buffer, mimeType);

                // Returns strictly the direct Catbox link
                await sock.sendMessage(jid, { text: url }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Upload failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    {
        name: 'url',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const cmd = module.exports.find(c => c.name === 'tourl');
            if (cmd) await cmd.execute(sock, msg, args);
        }
    },

    // 2. CONVERT VIDEO TO AUDIOS (.tomp3 / .toaudio)
    {
        name: 'tomp3',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);

            if (!rawContent?.videoMessage) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a video message to convert it to audio." }, { quoted: msg });
            }

            const statusMsg = await sock.sendMessage(jid, { text: "Converting video stream to audio... 🎧" }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(rawContent.videoMessage, 'video');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const tmpInput = path.join(__dirname, `../tmp_in_${Date.now()}.mp4`);
                const tmpOutput = path.join(__dirname, `../tmp_out_${Date.now()}.mp3`);
                fs.writeFileSync(tmpInput, buffer);

                const cmd = `ffmpeg -i "${tmpInput}" -q:a 0 -map a "${tmpOutput}" -y`;
                exec(cmd, async (err) => {
                    if (err) {
                        await sock.sendMessage(jid, { text: "❌ FFMPEG audio conversion failed.", edit: statusMsg.key });
                    } else {
                        const audioBuffer = fs.readFileSync(tmpOutput);
                        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                        try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) {}
                        try { fs.unlinkSync(tmpOutput); } catch (e) {}
                    }
                    try { fs.unlinkSync(tmpInput); } catch (e) {}
                });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Audio conversion failed: ${error.message}`, edit: statusMsg.key });
            }
        }
    },

    // 3. CONVERT STICKERS/GIF TO VIDEOS (.tomp4 / .tovideo)
    {
        name: 'tomp4',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);

            if (!rawContent?.stickerMessage) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to an animated sticker to convert to video." }, { quoted: msg });
            }

            const statusMsg = await sock.sendMessage(jid, { text: "Converting WebP frames... 🎬" }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(rawContent.stickerMessage, 'sticker');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const gifBuffer = await sharp(buffer, { animated: true }).gif().toBuffer();

                const tmpInput = path.join(__dirname, `../tmp_in_${Date.now()}.gif`);
                const tmpOutput = path.join(__dirname, `../tmp_out_${Date.now()}.mp4`);
                fs.writeFileSync(tmpInput, gifBuffer);

                const cmd = `ffmpeg -i "${tmpInput}" -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" -vcodec libx264 -preset fast -t 10 "${tmpOutput}" -y`;
                exec(cmd, async (err) => {
                    if (err) {
                        const fallbackCmd = `ffmpeg -i "${tmpInput}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -vcodec mpeg4 -t 10 "${tmpOutput}" -y`;
                        exec(fallbackCmd, async (fallbackErr) => {
                            if (fallbackErr) {
                                await sock.sendMessage(jid, { text: "❌ FFMPEG video conversion failed.", edit: statusMsg.key });
                            } else {
                                const videoBuffer = fs.readFileSync(tmpOutput);
                                await sock.sendMessage(jid, { video: videoBuffer, mimetype: "video/mp4", caption: "🎥 Converted sticker successfully!" }, { quoted: msg });
                                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) {}
                            }
                            try { fs.unlinkSync(tmpInput); } catch (e) {}
                            try { fs.unlinkSync(tmpOutput); } catch (e) {}
                        });
                    } else {
                        const videoBuffer = fs.readFileSync(tmpOutput);
                        await sock.sendMessage(jid, { video: videoBuffer, mimetype: "video/mp4", caption: "🎥 Converted sticker successfully!" }, { quoted: msg });
                        try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) {}
                        try { fs.unlinkSync(tmpInput); } catch (e) {}
                        try { fs.unlinkSync(tmpOutput); } catch (e) {}
                    }
                });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Video conversion failed: ${error.message}`, edit: statusMsg.key });
            }
        }
    },

    // 4. REAL-TIME CURRENCY CONVERTER (.currency)
    {
        name: 'currency',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!config.geminiApiKey) {
                return await sock.sendMessage(jid, { text: "❌ Gemini API key is missing in your configuration." }, { quoted: msg });
            }
            if (!args) return await sock.sendMessage(jid, { text: "❌ Format: .currency <amount> <source> to <target> (e.g. .currency 1000 naira to pounds)" }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Calculating financial exchange rate... 💱" }, { quoted: msg });

                const prompt = `You are a real-time financial converter. Perform a live Google Search to obtain the latest currency exchange rate for: "${args}". ` +
                               `Convert the amount precisely. Output the result in a clean card with flags, currency codes (NGN, GBP, USD), ` +
                               `conversion formula, and live timestamp. Do not add conversational intro.`;

                const responseText = await queryGeminiText(prompt, args, "gemini-3.5-flash", true);
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Currency conversion failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 5. BINARY ENCODER / DECODER (.binary)
    {
        name: 'binary',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Format: .binary <text_to_encode> OR <binary_to_decode>" }, { quoted: msg });

            const input = args.trim();
            const isBinaryPattern = /^[01\s]+$/.test(input);

            try {
                if (isBinaryPattern) {
                    const clean = input.replace(/\s+/g, '');
                    let text = '';
                    for (let i = 0; i < clean.length; i += 8) {
                        text += String.fromCharCode(parseInt(clean.substr(i, 8), 2));
                    }
                    await sock.sendMessage(jid, { text: `📖 *Decoded Binary:* \n\n\`${text}\`` }, { quoted: msg });
                } else {
                    let binary = '';
                    for (let i = 0; i < input.length; i++) {
                        const bin = input[i].charCodeAt(0).toString(2);
                        binary += bin.padStart(8, '0') + ' ';
                    }
                    await sock.sendMessage(jid, { text: `📟 *Encoded Binary:* \n\n\`${binary.trim()}\`` }, { quoted: msg });
                }
            } catch (err) {
                await sock.sendMessage(jid, { text: "❌ Binary translation failed." }, { quoted: msg });
            }
        }
    },

    // 6. CONVERT STICKER TO IMAGES (.toimg)
    {
        name: 'toimg',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);

            if (!rawContent?.stickerMessage) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a static sticker to convert to image." }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(rawContent.stickerMessage, 'sticker');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const imageBuffer = await sharp(buffer).png().toBuffer();
                await sock.sendMessage(jid, { image: imageBuffer, caption: "📷 Converted sticker successfully!" }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to convert sticker to image." }, { quoted: msg });
            }
        }
    },

    // 7. TEXT TO IMAGE RENDERING (.ocr)
    {
        name: 'ocr',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Format: .ocr <text_to_render>" }, { quoted: msg });

            const statusMsg = await sock.sendMessage(jid, { text: "Generating text image... 🖼️" }, { quoted: msg });

            try {
                const apiLink = `https://apis.davidcyril.name.ng/converter/html2image?text=${encodeURIComponent(args)}`;
                await sock.sendMessage(jid, { image: { url: apiLink }, caption: `🖼️ *Rendered:* "${args}"` }, { quoted: msg });
                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) {}
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to render text to image.", edit: statusMsg.key });
            }
        }
    },

    // 8. TEXT TO QR CODE (.qr)
    {
        name: 'qr',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Format: .qr <text_to_embed>" }, { quoted: msg });

            const statusMsg = await sock.sendMessage(jid, { text: "Generating QR code... 🏁" }, { quoted: msg });

            try {
                const qrUrl = `https://apis.davidcyril.name.ng/tools/qrcode?text=${encodeURIComponent(args)}`;
                await sock.sendMessage(jid, { image: { url: qrUrl }, caption: `✅ *QR Code generated successfully!*` }, { quoted: msg });
                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) {}
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to generate QR code.", edit: statusMsg.key });
            }
        }
    },

    // 9. READ QR CODE (.readqr)
    {
        name: 'readqr',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || rawMsg?.extendedTextMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);

            if (!rawContent?.imageMessage) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a QR Code image to scan." }, { quoted: msg });
            }

            const statusMsg = await sock.sendMessage(jid, { text: "Decoding QR code... 👁️" }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(rawContent.imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const form = new FormData();
                form.append('file', buffer, { filename: 'qrcode.png', contentType: 'image/png' });

                const response = await axios.post('https://api.qrserver.com/v1/read-qr-code/', form, {
                    headers: { ...form.getHeaders() }
                });

                const decoded = response.data?.[0]?.symbol?.[0]?.data;

                if (decoded) {
                    await sock.sendMessage(jid, { text: `📖 *QR Code Content:* \n\n\`${decoded}\``, edit: statusMsg.key });
                } else {
                    throw new Error("Could not detect a valid QR code.");
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Scan failed: ${error.message}`, edit: statusMsg.key });
            }
        }
    },

    // 10. QUANTITY CONVERTER (.quantity / .qty)
    {
        name: 'quantity',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!config.geminiApiKey) {
                return await sock.sendMessage(jid, { text: "❌ Gemini API key is missing in your configuration." }, { quoted: msg });
            }
            if (!args) return await sock.sendMessage(jid, { text: "❌ Format: .qty <value> <unit> to <target> (e.g. .qty 10kg to grams)" }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Performing quantity calculation... 📏" }, { quoted: msg });

                const prompt = `You are a scientific unit converter. Convert the given quantity value for: "${args}". ` +
                               `Perform the mathematical conversion with absolute precision using Google Search. Output the result in a clean card.`;

                const responseText = await queryGeminiText(prompt, args, "gemini-3.5-flash", true);
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Quantity conversion failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 11. STICKER
    {
        name: 'sticker',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await handleSticker(sock, msg, args, false);
        }
    },

    // 12. CROP STICKER
    {
        name: 'crop',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await handleSticker(sock, msg, args, true);
        }
    }
];

// ─── ALIASES ──────────────────────────────────────────────────────
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'sticker') aliases.push({ ...cmd, name: 's' });
    if (cmd.name === 'quantity') aliases.push({ ...cmd, name: 'qty' });
});
module.exports.push(...aliases);