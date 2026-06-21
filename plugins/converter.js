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
    } catch (err) {
        console.error("❌ [UPLOAD] qu.ax failed:", err.message);
    }

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

// ─── DOWNLOAD MEDIA HELPER (for API calls) ──────────────────────
async function downloadMedia(apiUrl, params = {}, method = 'GET') {
    try {
        const response = await axios({
            method,
            url: apiUrl,
            params: method === 'GET' ? params : undefined,
            data: method === 'POST' ? params : undefined,
            headers: { 'Content-Type': 'application/json' }
        });
        return response.data;
    } catch (err) {
        throw new Error(`API error: ${err.response?.status || err.message}`);
    }
}

// ─── LEGACY GEMINI HELPER (kept for other commands) ─────────────
async function queryGeminiText(prompt, textContent, model = "gemini-3.5-flash", useSearch = true) {
    const apiKey = config.geminiApiKey;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set in config or .env");

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });

    const configPayload = useSearch ? { tools: [{ googleSearch: {} }] } : {};

    try {
        const response = await ai.models.generateContent({
            model,
            contents: `${prompt}\n\nContent:\n"${textContent}"`,
            config: configPayload
        });
        return response.text || "";
    } catch (sdkErr) {
        // Fallback without search
        const response = await ai.models.generateContent({
            model,
            contents: `${prompt}\n\nContent:\n"${textContent}"`
        });
        return response.text || response.output || "";
    }
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 1. TOURL / URL (via new upload API)
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

            const statusMsg = await sock.sendMessage(jid, { text: "Uploading to cloud... 🌐" }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                // Use the new upload API
                const form = new FormData();
                const ext = mediaMessage.mimetype?.split('/')[1] || 'bin';
                const filename = `file_${Date.now()}.${ext}`;
                form.append('file', buffer, { filename, contentType: mediaMessage.mimetype });

                const response = await axios.post('https://apis.davidcyril.name.ng/uploader/catbox', form, {
                    headers: { ...form.getHeaders() }
                });

                if (!response.data || !response.data.success) throw new Error(response.data?.message || 'Upload failed');

                const url = response.data.url;
                await sock.sendMessage(jid, { text: `📦 *Direct Link*: ${url}`, edit: statusMsg.key });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Upload failed: ${error.message}`, edit: statusMsg.key });
            }
        }
    },

    // 2. TOMP3 (Video to audio via FFMPEG)
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

                const tmpInput = path.join(__dirname, '../storage/tmp_in_' + Date.now() + '.mp4');
                const tmpOutput = path.join(__dirname, '../storage/tmp_out_' + Date.now() + '.mp3');
                fs.writeFileSync(tmpInput, buffer);

                const cmd = `ffmpeg -i "${tmpInput}" -q:a 0 -map a "${tmpOutput}" -y`;
                exec(cmd, async (err) => {
                    if (err) {
                        await sock.sendMessage(jid, { text: "❌ FFMPEG audio conversion failed.", edit: statusMsg.key });
                    } else {
                        const audioBuffer = fs.readFileSync(tmpOutput);
                        await sock.sendMessage(jid, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                        try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) { /* ignore */ }
                        try { fs.unlinkSync(tmpOutput); } catch (e) { /* ignore */ }
                    }
                    try { fs.unlinkSync(tmpInput); } catch (e) { /* ignore */ }
                });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Audio conversion failed: ${error.message}`, edit: statusMsg.key });
            }
        }
    },

    // 3. TOMP4 (Animated sticker to video)
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

                const gifBuffer = await sharp(buffer, { animated: true }).gif().toBuffer();

                const tmpInput = path.join(__dirname, '../storage/tmp_in_' + Date.now() + '.gif');
                const tmpOutput = path.join(__dirname, '../storage/tmp_out_' + Date.now() + '.mp4');
                fs.writeFileSync(tmpInput, gifBuffer);

                const cmd = `ffmpeg -i "${tmpInput}" -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" -vcodec libx264 -preset fast -t 10 "${tmpOutput}" -y`;
                exec(cmd, async (err) => {
                    if (err) {
                        const fallbackCmd = `ffmpeg -i "${tmpInput}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -vcodec mpeg4 -t 10 "${tmpOutput}" -y`;
                        exec(fallbackCmd, async (fallbackErr) => {
                            if (fallbackErr) {
                                await sock.sendMessage(jid, { text: "❌ FFMPEG video conversion failed. Ensure sticker is animated and FFMPEG is installed on the host.", edit: statusMsg.key });
                            } else {
                                const videoBuffer = fs.readFileSync(tmpOutput);
                                await sock.sendMessage(jid, { video: videoBuffer, mimetype: "video/mp4", caption: "🎥 converted sticker successfully! (fallback)" }, { quoted: msg });
                                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) { /* ignore */ }
                            }
                            try { fs.unlinkSync(tmpInput); } catch (e) { /* ignore */ }
                            try { fs.unlinkSync(tmpOutput); } catch (e) { /* ignore */ }
                        });
                    } else {
                        const videoBuffer = fs.readFileSync(tmpOutput);
                        await sock.sendMessage(jid, { video: videoBuffer, mimetype: "video/mp4", caption: "🎥 converted sticker successfully!" }, { quoted: msg });
                        try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) { /* ignore */ }
                        try { fs.unlinkSync(tmpInput); } catch (e) { /* ignore */ }
                        try { fs.unlinkSync(tmpOutput); } catch (e) { /* ignore */ }
                    }
                });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Video conversion failed: ${error.message}`, edit: statusMsg.key });
            }
        }
    },

    // 4. CURRENCY (API-based)
    {
        name: 'currency',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Format: .currency <amount> <from> to <to>\nExample: .currency 100 USD to EUR" }, { quoted: msg });

            // Parse args: e.g., "100 USD to EUR" or "100usd to eur"
            const parts = args.trim().split(/\s+/);
            let amount, from, to;
            const toIndex = parts.indexOf('to');
            if (toIndex > 1) {
                amount = parseFloat(parts[0]);
                from = parts[1].toUpperCase();
                to = parts[toIndex + 1].toUpperCase();
            } else {
                // Fallback: try to parse with regex
                const match = args.match(/([\d.]+)\s*([A-Za-z]{3})\s*to\s*([A-Za-z]{3})/i);
                if (match) {
                    amount = parseFloat(match[1]);
                    from = match[2].toUpperCase();
                    to = match[3].toUpperCase();
                } else {
                    return await sock.sendMessage(jid, { text: "❌ Invalid format. Use: .currency <amount> <from> to <to>" }, { quoted: msg });
                }
            }

            if (isNaN(amount) || !from || !to) {
                return await sock.sendMessage(jid, { text: "❌ Invalid format. Use: .currency 100 USD to EUR" }, { quoted: msg });
            }

            await sock.sendMessage(jid, { text: `💱 Converting ${amount} ${from} to ${to}...` }, { quoted: msg });
            try {
                const data = await downloadMedia('https://apis.davidcyril.name.ng/tools/convert', { amount, from, to });
                if (!data || !data.success) throw new Error(data?.message || 'API error');
                await sock.sendMessage(jid, { text: data.result || 'Conversion failed' }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${err.message}` });
            }
        }
    },

    // 5. BINARY
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
                await sock.sendMessage(jid, { text: "❌ Binary translation failed. Ensure input is formatted correctly." }, { quoted: msg });
            }
        }
    },

    // 6. TOIMG (Sticker to image)
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

                const imageBuffer = await sharp(buffer).png().toBuffer();

                await sock.sendMessage(jid, { image: imageBuffer, caption: "📷 Converted sticker successfully!" }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to convert sticker to image." }, { quoted: msg });
            }
        }
    },

    // 7. OCR (Text to image rendering)
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
                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) { /* ignore */ }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to render text to image.", edit: statusMsg.key });
            }
        }
    },

    // 8. QR (Generate QR code)
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
                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) { /* ignore */ }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to generate QR code.", edit: statusMsg.key });
            }
        }
    },

    // 9. READQR (Decode QR from image)
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

    // 10. QUANTITY (unit conversion via Gemini Search)
    {
        name: 'quantity',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
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
                await sock.sendMessage(jid, { text: "❌ Quantity conversion failed." }, { quoted: msg });
            }
        }
    },

    // 11. STICKER (Standard sticker converter)
    {
        name: 'sticker',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            let mediaContent = getRawMessage(quoted || msg.message);

            let mediaMessage = mediaContent?.imageMessage || mediaContent?.videoMessage || mediaContent?.stickerMessage;
            let mediaType = mediaContent?.imageMessage ? "image" : (mediaContent?.videoMessage ? "video" : (mediaContent?.stickerMessage ? "sticker" : ""));

            if (!mediaMessage) return await sock.sendMessage(jid, { text: "❌ Please reply to an image or video to make sticker." }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const targetQuality = mediaType === "video" ? 35 : 45;

                const sticker = new Sticker(buffer, {
                    pack: config.packName,
                    author: config.author,
                    type: StickerTypes.FULL,
                    quality: targetQuality
                });
                await sock.sendMessage(jid, { sticker: await sticker.toBuffer() }, { quoted: msg });
            } catch (error) { /* ignore */ }
        }
    },

    // 12. CROP (Cropped square sticker)
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

                const targetQuality = mediaType === "video" ? 35 : 45;

                const sticker = new Sticker(buffer, {
                    pack: config.packName,
                    author: config.author,
                    type: StickerTypes.CROPPED,
                    quality: targetQuality
                });
                await sock.sendMessage(jid, { sticker: await sticker.toBuffer() }, { quoted: msg });
            } catch (error) { /* ignore */ }
        }
    },

    // 13. TAKE / STEAL (Metadata stealer)
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
                const packName = parts[0] ? parts[0].trim() : config.packName;
                const publisher = parts[1] ? parts[1].trim() : config.author;

                const sticker = new Sticker(buffer, {
                    pack: packName,
                    author: publisher,
                    type: StickerTypes.FULL,
                    quality: 45
                });
                await sock.sendMessage(jid, { sticker: await sticker.toBuffer() }, { quoted: msg });
            } catch (error) { /* ignore */ }
        }
    }
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