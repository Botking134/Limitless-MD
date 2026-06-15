// plugins/tools.js
const settings = require('../settings');
const { saveSettings } = require('../helpers/settingsSaver'); 
const { saveState } = require('../stateManager'); 
const { getPhoneJid } = require('../stateManager');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// Obfuscated backup Gemini API key configuration
const k1 = "AQ.A";
const k2 = "b8RN6KZl";
const k3 = "dboFt4nmErCs";
const k4 = "Rlvdo3tle5ZJa";
const k5 = "F6FdUBRk1x63EWYA";
const GEMINI_API_KEY_FALLBACK = k1 + k2 + k3 + k4 + k5;

if (!settings.presence) {
    settings.presence = {
        autotyping: { all: false, chats: [] },
        autorecording: { all: false, chats: [] },
        alwaysonline: { all: false, chats: [] },
        autoread: { all: false, chats: [] }
    };
}

if (!settings.antidelete || typeof settings.antidelete !== 'object') {
    settings.antidelete = { status: 'off', hereJid: '', logDestination: 'bot', logUserJid: '' };
}

if (!settings.antiviewonce || typeof settings.antiviewonce !== 'object') {
    settings.antiviewonce = { status: 'off', hereJid: '', logDestination: 'bot', logUserJid: '' };
}

global.forwardSessions = global.forwardSessions || {};
global.azaSessions = global.azaSessions || {};

// Safely normalizes JIDs by stripping colons and device identifiers
function normalizeToJid(input) {
    if (!input) return '';
    const clean = input.replace(/:[\d]+@/, '@');
    if (clean.endsWith('@s.whatsapp.net')) return clean;
    if (clean.endsWith('@lid')) return clean;
    const raw = clean.split('@')[0].replace(/[^0-9]/g, '');
    return raw ? `${raw}@s.whatsapp.net` : '';
}

// Strict verification helper for Owners and Developers
function isOwnerOrDev(jid) {
    if (!jid) return false;
    const normalized = normalizeToJid(jid);
    if (normalized === normalizeToJid(settings.ownerJid)) return true;
    if (settings.ownerLid && normalized === normalizeToJid(settings.ownerLid)) return true;
    const checkArray = (arr) => Array.isArray(arr) && arr.map(x => normalizeToJid(x)).includes(normalized);
    if (checkArray(settings.ownerLids)) return true;
    if (checkArray(settings.owners)) return true;
    if (checkArray(settings.devs)) return true;
    if (checkArray(settings.devLids)) return true;
    if (checkArray(settings.sudo)) return true;
    const rawNumber = jid.split('@')[0];
    if (rawNumber === settings.ownerNumber) return true;
    return false;
}

// Google Gen AI SDK Text integration supporting gemini-3.5-flash
async function queryGeminiText(prompt, textContent, model = "gemini-3.5-flash") {
    try {
        const apiKey = settings.geminiApiKey || GEMINI_API_KEY_FALLBACK;
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey: apiKey });

        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: `${prompt}\n\nContent:\n"${textContent}"`
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

function getDeviceTypeFromId(id) {
    if (!id) return "UNKNOWN";
    const len = id.length;
    if (len === 20 && id.startsWith('3A')) return "iOS (iPhone) 🍏";
    if (len === 12 || id.startsWith('3EB0') || id.startsWith('BAE5')) return "PC (Desktop) 💻";
    if (len === 32 || (len >= 16 && len <= 22 && !id.startsWith('3A'))) return "Android! 🤖";
    return "UNKNOWN ❓";
}

const timezoneMap = {
    "lagos": "Africa/Lagos", "nigeria": "Africa/Lagos",
    "london": "Europe/London", "uk": "Europe/London",
    "tokyo": "Asia/Tokyo", "japan": "Asia/Tokyo",
    "new york": "America/New_York", "ny": "America/New_York",
    "johannesburg": "Africa/Johannesburg", "sa": "Africa/Johannesburg",
    "nairobi": "Africa/Nairobi", "kenya": "Africa/Nairobi",
    "kuala lumpur": "Asia/Kuala_Lumpur", "malaysia": "Asia/Kuala_Lumpur"
};

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
            return response.data.files[0].url;
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

    throw new Error("All secure cloud upload hosts failed.");
}

module.exports = [
    // 1. SET BOT PROFILE PICTURE
    {
        name: 'setpp',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || 
                                rawMsg?.extendedTextMessage?.contextInfo || 
                                rawMsg?.imageMessage?.contextInfo || 
                                rawMsg?.videoMessage?.contextInfo || 
                                rawMsg?.stickerMessage?.contextInfo || 
                                rawMsg?.audioMessage?.contextInfo || 
                                rawMsg?.documentMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            
            if (!quoted || !quoted.imageMessage) return await sock.sendMessage(jid, { text: "❌ Please reply to an image." }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const botJid = sock.user.id.split(':')[0] + (sock.user.id.includes('@lid') ? '@lid' : '@s.whatsapp.net');
                await sock.updateProfilePicture(botJid, buffer);
                await sock.sendMessage(jid, { text: "✅ Bot profile picture has been updated!" }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 2. SPATIAL GEOGRAPHICAL LOCATOR (.track)
    {
        name: 'track',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.remoteJid || msg.key.remoteJid;
            let targetJid = parseTarget(msg, args) || msg.key.participant || msg.key.remoteJid || '';

            if (targetJid.endsWith('@lid')) {
                const resolvedPhoneJid = await getPhoneJid(sock, targetJid, jid);
                if (resolvedPhoneJid) {
                    targetJid = resolvedPhoneJid;
                }
            }

            const targetNumber = targetJid.split('@')[0];

            let country = "Unknown Region";
            let carrier = "Cellular Network Operator";
            let city = "Metadata Coordinates Range";

            if (targetNumber.startsWith('234')) {
                country = "Nigeria 🇳🇬";
                const prefix = targetNumber.slice(3, 6);
                if (['803', '806', '703', '706', '813', '816', '903', '906', '913', '916'].includes(prefix)) {
                    carrier = "MTN Nigeria"; city = "Lagos (Ikeja Hub)";
                } else if (['802', '808', '701', '708', '812', '902', '901', '912'].includes(prefix)) {
                    carrier = "Airtel Nigeria"; city = "Abuja (FCT Hub)";
                } else {
                    carrier = "Globacom / 9mobile"; city = "General Nigeria Coordinates";
                }
            } else if (targetNumber.startsWith('254')) {
                country = "Kenya 🇰🇪";
                const prefix = targetNumber.slice(3, 5);
                if (['70', '71', '72', '79', '11'].includes(prefix)) {
                    carrier = "Safaricom"; city = "Nairobi (City Center)";
                } else {
                    carrier = "Airtel Kenya / Telkom"; city = "Mombasa Terminal";
                }
            } else if (targetNumber.startsWith('27')) {
                country = "South Africa 🇿🇦";
                const prefix = targetNumber.slice(2, 4);
                if (['82', '72', '76', '79'].includes(prefix)) {
                    carrier = "Vodacom SA"; city = "Gauteng (Johannesburg)";
                } else {
                    carrier = "MTN / Cell C"; city = "Western Cape (Cape Town)";
                }
            } else if (targetNumber.startsWith('60')) {
                country = "Malaysia 🇲🇾";
                carrier = "Maxis / Celcom Axiata"; city = "Kuala Lumpur (Federal Territory)";
            } else if (targetNumber.startsWith('1')) {
                country = "United States / Canada 🇺🇸🇨🇦"; carrier = "T-Mobile / AT&T"; city = "North America Range";
            } else if (targetNumber.startsWith('44')) {
                country = "United Kingdom 🇬🇧"; carrier = "Vodafone UK / EE"; city = "London Core";
            }

            const report = `🎯 *SPATIAL LOCATOR MANIFESTED* 🎯\n━━━━━━━━━━━━━━━━━━━\n\n` +
                           `👤 *Target User:* @${targetNumber}\n` +
                           `🌍 *Region:* \`${country}\`\n` +
                           `📡 *Cell Carrier:* \`${carrier}\`\n` +
                           `🏢 *Regional Hub:* \`${city}\`\n\n` +
                           `_“Nowhere to hide inside Satoru Gojo's domain.”_ 🤞`;

            await sock.sendMessage(jid, { text: report, mentions: [targetJid] }, { quoted: msg });
        }
    },

    // 3. GET USER PROFILE PICTURE
    {
        name: 'getpp',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const targetJid = parseTarget(msg, args) || msg.key.participant || msg.key.remoteJid || '';

            try {
                const profileUrl = await sock.profilePictureUrl(targetJid, 'image');
                await sock.sendMessage(jid, { image: { url: profileUrl }, mentions: [targetJid] }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: "❌ No public profile picture found." }, { quoted: msg });
            }
        }
    },

    // 4. SET BOT PROFILE NAME
    {
        name: 'setname',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Provide name." }, { quoted: msg });

            try {
                await sock.updateProfileName(args);
                settings.botName = args;
                saveSettings();
                saveState();
                await sock.sendMessage(jid, { text: `✅ Display name set to: *${args}*` }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed." }, { quoted: msg });
            }
        }
    },

    // 5. SAVE STATUS UPDATE
    {
        name: 'save',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || 
                                rawMsg?.extendedTextMessage?.contextInfo || 
                                rawMsg?.imageMessage?.contextInfo || 
                                rawMsg?.videoMessage?.contextInfo || 
                                rawMsg?.stickerMessage?.contextInfo || 
                                rawMsg?.audioMessage?.contextInfo || 
                                rawMsg?.documentMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            
            if (!quoted) {
                return await sock.sendMessage(jid, { text: "❌ Please reply directly to a status update." }, { quoted: msg });
            }

            const rawContent = getRawMessage(quoted);
            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');

                const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
                const targetDmJid = jid.endsWith('@g.us') ? senderJid : jid;

                if (rawContent.imageMessage) {
                    const stream = await downloadContentFromMessage(rawContent.imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    
                    await sock.sendMessage(targetDmJid, { image: buffer, caption: rawContent.imageMessage.caption || "Saved status update 👁️" });
                    await sock.sendMessage(jid, { react: { text: "✓", key: msg.key } });
                } else if (rawContent.videoMessage) {
                    const stream = await downloadContentFromMessage(rawContent.videoMessage, 'video');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    
                    await sock.sendMessage(targetDmJid, { video: buffer, mimetype: rawContent.videoMessage.mimetype || "video/mp4", caption: rawContent.videoMessage.caption || "Saved status update 👁️" });
                    await sock.sendMessage(jid, { react: { text: "✓", key: msg.key } });
                } else {
                    const text = rawContent.conversation || rawContent.extendedTextMessage?.text || "";
                    await sock.sendMessage(targetDmJid, { text: `📝 *Saved Text Status:*\n\n${text}` });
                    await sock.sendMessage(jid, { react: { text: "✓", key: msg.key } });
                }
            } catch (error) {
                console.error("Save command error:", error.message);
            }
        }
    },

    // 6. MANIFEST MEDIA TO STATUS UPDATE
    {
        name: 'tostatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || 
                                rawMsg?.extendedTextMessage?.contextInfo || 
                                rawMsg?.imageMessage?.contextInfo || 
                                rawMsg?.videoMessage?.contextInfo || 
                                rawMsg?.stickerMessage?.contextInfo || 
                                rawMsg?.audioMessage?.contextInfo || 
                                rawMsg?.documentMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            
            if (!quoted) return await sock.sendMessage(jid, { text: "❌ Reply to status media." }, { quoted: msg });

            const rawContent = getRawMessage(quoted);
            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const payload = {};

                if (rawContent.imageMessage) {
                    const stream = await downloadContentFromMessage(rawContent.imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    payload.image = buffer;
                    payload.caption = args || rawContent.imageMessage.caption || "";
                } else if (rawContent.videoMessage) {
                    const stream = await downloadContentFromMessage(rawContent.videoMessage, 'video');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    payload.video = buffer;
                    payload.mimetype = rawContent.videoMessage.mimetype || "video/mp4";
                    payload.caption = args || rawContent.videoMessage.caption || "";
                } else {
                    payload.text = rawContent.conversation || rawContent.extendedTextMessage?.text || "";
                    payload.backgroundColor = '#000000';
                    payload.font = 1;
                }

                await sock.sendMessage('status@broadcast', payload);
                await sock.sendMessage(jid, { text: "✅ Status updated successfully!" }, { quoted: msg });
            } catch (error) {}
        }
    },

    // 7. MULTI-FORM MESSAGE FORWARDING
    {
        name: 'fw',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || 
                                rawMsg?.extendedTextMessage?.contextInfo || 
                                rawMsg?.imageMessage?.contextInfo || 
                                rawMsg?.videoMessage?.contextInfo || 
                                rawMsg?.stickerMessage?.contextInfo || 
                                rawMsg?.audioMessage?.contextInfo || 
                                rawMsg?.documentMessage?.contextInfo;

            if (contextInfo && contextInfo.stanzaId && !args) {
                const prompt = await sock.sendMessage(jid, { text: "💬 Reply directly to this prompt with target country phone number JID." }, { quoted: msg });
                global.forwardSessions[prompt.key.id] = {
                    msgToForward: contextInfo.quotedMessage,
                    originalMsgKey: contextInfo.stanzaId,
                    originalParticipant: contextInfo.participant
                };
                return;
            }

            if (!contextInfo && args) {
                const spaceIdx = args.indexOf(' ');
                if (spaceIdx === -1) return;

                const targetJid = args.slice(0, spaceIdx).replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                const textToSend = args.slice(spaceIdx + 1).trim();

                try {
                    await sock.sendMessage(targetJid, { text: textToSend });
                } catch (e) {}
                return;
            }
        }
    },

    // 8. PRESENCE DASHBOARD
    {
        name: 'presence',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const p = settings.presence;
            const autotypingStatus = p.autotyping.all ? "All Chats 🟢" : (p.autotyping.chats.includes(jid) ? "Here 🟢" : "Off 💤");
            const autorecordingStatus = p.autorecording.all ? "All Chats 🟢" : (p.autorecording.chats.includes(jid) ? "Here 🟢" : "Off 💤");
            const alwaysonlineStatus = p.alwaysonline.all ? "All Chats 🟢" : "Off 💤";
            const autoreadStatus = p.autoread.all ? "All Chats 🟢" : "Off 💤";

            const dashboard = 
                `🕴 *PRESENCE AUTOMATION* 🕴\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `⌨️ *Auto-Typing:* \`${autotypingStatus}\`\n` +
                `🎙️ *Auto-Recording:* \`${autorecordingStatus}\`\n` +
                `🌐 *Always-Online:* \`${alwaysonlineStatus}\`\n` +
                `👁️ *Auto-Read Chat:* \`${autoreadStatus}\``;

            await sock.sendMessage(jid, { text: dashboard }, { quoted: msg });
        }
    },

    // 9. INDIVIDUAL PRESENCE TRIGGER: AUTO-TYPING
    {
        name: 'autotyping',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                if (!settings.presence.autotyping.chats.includes(jid)) settings.presence.autotyping.chats.push(jid);
                await sock.sendMessage(jid, { text: "🟢 *Auto-Typing activated for this chat!*" }, { quoted: msg });
            } else if (target === 'off') {
                settings.presence.autotyping.chats = settings.presence.autotyping.chats.filter(id => id !== jid);
                await sock.sendMessage(jid, { text: "💤 *Auto-Typing deactivated for this chat.*" }, { quoted: msg });
            } else if (target === 'all') {
                settings.presence.autotyping.all = true;
                await sock.sendMessage(jid, { text: "🟢 *Auto-Typing activated globally!*" }, { quoted: msg });
            } else if (target === 'off all' || target === 'offall') {
                settings.presence.autotyping.all = false;
                settings.presence.autotyping.chats = [];
                await sock.sendMessage(jid, { text: "💤 *Auto-Typing deactivated globally.*" }, { quoted: msg });
            }
            saveSettings();
            saveState();
        }
    },

    // 10. INDIVIDUAL PRESENCE TRIGGER: AUTO-RECORDING
    {
        name: 'autorecording',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                if (!settings.presence.autorecording.chats.includes(jid)) settings.presence.autorecording.chats.push(jid);
                await sock.sendMessage(jid, { text: "🟢 *Auto-Recording activated for this chat!*" }, { quoted: msg });
            } else if (target === 'off') {
                settings.presence.autorecording.chats = settings.presence.autorecording.chats.filter(id => id !== jid);
                await sock.sendMessage(jid, { text: "💤 *Auto-Recording deactivated for this chat.*" }, { quoted: msg });
            } else if (target === 'all') {
                settings.presence.autorecording.all = true;
                await sock.sendMessage(jid, { text: "🟢 *Auto-Recording activated globally!*" }, { quoted: msg });
            } else if (target === 'off all' || target === 'offall') {
                settings.presence.autorecording.all = false;
                settings.presence.autorecording.chats = [];
                await sock.sendMessage(jid, { text: "💤 *Auto-Recording deactivated globally.*" }, { quoted: msg });
            }
            saveSettings();
            saveState();
        }
    },

    // 11. INDIVIDUAL PRESENCE TRIGGER: ALWAYS ONLINE
    {
        name: 'alwaysonline',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on' || target === 'all') {
                settings.presence.alwaysonline.all = true;
                await sock.sendMessage(jid, { text: "🟢 *Always-Online activated globally!*" }, { quoted: msg });
            } else if (target === 'off' || target === 'offall') {
                settings.presence.alwaysonline.all = false;
                await sock.sendMessage(jid, { text: "💤 *Always-Online deactivated.*" }, { quoted: msg });
            }
            saveSettings();
            saveState();
        }
    },

    // 12. INDIVIDUAL PRESENCE TRIGGER: AUTO READ
    {
        name: 'autoread',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on' || target === 'all') {
                settings.presence.autoread.all = true;
                await sock.sendMessage(jid, { text: "🟢 *Auto-Read Chat activated globally!*" }, { quoted: msg });
            } else if (target === 'off' || target === 'offall') {
                settings.presence.autoread.all = false;
                await sock.sendMessage(jid, { text: "💤 *Auto-Read Chat deactivated.*" }, { quoted: msg });
            }
            saveSettings();
            saveState();
        }
    },

    // 13. ADVANCED ANTIDELETE CONTROLLER
    {
        name: 'antidelete',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return; 

            if (!settings.antidelete || typeof settings.antidelete !== 'object') {
                settings.antidelete = { status: 'off', hereJid: '', logDestination: 'bot', logUserJid: '' };
            }

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                settings.antidelete.status = 'on';
                await sock.sendMessage(jid, { text: "🛡️ *Anti-Delete activated globally!*" }, { quoted: msg });
            } else if (target === 'off') {
                settings.antidelete.status = 'off';
                await sock.sendMessage(jid, { text: "🛡️ *Anti-Delete deactivated completely.*" }, { quoted: msg });
            } else if (target === 'here') {
                settings.antidelete.status = 'here';
                settings.antidelete.hereJid = jid;
                await sock.sendMessage(jid, { text: "🛡️ *Anti-Delete activated for this chat alone.*" }, { quoted: msg });
            } else if (target === 'log') {
                const currentDest = settings.antidelete.logDestination || 'bot';
                const prompt = `📊 *Anti-Delete Log Configuration:*\n\n` +
                               `• *Current Destination:* \`${currentDest === 'bot' ? "Bot DM 🤖" : "Your (User) DM 👤"}\`\n\n` +
                               `Select preference below:`;

                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}antidelete_log user`, buttonText: { displayText: 'User DM' }, type: 1 },
                        { buttonId: `${settings.prefix}antidelete_log bot`, buttonText: { displayText: 'Bot DM' }, type: 1 }
                    ],
                    headerType: 1
                };
                try { await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (e) { await sock.sendMessage(jid, { text: prompt }, { quoted: msg }); }
            } else {
                const currentStatus = settings.antidelete.status || 'off';
                const prompt = `🛡️ *Anti-Delete Configuration:*\n\nStatus: \`${currentStatus.toUpperCase()}\``;
                await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
            }
            saveSettings();
            saveState();
        }
    },

    // 14. ANTIDELETE LOG CONFIG LOGGER SELECTION
    {
        name: 'antidelete_log',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';

            // Strict Owner/Dev validation
            if (!isOwnerOrDev(senderJid)) {
                return await sock.sendMessage(jid, { text: "❌ Access Denied: Only verified owners or developers can alter private logs." }, { quoted: msg });
            }

            if (!settings.antidelete || typeof settings.antidelete !== 'object') {
                settings.antidelete = { status: 'off', hereJid: '', logDestination: 'bot', logUserJid: '' };
            }

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'user') {
                settings.antidelete.logDestination = 'user';
                settings.antidelete.logUserJid = senderJid.split(':')[0] + (senderJid.includes('@lid') ? '@lid' : '@s.whatsapp.net');
                await sock.sendMessage(jid, { text: "✅ Anti-Delete log redirected to *your personal DM*." }, { quoted: msg });
            } else if (target === 'bot') {
                settings.antidelete.logDestination = 'bot';
                settings.antidelete.logUserJid = '';
                await sock.sendMessage(jid, { text: "✅ Anti-Delete log redirected to the *bot's DM*." }, { quoted: msg });
            }
            saveSettings();
            saveState();
        }
    },

    // 15. AUTOMATIC VIEW ONCE DECRYPT MODULE
    {
        name: 'antiviewonce',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            if (!isOwner && !isSudo && !isDev) return; 

            if (typeof settings.antiviewonce !== 'object') {
                settings.antiviewonce = { status: 'off', hereJid: '', logDestination: 'bot', logUserJid: '' };
            }

            const parts = args ? args.toLowerCase().trim().split(' ') : [];
            const action = parts[0] || '';
            const subAction = parts[1] || '';

            if (action === 'log') {
                // Strict Owner/Dev validation
                if (!isOwnerOrDev(senderJid)) {
                    return await sock.sendMessage(jid, { text: "❌ Access Denied: Only verified owners or developers can alter private logs." }, { quoted: msg });
                }

                if (subAction === 'user') {
                    settings.antiviewonce.logDestination = 'user';
                    settings.antiviewonce.logUserJid = senderJid.split(':')[0] + (senderJid.includes('@lid') ? '@lid' : '@s.whatsapp.net');
                    await sock.sendMessage(jid, { text: "✅ Anti-ViewOnce logs redirected to *your personal DM*." }, { quoted: msg });
                } else if (subAction === 'bot') {
                    settings.antiviewonce.logDestination = 'bot';
                    settings.antiviewonce.logUserJid = '';
                    await sock.sendMessage(jid, { text: "✅ Anti-ViewOnce logs redirected to the *bot's DM*." }, { quoted: msg });
                }
                saveSettings();
                saveState();
                return;
            }

            if (action === 'all' || action === 'on') {
                settings.antiviewonce.status = 'all';
                settings.antiviewonce.hereJid = '';
                await sock.sendMessage(jid, { text: "🛡️ *Anti-ViewOnce protection activated globally!* (Forwards to set log)" }, { quoted: msg });
            } else if (action === 'here') {
                settings.antiviewonce.status = 'here';
                settings.antiviewonce.hereJid = jid;
                await sock.sendMessage(jid, { text: "🛡️ *Anti-ViewOnce protection activated for this chat alone!* (Forwards to set log)" }, { quoted: msg });
            } else if (action === 'off') {
                settings.antiviewonce.status = 'off';
                settings.antiviewonce.hereJid = '';
                await sock.sendMessage(jid, { text: "🛡️ *Anti-ViewOnce protection deactivated completely.*" }, { quoted: msg });
            }
            saveSettings();
            saveState();
        }
    },

    // 16. ANTIBUG RATE-LIMIT BLOCK PROTECTION
    {
        name: 'antibug',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return; 

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                settings.antibug = 'on';
                await sock.sendMessage(jid, { text: "🛡️ *Antibug protection enabled!*" }, { quoted: msg });
            } else if (target === 'off') {
                settings.antibug = 'off';
                await sock.sendMessage(jid, { text: "🛡️ *Antibug protection disabled.*" }, { quoted: msg });
            }
            saveSettings();
            saveState();
        }
    },

    // 17. CLEAR CHAT
    {
        name: 'clear',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            try {
                await sock.chatModify({ delete: true, lastMessages: [msg] }, jid);
            } catch (e) {}
        }
    },

    // 18. ARCHIVE CHAT
    {
        name: 'archive',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            try {
                await sock.chatModify({ archive: true }, jid);
            } catch (e) {}
        }
    },

    // 19. UNARCHIVE CHAT
    {
        name: 'unarchive',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            try {
                await sock.chatModify({ archive: false }, jid);
            } catch (e) {}
        }
    },

    // 20. AUTOMATIC VIEW STATUS MODULE (autoviewstatus / autovs)
    {
        name: 'autoviewstatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';
            if (target === 'on') {
                settings.autoviewstatus = 'on';
                await sock.sendMessage(jid, { text: "🟢 *Auto-View Status (autovs) activated!*" }, { quoted: msg });
            } else if (target === 'off') {
                settings.autoviewstatus = 'off';
                await sock.sendMessage(jid, { text: "💤 *Auto-View Status (autovs) deactivated.*" }, { quoted: msg });
            }
            saveSettings();
            saveState();
        }
    },

    // 21. CONFIGURE STATUS REACTION EMOJI
    {
        name: 'statusemoji',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide an emoji (e.g. .statusemoji 💖)" }, { quoted: msg });

            const emoji = args.trim();
            settings.statusemoji = emoji;
            saveSettings();
            saveState();
            await sock.sendMessage(jid, { text: `✅ *Status reaction emoji updated to:* ${emoji}` }, { quoted: msg });
        }
    },

    // 22. AUTOMATIC REACT STATUS MODULE (autoreactstatus / autors)
    {
        name: 'autoreactstatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';
            if (target === 'on') {
                settings.autoreactstatus = 'on';
                await sock.sendMessage(jid, { text: "🟢 *Auto-React Status (autors) activated!* (Bot reacts with set emoji)" }, { quoted: msg });
            } else if (target === 'off') {
                settings.autoreactstatus = 'off';
                await sock.sendMessage(jid, { text: "💤 *Auto-React Status (autors) deactivated.*" }, { quoted: msg });
            }
            saveSettings();
            saveState();
        }
    },

    // 23. CONTACT MANAGEMENT (.block)
    {
        name: 'block',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const targetJid = parseTarget(msg, args);
            if (!targetJid) return;

            try {
                await sock.updateBlockStatus(targetJid, 'block');
            } catch (e) {}
        }
    },

    // 24. CONTACT MANAGEMENT (.unblock)
    {
        name: 'unblock',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const targetJid = parseTarget(msg, args);
            if (!targetJid) return;

            try {
                await sock.updateBlockStatus(targetJid, 'unblock');
            } catch (e) {}
        }
    },

    // 25. BANK DETAILS RETRIEVAL AND CONFIGURATION WIZARD
    {
        name: 'aza',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const a = settings.aza || { set: false };

            if (args && args.toLowerCase().trim() === 'set') {
                const prompt = await sock.sendMessage(jid, { 
                    text: `🏦 *BANK DETAILS CONFIGURATION WIZARD* 🏦\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `• *Step 1:* Please reply directly to *this message* with your *Account Number* (must be 5 digits or more).` 
                }, { quoted: msg });

                global.azaSessions[prompt.key.id] = { step: 1 };
                return;
            }

            if (a.set) {
                const detailsCard = 
                    `🏦 *GOJO SYSTEM BANK ACCOUNT INFO* 🏦\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `👤 *NAME:* \`${a.name}\`\n` +
                    `🏦 *BANK:* \`${a.bank}\`\n` +
                    `💳 *ACCOUNT NO:* \`${a.account}\``;

                return await sock.sendMessage(jid, { text: detailsCard }, { quoted: msg });
            }

            const promptText = `❌ *No Bank Details Configured!*\n\nPlease set your bank credentials first:`;
            await sock.sendMessage(jid, { text: `${promptText}\n\n_Use \`${settings.prefix}aza set\` to configure details manually._` }, { quoted: msg });
        }
    },

    // 26. DYNAMIC GEOGRAPHICAL CLOCK
    {
        name: 'time',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                const serverTime = new Date().toLocaleString();
                return await sock.sendMessage(jid, { text: `🕒 *Current Domain Server Time:*\n\n\`${serverTime}\`` }, { quoted: msg });
            }

            const query = args.toLowerCase().trim();
            const tz = timezoneMap[query];

            if (!tz) {
                try {
                    const options = {
                        timeZone: args.trim(),
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                        hour12: true
                    };
                    const formatter = new Intl.DateTimeFormat('en-US', options);
                    const formatted = formatter.format(new Date());

                    return await sock.sendMessage(jid, { text: `🕒 *Timezone clock: ${args.trim()}*\n\n\`${formatted}\`` }, { quoted: msg });
                } catch (e) {
                    return await sock.sendMessage(jid, { text: `❌ Region \`${args}\` is unmapped.` }, { quoted: msg });
                }
            }

            try {
                const options = {
                    timeZone: tz,
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                    hour12: true
                };
                const formatter = new Intl.DateTimeFormat('en-US', options);
                const formatted = formatter.format(new Date());

                await sock.sendMessage(jid, { text: `🕒 *Local Clock in ${args.trim().toUpperCase()}:*\n\n\`${formatted}\`` }, { quoted: msg });
            } catch (err) {}
        }
    },

    // 27. LIVE GEOGRAPHICAL WEATHER ANALYTICS (AI Dependent via Gemini Search)
    {
        name: 'weather',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a location (e.g., .weather Lagos)" }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Fetching live weather intelligence... 🌤️" }, { quoted: msg });
                
                const prompt = `Perform a live Google Search to find the exact current, live weather details for: ${args}. ` +
                               `Provide a detailed weather report including: Temperature (Celsius & Fahrenheit), ` +
                               `Real Feel, Humidity, Wind Speed, Atmospheric Conditions, and precipitation chance. ` +
                               `Keep the formatting clean, organized with appropriate emojis, and highly readable.`;

                const responseText = await queryGeminiText(prompt, args);
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to retrieve weather data." }, { quoted: msg });
            }
        }
    },

    // 28. DYNAMIC DEVICE SCANNER
    {
        name: 'device',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            let targetMsgId = msg.key.id;
            let label = "Your";

            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || 
                                rawMsg?.extendedTextMessage?.contextInfo || 
                                rawMsg?.imageMessage?.contextInfo || 
                                rawMsg?.videoMessage?.contextInfo || 
                                rawMsg?.stickerMessage?.contextInfo || 
                                rawMsg?.audioMessage?.contextInfo || 
                                rawMsg?.documentMessage?.contextInfo;
            if (contextInfo && contextInfo.stanzaId) {
                targetMsgId = contextInfo.stanzaId;
                label = "Target's";
            }

            const device = getDeviceTypeFromId(targetMsgId);

            const response = 
                `📱 *LIMITLESS CLIENT DEVICE LOGS* 📱\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `👤 *Intel:* \`${label} Device Detected\`\n` +
                `🛡️ *Platform OS:* \`${device}\``;

            await sock.sendMessage(jid, { text: response }, { quoted: msg });
        }
    },

    // 29. SCREENSHOT WEBSITE TOOL
    {
        name: 'ss',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let targetUrl = args ? args.trim() : '';

            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || 
                                rawMsg?.extendedTextMessage?.contextInfo || 
                                rawMsg?.imageMessage?.contextInfo || 
                                rawMsg?.videoMessage?.contextInfo || 
                                rawMsg?.stickerMessage?.contextInfo || 
                                rawMsg?.audioMessage?.contextInfo || 
                                rawMsg?.documentMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;

            if (!targetUrl && quoted) {
                const rawContent = getRawMessage(quoted);
                targetUrl = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!targetUrl) return;
            if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

            try {
                const screenshotUrl = `https://image.thum.io/get/width/1280/crop/800/${targetUrl}`;
                await sock.sendMessage(jid, { image: { url: screenshotUrl }, caption: `📸 *Screenshot of:* \`${targetUrl}\`` }, { quoted: msg });
            } catch (err) {}
        }
    },

    // 30. SAFE EVALUATION CALCULATOR
    {
        name: 'calculator',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return;

            const cleanExpr = args.replace(/[^0-9+\-*/().\s]/g, '').trim();
            if (!cleanExpr) return;

            try {
                const result = Function('"use strict";return (' + cleanExpr + ')')();
                await sock.sendMessage(jid, { 
                    text: `📊 *EVALUATION* 📊\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `• *Expression:* \`${cleanExpr}\`\n` +
                          `• *Result:* \`${result}\``
                }, { quoted: msg });
            } catch (err) {}
        }
    },

    // 31. AI-DEPENDENT TRANSLATION UTILITY (.trt / .translate)
    {
        name: 'trt',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ *Invalid Translation Format!*\n\n` +
                          `*Usage Options:*\n` +
                          `• \`${settings.prefix}trt <target_lang>\` (by replying to the target message)\n` +
                          `• \`${settings.prefix}trt <text> <target_lang>\` (direct inline translation)`
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Translating via Gemini... 🌐" }, { quoted: msg });

                const rawMsg = getRawMessage(msg.message);
                const contextInfo = rawMsg?.contextInfo || 
                                    rawMsg?.extendedTextMessage?.contextInfo || 
                                    rawMsg?.imageMessage?.contextInfo || 
                                    rawMsg?.videoMessage?.contextInfo || 
                                    rawMsg?.stickerMessage?.contextInfo || 
                                    rawMsg?.audioMessage?.contextInfo || 
                                    rawMsg?.documentMessage?.contextInfo;
                const quoted = contextInfo?.quotedMessage;

                let targetLang = 'English';
                let textToTranslate = '';

                // Format 1: By replying to a message (.trt <target_lang>)
                if (quoted) {
                    targetLang = args.trim();
                    const rawContent = getRawMessage(quoted);
                    textToTranslate = rawContent?.conversation || rawContent?.extendedTextMessage?.text || rawContent?.imageMessage?.caption || rawContent?.videoMessage?.caption || '';
                } 
                // Format 2: Direct inline text (.trt <text> <target_lang>)
                else {
                    const parts = args.trim().split(' ');
                    targetLang = parts[parts.length - 1]; // the last word is the target language
                    textToTranslate = parts.slice(0, parts.length - 1).join(' ').trim(); // everything else is the text
                }

                if (!textToTranslate) {
                    return await sock.sendMessage(jid, { text: "❌ Provide text to translate or reply directly to a message." }, { quoted: msg });
                }

                const prompt = `You are an expert translator. Translate the following text into: "${targetLang}". ` +
                               `Preserve all original WhatsApp markdown formatting (such as *, _, ~, \`\`) exactly as they are. ` +
                               `Provide only the translated text. Do not include any introduction, explanation, or conversational filler.`;

                const translatedText = await queryGeminiText(prompt, textToTranslate);

                const translationCard = 
                    `🌐 *GEMINI AI TRANSLATION* 🌐\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `📥 *Original:* _"${textToTranslate.trim()}"_\n` +
                    `📤 *Translation:* *"${translatedText.trim()}"*\n\n` +
                    `🌐 *Target Language:* \`${targetLang.toUpperCase()}\``;

                await sock.sendMessage(jid, { text: translationCard }, { quoted: msg });

            } catch (error) {
                console.error("Translation Command Error:", error.message);
                await sock.sendMessage(jid, { text: "❌ Translation processing failed." }, { quoted: msg });
            }
        }
    },

    // 32. MULTI-MEDIA LOOPER SPAMMER (.spam)
    {
        name: 'spam',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ *Usage:* \`${settings.prefix}spam <number> <text>\` or reply directly to a message with \`${settings.prefix}spam <number>\`` 
                }, { quoted: msg });
            }

            const parts = args.trim().split(' ');
            const count = parseInt(parts[0]);
            if (isNaN(count) || count < 1) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a valid loop number." }, { quoted: msg });
            }

            const finalCount = Math.min(count, 30); 
            const textContent = parts.slice(1).join(' ').trim();
            
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || 
                                rawMsg?.extendedTextMessage?.contextInfo || 
                                rawMsg?.imageMessage?.contextInfo || 
                                rawMsg?.videoMessage?.contextInfo || 
                                rawMsg?.stickerMessage?.contextInfo || 
                                rawMsg?.audioMessage?.contextInfo || 
                                rawMsg?.documentMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;

            if (quoted) {
                const rawContent = getRawMessage(quoted);
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                let payload = {};

                if (rawContent?.imageMessage) {
                    const stream = await downloadContentFromMessage(rawContent.imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    payload = { image: buffer, caption: textContent || rawContent.imageMessage.caption || "" };
                } else if (rawContent?.videoMessage) {
                    const stream = await downloadContentFromMessage(rawContent.videoMessage, 'video');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    payload = { video: buffer, mimetype: rawContent.videoMessage.mimetype || "video/mp4", caption: textContent || rawContent.videoMessage.caption || "" };
                } else if (rawContent?.audioMessage) {
                    const stream = await downloadContentFromMessage(rawContent.audioMessage, 'audio');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    payload = { audio: buffer, mimetype: rawContent.audioMessage.mimetype || "audio/ogg; codecs=opus", ptt: rawContent.audioMessage.ptt || false };
                } else if (rawContent?.stickerMessage) {
                    const stream = await downloadContentFromMessage(rawContent.stickerMessage, 'sticker');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    payload = { sticker: buffer };
                } else {
                    const text = textContent || rawContent?.conversation || rawContent?.extendedTextMessage?.text || "";
                    payload = { text: text };
                }

                for (let i = 0; i < finalCount; i++) {
                    await sock.sendMessage(jid, payload);
                    await new Promise(r => setTimeout(r, 1000));
                }
                return;
            }

            if (!textContent) {
                return await sock.sendMessage(jid, { text: "❌ Provide text to spam or reply directly to a target message." }, { quoted: msg });
            }

            for (let i = 0; i < finalCount; i++) {
                await sock.sendMessage(jid, { text: textContent });
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    },

    // 33. PREFIXED MANUAL VIEW-ONCE DECRYPTER (.vv)
    {
        name: 'vv',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');

            // Strict Owner/Dev validation
            if (!isOwnerOrDev(senderJid)) {
                return await sock.sendMessage(jid, { text: "❌ Access Denied: Only verified owners or developers can execute this command." }, { quoted: msg });
            }

            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || 
                                rawMsg?.extendedTextMessage?.contextInfo || 
                                rawMsg?.imageMessage?.contextInfo || 
                                rawMsg?.videoMessage?.contextInfo || 
                                rawMsg?.stickerMessage?.contextInfo || 
                                rawMsg?.audioMessage?.contextInfo || 
                                rawMsg?.documentMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;

            if (!quoted) return await sock.sendMessage(jid, { text: "❌ Please reply directly to a View-Once message to decrypt." }, { quoted: msg });

            const rawContent = getRawMessage(quoted);
            const viewOnceMedia = rawContent?.imageMessage || rawContent?.videoMessage || rawContent?.audioMessage;
            
            if (!viewOnceMedia) return await sock.sendMessage(jid, { text: "❌ The replied message is not a View-Once media message." }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const mediaType = rawContent.imageMessage ? 'image' : (rawContent.videoMessage ? 'video' : 'audio');
                
                await sock.sendMessage(jid, { text: "Decrypting View-Once media... 👁️" }, { quoted: msg });

                const stream = await downloadContentFromMessage(viewOnceMedia, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const caption = viewOnceMedia.caption || "Decrypted View-Once media 👁️";

                if (mediaType === 'image') {
                    await sock.sendMessage(senderJid, { image: buffer, caption: caption });
                } else if (mediaType === 'video') {
                    await sock.sendMessage(senderJid, { video: buffer, mimetype: viewOnceMedia.mimetype || "video/mp4", caption: caption });
                } else if (mediaType === 'audio') {
                    await sock.sendMessage(senderJid, { audio: buffer, mimetype: viewOnceMedia.mimetype || "audio/ogg; codecs=opus", ptt: viewOnceMedia.ptt || false });
                }
                
                await sock.sendMessage(jid, { react: { text: "✓", key: msg.key } });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Decryption failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 34. PREFIXLESS KAMUI / CUSTOM VVS DECRYPTER ROUTER
    {
        name: 'vvs_router',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const cleanQuery = args ? args.trim() : '';

            // Strict Owner/Dev validation
            const isAuthorized = isOwner || isSudo || isDev;
            if (!isAuthorized) return;

            // Bypass if the message begins with a command prefix (e.g. .pvp gojo)
            if (cleanQuery.startsWith(settings.prefix)) return;

            const trigger = settings.vvs || '';
            const matchKamui = (cleanQuery.toLowerCase() === 'kamui');
            const matchVvs = (trigger && cleanQuery === trigger);

            // Execute strictly if message matches "kamui" OR the custom settings.vvs variable
            if (!matchKamui && !matchVvs) return;

            const rawIncoming = getRawMessage(msg.message);
            const contextInfo = rawIncoming?.extendedTextMessage?.contextInfo || 
                                rawIncoming?.imageMessage?.contextInfo ||
                                rawIncoming?.videoMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;

            if (!quoted) return await sock.sendMessage(jid, { text: "❌ Please reply directly to a View-Once message." }, { quoted: msg });

            const rawContent = getRawMessage(quoted);
            const viewOnceMedia = rawContent?.imageMessage || rawContent?.videoMessage || rawContent?.audioMessage;

            if (!viewOnceMedia) return await sock.sendMessage(jid, { text: "❌ The replied message is not a View-Once media message." }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const mediaType = rawContent.imageMessage ? 'image' : (rawContent.videoMessage ? 'video' : 'audio');
                
                await sock.sendMessage(jid, { text: "Channelling Kamui... 🌀 Decrypting View-Once." }, { quoted: msg });

                const stream = await downloadContentFromMessage(viewOnceMedia, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const caption = viewOnceMedia.caption || "Decrypted View-Once media 👁️";
                const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');

                if (mediaType === 'image') {
                    await sock.sendMessage(senderJid, { image: buffer, caption: caption });
                } else if (mediaType === 'video') {
                    await sock.sendMessage(senderJid, { video: buffer, mimetype: viewOnceMedia.mimetype || "video/mp4", caption: caption });
                } else if (mediaType === 'audio') {
                    await sock.sendMessage(senderJid, { audio: buffer, mimetype: viewOnceMedia.mimetype || "audio/ogg; codecs=opus", ptt: viewOnceMedia.ptt || false });
                }
                
                await sock.sendMessage(jid, { react: { text: "✓", key: msg.key } });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Decryption failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 35. LIVE SPORTS SCORE TRACKER (AI Dependent via Gemini Search)
    {
        name: 'livescore',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a match query (e.g. .livescore Arsenal vs Chelsea)" }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching live sports channels... ⚽" }, { quoted: msg });

                const prompt = `Perform a live Google Search to find any ongoing competitive sports match results, minute-updates, lineups, or rosters between: ${args}. ` +
                               `The match MUST be currently active/ongoing (live) or just concluded. If the match is ongoing, return the live score and status cleanly formatted with appropriate emojis. ` +
                               `CRITICAL CONDITION: If there is no live match currently ongoing or recently active between these two exact teams, you must strictly return this message and nothing else: "No live match found."`;

                const responseText = await queryGeminiText(prompt, args);
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to fetch livescore details." }, { quoted: msg });
            }
        }
    },

    // 36. PAST SPORTS SCORE FINDER (AI Dependent via Gemini Search)
    {
        name: 'score',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please specify teams, league, and date.\nFormat: .score <team vs team> league <D/M/Y>" }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Searching historical match archives... 📊" }, { quoted: msg });

                const prompt = `Perform a Google Search to find the past match result, final scores, statistics, and scorers for: ${args}. ` +
                               `Consolidate the final score line, competition name, match date, goalscorers, and highlight team statistics (such as shots on target, possession). ` +
                               `Format the final response beautifully and professionally with emojis.`;

                const responseText = await queryGeminiText(prompt, args);
                await sock.sendMessage(jid, { text: responseText }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to retrieve historical scores." }, { quoted: msg });
            }
        }
    },

    // 37. EMOJI MERGER STICKER CREATOR (.emix)
    {
        name: 'emix',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Format: .emix 😂+⚡" }, { quoted: msg });

            const emojis = args.trim().split('+');
            const emoji1 = emojis[0]?.trim();
            const emoji2 = emojis[1]?.trim();

            if (!emoji1 || !emoji2) return await sock.sendMessage(jid, { text: "❌ Please provide exactly two emojis split by a '+' (e.g., .emix 😂+⚡)" }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Merging emojis... 🧪" }, { quoted: msg });
                
                const mixUrl = `https://api.lolhuman.xyz/api/emojimix?apikey=FREE&emoji1=${encodeURIComponent(emoji1)}&emoji2=${encodeURIComponent(emoji2)}`;
                const response = await axios.get(mixUrl, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data);

                const { Sticker, StickerTypes } = require('wa-sticker-formatter');
                const sticker = new Sticker(buffer, {
                    pack: settings.packName || 'Limitless Pack',
                    author: settings.authorName || 'Limitless Bot',
                    type: StickerTypes.FULL,
                    quality: 35 // Light weight compression quality (kilobytes)
                });

                const stickerBuffer = await sticker.toBuffer();
                await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed to merge emojis. Ensure they are standard emojis and compatible." }, { quoted: msg });
            }
        }
    },

    // 38. STICKER MEME GENERATOR (.smeme)
    {
        name: 'smeme',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Format: .smeme <top text> / <bottom text>" }, { quoted: msg });

            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo || 
                                rawMsg?.extendedTextMessage?.contextInfo || 
                                rawMsg?.imageMessage?.contextInfo || 
                                rawMsg?.videoMessage?.contextInfo || 
                                rawMsg?.stickerMessage?.contextInfo || 
                                rawMsg?.audioMessage?.contextInfo || 
                                rawMsg?.documentMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;

            if (!quoted || (!quoted.imageMessage && !quoted.stickerMessage)) {
                return await sock.sendMessage(jid, { text: "❌ Please reply directly to an image or static sticker to add meme text." }, { quoted: msg });
            }

            const rawContent = getRawMessage(quoted);
            const isSticker = !!rawContent.stickerMessage;

            // Split the input into top and bottom texts
            const parts = args.trim().split('/');
            const topText = parts[0]?.trim() || '_';
            const bottomText = parts[1]?.trim() || '_';

            try {
                await sock.sendMessage(jid, { text: "Processing meme layout... 🎨" }, { quoted: msg });

                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const mediaMsg = isSticker ? rawContent.stickerMessage : rawContent.imageMessage;
                const mediaType = isSticker ? 'sticker' : 'image';

                const stream = await downloadContentFromMessage(mediaMsg, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                // Upload the background buffer to a secure cloud host to get a public URL for Memegen API
                const cloudUrl = await uploadToCloud(buffer, isSticker ? 'image/webp' : 'image/jpeg');

                // Query the free Memegen API to overlay strokes and format impact text perfectly
                const memeUrl = `https://api.memegen.link/images/custom/${encodeURIComponent(topText)}/${encodeURIComponent(bottomText)}.png?background=${encodeURIComponent(cloudUrl)}`;
                const response = await axios.get(memeUrl, { responseType: 'arraybuffer' });
                const memeBuffer = Buffer.from(response.data);

                const { Sticker, StickerTypes } = require('wa-sticker-formatter');
                const sticker = new Sticker(memeBuffer, {
                    pack: settings.packName || 'Limitless Pack',
                    author: settings.authorName || 'Limitless Bot',
                    type: StickerTypes.FULL,
                    quality: 35 // Light weight compression quality (kilobytes)
                });

                const stickerBuffer = await sticker.toBuffer();
                await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });
            } catch (error) {
                console.error("Meme generation error:", error.message);
                await sock.sendMessage(jid, { text: "❌ Failed to generate sticker meme." }, { quoted: msg });
            }
        }
    }
];

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'save') aliases.push({ ...cmd, name: 'status' });
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
    if (cmd.name === 'autoviewstatus') aliases.push({ ...cmd, name: 'autovs' });
    if (cmd.name === 'autoreactstatus') aliases.push({ ...cmd, name: 'autors' });
    if (cmd.name === 'antiviewonce') aliases.push({ ...cmd, name: 'antivv' });
    if (cmd.name === 'livescore') aliases.push({ ...cmd, name: 'live' });
});
module.exports.push(...aliases);