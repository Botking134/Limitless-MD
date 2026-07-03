// plugins/converter.js
const config = require('../config'); 
const settings = require('../settings'); 
const { saveSettings } = require('../helpers/settingsSaver'); 
const { saveState } = require('../stateManager'); 
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { exec } = require('child_process');
const sharp = require('sharp');

// Helper to normalize JIDs
function normalizeToJid(input) {
    if (!input) return '';
    const clean = input.replace(/:[\d]+@/, '@');
    if (clean.endsWith('@s.whatsapp.net')) return clean;
    if (clean.endsWith('@lid')) return clean;
    const raw = clean.split('@')[0].replace(/[^0-9]/g, '');
    return raw ? `${raw}@s.whatsapp.net` : '';
}

// Google Gen AI SDK Text integration supporting gemini-3.5-flash with live search grounding fallbacks
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
            // Attempt standard generation with search grounding first
            const response = await ai.models.generateContent({
                model: model,
                contents: `${prompt}\n\nContent:\n"${textContent}"`,
                config: configPayload
            });
            return response.text || "";
        } catch (sdkErr) {
            // Fallback 1: Silent retry without search grounding to prevent crashes
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

// Standardized JID Parser (Traverses nested elements cleanly)
function parseTarget(msg, args) {
    if (args) {
        const cleanDigits = args.replace(/[^0-9]/g, '');
        if (cleanDigits.length >= 7) {
            return `${cleanDigits}@s.whatsapp.net`;
        }
    }

    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo || 
                        rawMsg?.extendedTextMessage?.contextInfo || 
                        rawMsg?.imageMessage?.contextInfo || 
                        rawMsg?.videoMessage?.contextInfo || 
                        rawMsg?.stickerMessage?.contextInfo || 
                        rawMsg?.audioMessage?.contextInfo || 
                        rawMsg?.documentMessage?.contextInfo;
    const mentions = contextInfo?.mentionedJid || [];

    if (mentions.length > 0) {
        return mentions[0].split(':')[0] + (mentions[0].includes('@lid') ? '@lid' : '@s.whatsapp.net');
    } else if (contextInfo?.participant) {
        const part = contextInfo.participant;
        return part.split(':')[0] + (part.includes('@lid') ? '@lid' : '@s.whatsapp.net');
    }
    return '';
}

// Uploads a binary buffer to secure cloud hosts with auto-fallback to guarantee uptime
async function uploadToCloud(buffer, mimeType) {
    let ext = mimeType.split('/')[1] || 'bin';
    ext = ext.split(';')[0].trim();
    const filename = `file_${Date.now()}.${ext}`;

    // Host 1: qu.ax
    try {
        const form = new FormData();
        form.append('files[]', buffer, { filename, contentType: mimeType });
        const response = await axios.post('https://qu.ax/upload.php', form, {
            headers: { ...form.getHeaders() }
        });
        if (response.data?.success && response.data.files?.[0]?.url) {
            return response.data.files[0].url.trim();
        }
    } catch (err) {
        console.error("❌ [UPLOAD] qu.ax failed:", err.message);
    }

    // Host 2: catbox.moe
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
    } catch (err) {
        console.error("❌ [UPLOAD] catbox failed:", err.message);
    }

    throw new Error("Catbox and qu.ax upload hosts failed.");
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

// Helper to detect if buffer is a video (simple heuristic)
async function isVideoBuffer(buffer) {
    try {
        const metadata = await sharp(buffer).metadata();
        return metadata.pages && metadata.pages > 1;
    } catch {
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

module.exports = [
    // 1. CONVERT MEDIA TO DIRECT LINKS (.url / .tourl)
    {
        name: 'tourl',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);
            
            let mediaMessage = rawContent?.imageMessage || rawContent?.videoMessage || rawContent?.stickerMessage || rawContent?.audioMessage || rawContent?.documentMessage;
            let mediaType = rawContent?.imageMessage ? "image" : (rawContent?.videoMessage ? "video" : (rawContent?.stickerMessage ? "sticker" : (rawContent?.audioMessage ? "audio" : "document")));

            if (!mediaMessage) return await sock.sendMessage(jid, { text: "❌ Please reply to an image, video, audio, or sticker to generate a link." }, { quoted: msg });

            const statusMsg = await sock.sendMessage(jid, { text: "Uploading media to cloud... 🌐" }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const mimeType = mediaMessage.mimetype || "application/octet-stream";
                const url = await uploadToCloud(buffer, mimeType);

                await sock.sendMessage(jid, { text: `📦 *Limitless Direct URL* 🌐\n\nDirect Link: ${url}`, edit: statusMsg.key });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Upload failed: ${error.message}`, edit: statusMsg.key });
            }
        }
    },

    // 2. CONVERT VIDEO TO AUDIOS (.tomp3 / .toaudio - Local FFMPEG Engine)
    {
        name: 'tomp3',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);

            if (!rawContent?.videoMessage) return await sock.sendMessage(jid, { text: "❌ Please reply to a video message to convert it to audio." }, { quoted: msg });

            const statusMsg = await sock.sendMessage(jid, { text: "Converting video stream to audio locally... 🎧" }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(rawContent.videoMessage, 'video');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const tmpInput = path.join(__dirname, `../tmp_in_${Date.now()}.mp4`);
                const tmpOutput = path.join(__dirname, `../tmp_out_${Date.now()}.mp3`);
                fs.writeFileSync(tmpInput, buffer);

                // Run local re-encode conversion via FFMPEG for instant offline compilation
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

    // 3. CONVERT STICKERS/GIF TO VIDEOS (.tomp4 / .tovideo - WebP-to-GIF-to-MP4 Pipeline)
    {
        name: 'tomp4',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);

            if (!rawContent?.stickerMessage) return await sock.sendMessage(jid, { text: "❌ Please reply to an animated sticker to convert to video." }, { quoted: msg });

            const statusMsg = await sock.sendMessage(jid, { text: "Converting WebP frames... 🎬" }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(rawContent.stickerMessage, 'sticker');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                // Convert animated WebP buffer to animated GIF buffer using sharp to bypass ffmpeg's libwebp decode issues
                const gifBuffer = await sharp(buffer, { animated: true }).gif().toBuffer();

                const tmpInput = path.join(__dirname, `../tmp_in_${Date.now()}.gif`);
                const tmpOutput = path.join(__dirname, `../tmp_out_${Date.now()}.mp4`);
                fs.writeFileSync(tmpInput, gifBuffer);

                // Compile animated GIF back to MP4 natively via FFMPEG
                const cmd = `ffmpeg -i "${tmpInput}" -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" -vcodec libx264 -preset fast -t 10 "${tmpOutput}" -y`;
                exec(cmd, async (err) => {
                    if (err) {
                        // Fallback automatically to mpeg4 if libx264 is missing
                        const fallbackCmd = `ffmpeg -i "${tmpInput}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -vcodec mpeg4 -t 10 "${tmpOutput}" -y`;
                        exec(fallbackCmd, async (fallbackErr) => {
                            if (fallbackErr) {
                                await sock.sendMessage(jid, { text: "❌ FFMPEG video conversion failed. Ensure sticker is animated and FFMPEG is installed on the host.", edit: statusMsg.key });
                            } else {
                                const videoBuffer = fs.readFileSync(tmpOutput);
                                await sock.sendMessage(jid, { video: videoBuffer, mimetype: "video/mp4", caption: "🎥 converted sticker successfully! (fallback)" }, { quoted: msg });
                                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) {}
                            }
                            try { fs.unlinkSync(tmpInput); } catch (e) {}
                            try { fs.unlinkSync(tmpOutput); } catch (e) {}
                        });
                    } else {
                        const videoBuffer = fs.readFileSync(tmpOutput);
                        await sock.sendMessage(jid, { video: videoBuffer, mimetype: "video/mp4", caption: "🎥 converted sticker successfully!" }, { quoted: msg });
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

    // 4. REAL-TIME CURRENCY CONVERTER (.currency) - Fully Gemini-Grounded with config requirement
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

                const prompt = `You are a real-time financial converter. Perform a live Google Search to obtain the latest currency exchange rate for the following request: "${args}". ` +
                               `Convert the amount precisely. Output the result in a clean, professional, and visually engaging card with appropriate country flags, the official currency codes (e.g. NGN, GBP, USD), ` +
                               `the conversion formula, and a brief note about the live rate timestamp. Keep it highly organized. Do not add any conversational intro or filler.`;

                const responseText = await queryGeminiText(prompt, args, "gemini-3.5-flash", true);
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Currency conversion failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 5. BINARY SYSTEM ENCODER AND DECODER (.binary)
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
                    // Decode binary to standard ASCII text
                    const clean = input.replace(/\s+/g, '');
                    let text = '';
                    for (let i = 0; i < clean.length; i += 8) {
                        text += String.fromCharCode(parseInt(clean.substr(i, 8), 2));
                    }
                    await sock.sendMessage(jid, { text: `📖 *Decoded Binary:* \n\n\`${text}\`` }, { quoted: msg });
                } else {
                    // Encode standard text to binary string
                    let binary = '';
                    for (let i = 0; i < input.length; i++) {
                        const bin = input[i].charCodeAt(0).toString(2);
                        binary += bin.padStart(8, '0') + ' ';
                    }
                    await sock.sendMessage(jid, { text: `📟 *Encoded Binary:* \n\n\`${binary.trim()}\`` }, { quoted: msg });
                }
            } catch (err) {
                await sock.sendMessage(jid, { text: "❌ Binary translation failed. Ensure input is formatted correctly." }, { quoted: msg });
            }
        }
    },

    // 6. CONVERT STICKER TO IMAGES (.toimg)
    {
        name: 'toimg',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);

            if (!rawContent?.stickerMessage) return await sock.sendMessage(jid, { text: "❌ Please reply to a static sticker to convert to image." }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(rawContent.stickerMessage, 'sticker');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                // Convert standard static WebP sticker to standard PNG image buffer locally using sharp
                const imageBuffer = await sharp(buffer).png().toBuffer();

                await sock.sendMessage(jid, { image: imageBuffer, caption: "📷 Converted sticker successfully!" }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to convert sticker to image." }, { quoted: msg });
            }
        }
    },

    // 7. TEXT TO IMAGE WEB RENDERING (.ocr / .html2image)
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

    // 8. CONVERT TEXT TO QR CODES (.qr)
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

    // 9. DECODE AND READ QR CODES (.readqr - Direct Upload)
    {
        name: 'readqr',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);

            if (!rawContent?.imageMessage) return await sock.sendMessage(jid, { text: "❌ Please reply to a QR Code image to scan." }, { quoted: msg });

            const statusMsg = await sock.sendMessage(jid, { text: "Decoding QR code directly... 👁️" }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(rawContent.imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                // Create a multipart form to upload the buffer directly to the API
                const form = new FormData();
                form.append('file', buffer, { filename: 'qrcode.png', contentType: 'image/png' });

                const response = await axios.post('https://api.qrserver.com/v1/read-qr-code/', form, {
                    headers: { ...form.getHeaders() }
                });

                const decoded = response.data?.[0]?.symbol?.[0]?.data;

                if (decoded) {
                    await sock.sendMessage(jid, { text: `📖 *QR Code Decoded Content:* \n\n\`${decoded}\``, edit: statusMsg.key });
                } else {
                    throw new Error("Could not detect a valid QR code in the image.");
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Scan failed: ${error.message}`, edit: statusMsg.key });
            }
        }
    },

    // 10. QUANTITY MEASUREMENT UNIT CONVERTER (.quantity / .qty) - Fully Gemini-Grounded with config requirement
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
                await sock.sendMessage(jid, { text: "Performing scientific quantity calculation... 📏" }, { quoted: msg });

                const prompt = `You are a scientific unit converter. Convert the given quantity value to the requested target unit for: "${args}". ` +
                               `The input may contain standard, obscure, metric, or imperial measurements (e.g., kg to grams, stones to pounds, lightyears to meters, fahrenheit to celsius). ` +
                               `Perform the mathematical conversion with absolute precision using Google Search. Output the result in a beautifully organized card detailing the input quantity, target quantity, conversion formula, and a brief scientific note. ` +
                               `Do not include any conversational intro or filler.`;

                const responseText = await queryGeminiText(prompt, args, "gemini-3.5-flash", true);
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Quantity conversion failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 11. OPTIMIZED STICKER CONVERTER
    {
        name: 'sticker',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await handleSticker(sock, msg, args, false);
        }
    },

    // 12. OPTIMIZED CROPPED SQUARE STICKER (.crop)
    {
        name: 'crop',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            await handleSticker(sock, msg, args, true);
        }
    },

    // 13. METADATA STEALER (.take / .steal)
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
                    quality: isAnimated ? 30 : 40
                });

                const stickerBuffer = await sticker.toBuffer();
                await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });
                await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });
            } catch (error) {
                console.error("[TAKE] Error:", error);
                await sock.sendMessage(jid, { text: `❌ Failed: ${error.message}` }, { quoted: msg });
            }
        }
    }
];

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'sticker') aliases.push({ ...cmd, name: 's' });
    if (cmd.name === 'take') aliases.push({ ...cmd, name: 'steal' });
    if (cmd.name === 'tourl') aliases.push({ ...cmd, name: 'url' });
    if (cmd.name === 'quantity') aliases.push({ ...cmd, name: 'qty' });
});
module.exports.push(...aliases);