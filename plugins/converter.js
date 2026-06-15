// plugins/converter.js
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

// Obfuscated backup Gemini API key configuration
const k1 = "AQ.A";
const k2 = "b8RN6KZl";
const k3 = "dboFt4nmErCs";
const k4 = "Rlvdo3tle5ZJa";
const k5 = "F6FdUBRk1x63EWYA";
const GEMINI_API_KEY_FALLBACK = k1 + k2 + k3 + k4 + k5;

// Helper to normalize JIDs
function normalizeToJid(input) {
    if (!input) return '';
    const clean = input.replace(/:[\d]+@/, '@');
    if (clean.endsWith('@s.whatsapp.net')) return clean;
    if (clean.endsWith('@lid')) return clean;
    const raw = clean.split('@')[0].replace(/[^0-9]/g, '');
    return raw ? `${raw}@s.whatsapp.net` : '';
}

// Google Gen AI SDK Text integration supporting gemini-3.5-flash with live search grounding
async function queryGeminiText(prompt, textContent, model = "gemini-3.5-flash") {
    try {
        const apiKey = settings.geminiApiKey || GEMINI_API_KEY_FALLBACK;
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey: apiKey });

        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: `${prompt}\n\nContent:\n"${textContent}"`,
                config: {
                    tools: [{ googleSearch: {} }] // Triggers Google Search Grounding for live currency/quantity rates
                }
            });
            return response.text || "";
        } catch (sdkErr) {
            const response = await ai.interactions.create({
                model: model,
                input: `${prompt}\n\nContent:\n"${textContent}"`
            });
            return response.text || response.output || "";
        }
    } catch (e) {
        console.error("Gemini text query failed:", e.message);
        throw e;
    }
}

// Recursive Helper to automatically unwrap envelopes
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

// Uploads a binary buffer to the public Catbox Uploader API
async function uploadToCatbox(buffer, mimeType) {
    let ext = mimeType.split('/')[1] || 'bin';
    ext = ext.split(';')[0].trim();
    const filename = `file_${Date.now()}.${ext}`;

    try {
        const form = new FormData();
        form.append('fileToUpload', buffer, { filename, contentType: mimeType });
        form.append('reqtype', 'fileupload');
        
        const response = await axios.post('https://apis.davidcyril.name.ng/uploader/catbox', form, {
            headers: { ...form.getHeaders() }
        });

        if (response.data && typeof response.data === 'string' && response.data.startsWith('http')) {
            return response.data.trim();
        }
        if (response.data?.url) {
            return response.data.url.trim();
        }
    } catch (err) {
        console.error("❌ [CATBOX UPLOAD] failed:", err.message);
    }
    throw new Error("Catbox upload failed.");
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
                const url = await uploadToCatbox(buffer, mimeType);

                await sock.sendMessage(jid, { text: `📦 *Limitless Direct URL* 🌐\n\nDirect Link: ${url}`, edit: statusMsg.key });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Upload failed: ${error.message}`, edit: statusMsg.key });
            }
        }
    },

    // 2. CONVERT VIDEO TO AUDIOS (.tomp3 / .toaudio)
    {
        name: 'tomp3',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);

            if (!rawContent?.videoMessage) return await sock.sendMessage(jid, { text: "❌ Please reply to a video message to convert it to audio." }, { quoted: msg });

            const statusMsg = await sock.sendMessage(jid, { text: "Converting video stream to audio... 🎧" }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(rawContent.videoMessage, 'video');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                // Upload to cloud to get a public URL for the conversion API
                const cloudUrl = await uploadToCatbox(buffer, rawContent.videoMessage.mimetype || 'video/mp4');

                const convertUrl = `https://apis.davidcyril.name.ng/convert/mp3?url=${encodeURIComponent(cloudUrl)}`;
                const response = await axios.get(convertUrl);
                
                if (response.data && response.data.status && response.data.result) {
                    await sock.sendMessage(jid, { audio: { url: response.data.result }, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                    try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) {}
                } else {
                    throw new Error("Conversion API returned invalid response");
                }
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
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);

            if (!rawContent?.stickerMessage) return await sock.sendMessage(jid, { text: "❌ Please reply to a sticker to convert to video." }, { quoted: msg });

            const statusMsg = await sock.sendMessage(jid, { text: "Processing WebP to MP4 conversion... 🎬" }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(rawContent.stickerMessage, 'sticker');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const tmpInput = path.join(__dirname, `../tmp_in_${Date.now()}.webp`);
                const tmpOutput = path.join(__dirname, `../tmp_out_${Date.now()}.mp4`);
                fs.writeFileSync(tmpInput, buffer);

                // Re-encode using ffmpeg command locally with standard WA compatible yuv420p pixel format
                const cmd = `ffmpeg -i "${tmpInput}" -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" "${tmpOutput}" -y`;
                exec(cmd, async (err) => {
                    if (err) {
                        await sock.sendMessage(jid, { text: "❌ FFMPEG conversion failed.", edit: statusMsg.key });
                    } else {
                        const videoBuffer = fs.readFileSync(tmpOutput);
                        await sock.sendMessage(jid, { video: videoBuffer, mimetype: "video/mp4", caption: "🎥 converted sticker successfully!" }, { quoted: msg });
                        try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) {}
                        try { fs.unlinkSync(tmpOutput); } catch (e) {}
                    }
                    try { fs.unlinkSync(tmpInput); } catch (e) {}
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
            if (!args) return await sock.sendMessage(jid, { text: "❌ Format: .currency <amount> <source> to <target> (e.g. .currency 1000 naira to pounds)" }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Calculating financial exchange rate... 💱" }, { quoted: msg });

                const prompt = `Perform a live Google Search to obtain the current real-time exchange rates. ` +
                               `Convert the given currency amount exactly. ` +
                               `Return the final calculation structured beautifully with country flags and exchange info.`;

                const responseText = await queryGeminiText(prompt, args);
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Currency conversion failed." }, { quoted: msg });
            }
        }
    },

    // 5. UNICODE FANCY FONT CONVERTER (.font)
    {
        name: 'font',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Format: .font <text>" }, { quoted: msg });

            const text = args.trim();
            
            // Native offline fast alphanumeric unicode fonts mapping
            const bubble = text.replace(/[a-zA-Z]/g, (char) => {
                const code = char.charCodeAt(0);
                if (code >= 65 && code <= 90) return String.fromCodePoint(code + 127233); // Uppercase bubble
                if (code >= 97 && code <= 122) return String.fromCodePoint(code + 127227); // Lowercase bubble
                return char;
            });

            const monospace = text.replace(/[a-zA-Z]/g, (char) => {
                const code = char.charCodeAt(0);
                if (code >= 65 && code <= 90) return String.fromCodePoint(code + 120172); 
                if (code >= 97 && code <= 122) return String.fromCodePoint(code + 120166); 
                return char;
            });

            const italic = text.replace(/[a-zA-Z]/g, (char) => {
                const code = char.charCodeAt(0);
                if (code >= 65 && code <= 90) return String.fromCodePoint(code + 120224); 
                if (code >= 97 && code <= 122) return String.fromCodePoint(code + 120218); 
                return char;
            });

            const fontCard = 
                `✨ *FANCY UNICODE FONTS:* ✨\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `• *Monospace:* \`${monospace}\`\n\n` +
                `• *Bubbles:* \`${bubble}\`\n\n` +
                `• *Italics:* \`${italic}\``;

            await sock.sendMessage(jid, { text: fontCard }, { quoted: msg });
        }
    },

    // 6. BINARY SYSTEM ENCODER AND DECODER (.binary)
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

    // 7. CONVERT STICKER TO IMAGES (.toimg)
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

    // 8. TEXT TO IMAGE WEB RENDERING (.ocr / .html2image)
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

    // 9. CONVERT TEXT TO QR CODES (.qr)
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

    // 10. DECODE AND READ QR CODES (.readqr)
    {
        name: 'readqr',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = getRawMessage(quoted || msg.message);

            if (!rawContent?.imageMessage) return await sock.sendMessage(jid, { text: "❌ Please reply to a QR Code image to scan." }, { quoted: msg });

            const statusMsg = await sock.sendMessage(jid, { text: "Decoding QR code... 👁️" }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(rawContent.imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const cloudUrl = await uploadToCatbox(buffer, 'image/jpeg');

                const scanUrl = `https://api.qrserver.com/v1/read-qr-code/?fileurl=${encodeURIComponent(cloudUrl)}`;
                const response = await axios.get(scanUrl);
                const data = response.data?.[0];

                if (data?.symbol?.[0]?.data) {
                    const decoded = data.symbol[0].data;
                    await sock.sendMessage(jid, { text: `📖 *QR Code Decoded Content:* \n\n\`${decoded}\``, edit: statusMsg.key });
                } else {
                    throw new Error("No QR code data found.");
                }
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to read or decode QR code.", edit: statusMsg.key });
            }
        }
    },

    // 11. QUANTITY MEASUREMENT UNIT CONVERTER (.quantity / .qty)
    {
        name: 'quantity',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Format: .qty <value> <unit> to <target> (e.g. .qty 10kg to grams)" }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Performing scientific quantity calculation... 📏" }, { quoted: msg });

                const prompt = `Perform a scientific measurement calculation to convert the given quantity value to target unit. ` +
                               `The input might contain obscure or standard metrics (e.g. kg, grams, pounds, ounces, km, miles). ` +
                               `Provide the output with a clear, beautiful card showing mathematical calculation.`;

                const responseText = await queryGeminiText(prompt, args);
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Quantity conversion failed." }, { quoted: msg });
            }
        }
    },

    // 12. STANDARD STICKER CONVERTER
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

                const sticker = new Sticker(buffer, { pack: settings.packName, author: settings.author, type: StickerTypes.FULL, quality: targetQuality });
                await sock.sendMessage(jid, { sticker: await sticker.toBuffer() }, { quoted: msg });
            } catch (error) {}
        }
    },

    // 13. CROPPED SQUARE STICKER (.crop)
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

                const sticker = new Sticker(buffer, { pack: settings.packName, author: settings.author, type: StickerTypes.CROPPED, quality: targetQuality });
                await sock.sendMessage(jid, { sticker: await sticker.toBuffer() }, { quoted: msg });
            } catch (error) {}
        }
    },

    // 14. METADATA STEALER (.take / .steal)
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

                const sticker = new Sticker(buffer, { pack: packName, author: publisher, type: StickerTypes.FULL, quality: 45 });
                await sock.sendMessage(jid, { sticker: await sticker.toBuffer() }, { quoted: msg });
            } catch (error) {}
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