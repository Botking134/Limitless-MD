// plugins/tools.js
const config = require('../config');
const { saveState, normalizeToJid, getPhoneJid } = require('../stateManager');
const { setVar, loadVars, syncVarsToConfig } = require('../vars');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

// ─── GLOBALS ──────────────────────────────────────────────────────
global.forwardSessions = global.forwardSessions || {};
global.azaSessions = global.azaSessions || {};

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
    // 1. SETPP (Bot Profile Picture)
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

    // 2. TRACK (Spatial geographical locator)
    {
        name: 'track',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
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

    // 3. GETPP (User Profile Picture)
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

    // 4. SETNAME (Bot display name)
    {
        name: 'setname',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Provide name." }, { quoted: msg });

            try {
                await sock.updateProfileName(args);
                config.botName = args;
                saveState();
                await sock.sendMessage(jid, { text: `✅ Display name set to: *${args}*` }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: "❌ Failed." }, { quoted: msg });
            }
        }
    },

    // 5. SAVE (Status media)
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

    // 6. TOSTATUS (Post media to status)
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
            } catch (error) { /* ignore */ }
        }
    },

    // 7. FW (Forwarding)
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
                } catch (e) { /* ignore */ }
                return;
            }
        }
    },

    // 8. PRESENCE (Dashboard)
    {
        name: 'presence',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const p = config.presence;
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

    // 9. AUTOTYPING
    {
        name: 'autotyping',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                if (!config.presence.autotyping.chats.includes(jid)) config.presence.autotyping.chats.push(jid);
                await sock.sendMessage(jid, { text: "🟢 *Auto-Typing activated for this chat!*" }, { quoted: msg });
            } else if (target === 'off') {
                config.presence.autotyping.chats = config.presence.autotyping.chats.filter(id => id !== jid);
                await sock.sendMessage(jid, { text: "💤 *Auto-Typing deactivated for this chat.*" }, { quoted: msg });
            } else if (target === 'all') {
                config.presence.autotyping.all = true;
                await sock.sendMessage(jid, { text: "🟢 *Auto-Typing activated globally!*" }, { quoted: msg });
            } else if (target === 'off all' || target === 'offall') {
                config.presence.autotyping.all = false;
                config.presence.autotyping.chats = [];
                await sock.sendMessage(jid, { text: "💤 *Auto-Typing deactivated globally.*" }, { quoted: msg });
            }
            saveState();
        }
    },

    // 10. AUTORECORDING
    {
        name: 'autorecording',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                if (!config.presence.autorecording.chats.includes(jid)) config.presence.autorecording.chats.push(jid);
                await sock.sendMessage(jid, { text: "🟢 *Auto-Recording activated for this chat!*" }, { quoted: msg });
            } else if (target === 'off') {
                config.presence.autorecording.chats = config.presence.autorecording.chats.filter(id => id !== jid);
                await sock.sendMessage(jid, { text: "💤 *Auto-Recording deactivated for this chat.*" }, { quoted: msg });
            } else if (target === 'all') {
                config.presence.autorecording.all = true;
                await sock.sendMessage(jid, { text: "🟢 *Auto-Recording activated globally!*" }, { quoted: msg });
            } else if (target === 'off all' || target === 'offall') {
                config.presence.autorecording.all = false;
                config.presence.autorecording.chats = [];
                await sock.sendMessage(jid, { text: "💤 *Auto-Recording deactivated globally.*" }, { quoted: msg });
            }
            saveState();
        }
    },

    // 11. ALWAYSONLINE
    {
        name: 'alwaysonline',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on' || target === 'all') {
                config.presence.alwaysonline.all = true;
                await sock.sendMessage(jid, { text: "🟢 *Always-Online activated globally!*" }, { quoted: msg });
            } else if (target === 'off' || target === 'offall') {
                config.presence.alwaysonline.all = false;
                await sock.sendMessage(jid, { text: "💤 *Always-Online deactivated.*" }, { quoted: msg });
            }
            saveState();
        }
    },

    // 12. AUTOREAD
    {
        name: 'autoread',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on' || target === 'all') {
                config.presence.autoread.all = true;
                await sock.sendMessage(jid, { text: "🟢 *Auto-Read Chat activated globally!*" }, { quoted: msg });
            } else if (target === 'off' || target === 'offall') {
                config.presence.autoread.all = false;
                await sock.sendMessage(jid, { text: "💤 *Auto-Read Chat deactivated.*" }, { quoted: msg });
            }
            saveState();
        }
    },

    // 13. ANTIDELETE (with flags)
    {
        name: 'antidelete',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            if (!args) {
                const current = config.antidelete?.mode || 'off';
                const statusMap = {
                    'off': '⛔ Off',
                    'group': '🏢 Groups Only',
                    'pm': '💬 DMs Only',
                    'all': '🌐 All Chats'
                };
                const prompt =
                    `🛡️ *ANTIDELETE MODE SELECTOR* 🛡️\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `*Current Mode:* ${statusMap[current] || '⛔ Off'}\n\n` +
                    `Select a mode below:`;

                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${config.prefix}antidelete -g`, buttonText: { displayText: 'Groups Only 🏢' }, type: 1 },
                        { buttonId: `${config.prefix}antidelete -pm`, buttonText: { displayText: 'DMs Only 💬' }, type: 1 },
                        { buttonId: `${config.prefix}antidelete -all`, buttonText: { displayText: 'All Chats 🌐' }, type: 1 },
                        { buttonId: `${config.prefix}antidelete -off`, buttonText: { displayText: 'Off ⛔' }, type: 1 }
                    ],
                    headerType: 1
                };
                try { return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (e) {
                    return await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }
            }

            const mode = args.toLowerCase().trim();
            if (['-g', '-pm', '-all', '-off'].includes(mode)) {
                const cleanMode = mode.replace('-', '');
                if (!config.antidelete) config.antidelete = {};
                config.antidelete.mode = cleanMode;
                saveState();
                const statusMap = {
                    'off': '⛔ Off',
                    'group': '🏢 Groups Only',
                    'pm': '💬 DMs Only',
                    'all': '🌐 All Chats'
                };
                await sock.sendMessage(jid, { text: `✅ *Antidelete mode updated:* ${statusMap[cleanMode]}` }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: `❌ Invalid option. Use -g, -pm, -all, or -off.` }, { quoted: msg });
            }
        }
    },

    // 14. ANTIVIEWONCE (with flags)
    {
        name: 'antiviewonce',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            if (!args) {
                const current = config.antiviewonce?.mode || 'off';
                const statusMap = {
                    'off': '⛔ Off',
                    'group': '🏢 Groups Only',
                    'pm': '💬 DMs Only',
                    'all': '🌐 All Chats'
                };
                const prompt =
                    `🛡️ *ANTIVIEWONCE MODE SELECTOR* 🛡️\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `*Current Mode:* ${statusMap[current] || '⛔ Off'}\n\n` +
                    `Select a mode below:`;

                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${config.prefix}antiviewonce -g`, buttonText: { displayText: 'Groups Only 🏢' }, type: 1 },
                        { buttonId: `${config.prefix}antiviewonce -pm`, buttonText: { displayText: 'DMs Only 💬' }, type: 1 },
                        { buttonId: `${config.prefix}antiviewonce -all`, buttonText: { displayText: 'All Chats 🌐' }, type: 1 },
                        { buttonId: `${config.prefix}antiviewonce -off`, buttonText: { displayText: 'Off ⛔' }, type: 1 }
                    ],
                    headerType: 1
                };
                try { return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (e) {
                    return await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }
            }

            const mode = args.toLowerCase().trim();
            if (['-g', '-pm', '-all', '-off'].includes(mode)) {
                const cleanMode = mode.replace('-', '');
                if (!config.antiviewonce) config.antiviewonce = {};
                config.antiviewonce.mode = cleanMode;
                saveState();
                const statusMap = {
                    'off': '⛔ Off',
                    'group': '🏢 Groups Only',
                    'pm': '💬 DMs Only',
                    'all': '🌐 All Chats'
                };
                await sock.sendMessage(jid, { text: `✅ *Antiviewonce mode updated:* ${statusMap[cleanMode]}` }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: `❌ Invalid option. Use -g, -pm, -all, or -off.` }, { quoted: msg });
            }
        }
    },

    // 15. ANTIBUG
    {
        name: 'antibug',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                config.antibug = 'on';
                await sock.sendMessage(jid, { text: "🛡️ *Antibug protection enabled!*" }, { quoted: msg });
            } else if (target === 'off') {
                config.antibug = 'off';
                await sock.sendMessage(jid, { text: "🛡️ *Antibug protection disabled.*" }, { quoted: msg });
            }
            saveState();
        }
    },

    // 16. CLEAR
    {
        name: 'clear',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            try {
                await sock.chatModify({ delete: true, lastMessages: [msg] }, jid);
            } catch (e) { /* ignore */ }
        }
    },

    // 17. ARCHIVE
    {
        name: 'archive',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            try {
                await sock.chatModify({ archive: true, lastMessages: [msg] }, jid);
                await sock.sendMessage(jid, { text: "✅ Chat archived successfully!" }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed to archive chat: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 18. UNARCHIVE
    {
        name: 'unarchive',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            try {
                await sock.chatModify({ archive: false, lastMessages: [msg] }, jid);
                await sock.sendMessage(jid, { text: "✅ Chat unarchived successfully!" }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed to unarchive chat: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 19. AUTOVIEWSTATUS (autovs)
    {
        name: 'autoviewstatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';
            if (target === 'on') {
                config.autoviewstatus = 'on';
                await sock.sendMessage(jid, { text: "🟢 *Auto-View Status (autovs) activated!*" }, { quoted: msg });
            } else if (target === 'off') {
                config.autoviewstatus = 'off';
                await sock.sendMessage(jid, { text: "💤 *Auto-View Status (autovs) deactivated.*" }, { quoted: msg });
            }
            saveState();
        }
    },

    // 20. STATUSEMOJI
    {
        name: 'statusemoji',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide an emoji (e.g. .statusemoji 💖)" }, { quoted: msg });

            const emoji = args.trim();
            config.statusemoji = emoji;
            saveState();
            await sock.sendMessage(jid, { text: `✅ *Status reaction emoji updated to:* ${emoji}` }, { quoted: msg });
        }
    },

    // 21. AUTOREACTSTATUS (autors)
    {
        name: 'autoreactstatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';
            if (target === 'on') {
                config.autoreactstatus = 'on';
                await sock.sendMessage(jid, { text: "🟢 *Auto-React Status (autors) activated!* (Bot reacts with set emoji)" }, { quoted: msg });
            } else if (target === 'off') {
                config.autoreactstatus = 'off';
                await sock.sendMessage(jid, { text: "💤 *Auto-React Status (autors) deactivated.*" }, { quoted: msg });
            }
            saveState();
        }
    },

    // 22. BLOCK
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
            } catch (e) { /* ignore */ }
        }
    },

    // 23. UNBLOCK
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
            } catch (e) { /* ignore */ }
        }
    },

    // 24. AZA (Bank details)
    {
        name: 'aza',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const a = config.aza || { set: false };

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

            const promptText = `❌ *No Bank Details Configured!*\n\nPlease set your bank credentials first.`;
            const buttonMessage = {
                text: promptText,
                buttons: [
                    { buttonId: `${config.prefix}aza set`, buttonText: { displayText: 'Set Aza 🏦' }, type: 1 }
                ],
                headerType: 1
            };
            try {
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: `${promptText}\n\n_Use \`${config.prefix}aza set\` to configure details manually._` }, { quoted: msg });
            }
        }
    },

    // 25. TIME
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
            const tz = {
                "lagos": "Africa/Lagos", "nigeria": "Africa/Lagos",
                "london": "Europe/London", "uk": "Europe/London",
                "tokyo": "Asia/Tokyo", "japan": "Asia/Tokyo",
                "new york": "America/New_York", "ny": "America/New_York",
                "johannesburg": "Africa/Johannesburg", "sa": "Africa/Johannesburg",
                "nairobi": "Africa/Nairobi", "kenya": "Africa/Nairobi",
                "kuala lumpur": "Asia/Kuala_Lumpur", "malaysia": "Asia/Malaysia"
            }[query];

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
            } catch (err) { /* ignore */ }
        }
    },

    // 26. WEATHER (Gemini Search)
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

    // 27. DEVICE (Scanner)
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

            const device = (() => {
                if (!targetMsgId) return "UNKNOWN ❓";
                const len = targetMsgId.length;
                if (len === 20 && targetMsgId.startsWith('3A')) return "iOS (iPhone) 🍏";
                if (len === 12 || targetMsgId.startsWith('3EB0') || targetMsgId.startsWith('BAE5')) return "PC (Desktop) 💻";
                if (len === 32 || (len >= 16 && len <= 22 && !targetMsgId.startsWith('3A'))) return "Android! 🤖";
                return "UNKNOWN ❓";
            })();

            const response =
                `📱 *LIMITLESS CLIENT DEVICE LOGS* 📱\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `👤 *Intel:* \`${label} Device Detected\`\n` +
                `🛡️ *Platform OS:* \`${device}\``;

            await sock.sendMessage(jid, { text: response }, { quoted: msg });
        }
    },

    // 28. SS (Screenshot)
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
            } catch (err) { /* ignore */ }
        }
    },

    // 29. CALCULATOR
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
            } catch (err) { /* ignore */ }
        }
    },

    // 30. TRT (Translate – Gemini)
    {
        name: 'trt',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) {
                return await sock.sendMessage(jid, {
                    text: `❌ *Invalid Translation Format!*\n\n` +
                          `*Usage Options:*\n` +
                          `• \`${config.prefix}trt <target_lang>\` (by replying to the target message)\n` +
                          `• \`${config.prefix}trt <text> <target_lang>\` (direct inline translation)`
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

                if (quoted) {
                    targetLang = args.trim();
                    const rawContent = getRawMessage(quoted);
                    textToTranslate = rawContent?.conversation || rawContent?.extendedTextMessage?.text || rawContent?.imageMessage?.caption || rawContent?.videoMessage?.caption || '';
                } else {
                    const parts = args.trim().split(' ');
                    targetLang = parts[parts.length - 1];
                    textToTranslate = parts.slice(0, parts.length - 1).join(' ').trim();
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

    // 31. SPAM (Looper)
    {
        name: 'spam',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            if (!args) {
                return await sock.sendMessage(jid, {
                    text: `❌ *Usage:* \`${config.prefix}spam <number> <text>\` or reply directly to a message with \`${config.prefix}spam <number>\``
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

    // ─── 32. VV (Manual ViewOnce Decryption – ISSUE 4b FIX) ────
    {
        name: 'vv',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');

            if (!isOwner && !isSudo && !isDev) return;

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

                // ─── Send Madara GIF before decryption (kept) ──────────────
                await sock.sendMessage(jid, {
                    video: { url: "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExZzh6bzl1azdlcmlsZmM4d3hnemJuNG54bDV0b3M2N3RjZXczd254OCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/8qXJTU5oEhQZO/giphy.mp4" },
                    gifPlayback: true,
                    caption: "Hmmmmmm..."
                });

                // ─── REMOVED the extra text message ──────────────────────
                // (The line "Decrypting View-Once media... 👁️" is deleted)

                // ─── Decrypt and send directly to the same chat (not DM) ──
                const stream = await downloadContentFromMessage(viewOnceMedia, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const caption = viewOnceMedia.caption || "Decrypted View-Once media 👁️";

                if (mediaType === 'image') {
                    await sock.sendMessage(jid, { image: buffer, caption: caption });
                } else if (mediaType === 'video') {
                    await sock.sendMessage(jid, { video: buffer, mimetype: viewOnceMedia.mimetype || "video/mp4", caption: caption });
                } else if (mediaType === 'audio') {
                    await sock.sendMessage(jid, { audio: buffer, mimetype: viewOnceMedia.mimetype || "audio/ogg; codecs=opus", ptt: viewOnceMedia.ptt || false });
                }

                await sock.sendMessage(jid, { react: { text: "✓", key: msg.key } });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Decryption failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 33. KAMUI (Hardcoded prefixless decrypter – Strict Instructions)
    {
        name: 'kamui',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const cleanQuery = args ? args.trim() : '';

            if (!isOwner && !isSudo && !isDev) return;

            if (cleanQuery.startsWith(config.prefix)) return;

            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
                return await sock.sendMessage(jid, {
                    text: "❌ Reply directly to a View-Once message to decrypt it."
                }, { quoted: msg });
            }

            const rawContent = getRawMessage(quoted);
            const viewOnceMedia = rawContent?.imageMessage ||
                                  rawContent?.videoMessage ||
                                  rawContent?.audioMessage;

            if (!viewOnceMedia) {
                return await sock.sendMessage(jid, {
                    text: "❌ The replied message is not a View-Once media message."
                }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const mediaType = rawContent.imageMessage ? 'image' :
                                  (rawContent.videoMessage ? 'video' : 'audio');

                // ─── STEP 1: Activation GIF in chat ────────────────
                await sock.sendMessage(jid, {
                    video: { url: "https://media.giphy.com/media/LUnjrcDnwdbi/giphy.mp4" },
                    gifPlayback: true,
                    caption: "ＫＡＭＵＩ!!!!!!"
                });

                // ─── STEP 2: React to trigger with 🌀 ───────────────
                await sock.sendMessage(jid, {
                    react: { text: "🌀", key: msg.key }
                });

                // ─── STEP 3: Download decrypted media ──────────────
                const stream = await downloadContentFromMessage(viewOnceMedia, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const caption = viewOnceMedia.caption || "Decrypted View-Once media 👁️";
                const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');

                // ─── STEP 4: DM - Text message ──────────────────────
                await sock.sendMessage(senderJid, {
                    text: "Orae Wa Uchiha Obito 👁"
                });

                // ─── STEP 5: DM - Reverse GIF ───────────────────────
                await sock.sendMessage(senderJid, {
                    video: { url: "https://media.giphy.com/media/mzdeCXqTmG1IA/giphy.mp4" },
                    gifPlayback: true,
                    caption: "Ｋａｍｕｉ!!!! 🌀"
                });

                // ─── STEP 6: DM - Decrypted media ──────────────────
                if (mediaType === 'image') {
                    await sock.sendMessage(senderJid, { image: buffer, caption });
                } else if (mediaType === 'video') {
                    await sock.sendMessage(senderJid, {
                        video: buffer,
                        mimetype: viewOnceMedia.mimetype || "video/mp4",
                        caption
                    });
                } else if (mediaType === 'audio') {
                    await sock.sendMessage(senderJid, {
                        audio: buffer,
                        mimetype: viewOnceMedia.mimetype || "audio/ogg; codecs=opus",
                        ptt: viewOnceMedia.ptt || false
                    });
                }

            } catch (error) {
                console.error("❌ [KAMUI] Decryption failed:", error.message);
                await sock.sendMessage(jid, {
                    text: `❌ Decryption failed: ${error.message}`
                }, { quoted: msg });
            }
        }
    },

    // 34. VVS_ROUTER (Dynamic prefixless decrypter using config.vvs)
    {
        name: 'vvs_router',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const cleanQuery = args ? args.trim() : '';

            if (!isOwner && !isSudo && !isDev) return;
            if (cleanQuery.startsWith(config.prefix)) return;

            const customTrigger = config.vvs || '';
            if (!customTrigger || cleanQuery !== customTrigger) return;

            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
                return await sock.sendMessage(jid, {
                    text: "❌ Reply directly to a View-Once message to decrypt it."
                }, { quoted: msg });
            }

            const rawContent = getRawMessage(quoted);
            const viewOnceMedia = rawContent?.imageMessage ||
                                  rawContent?.videoMessage ||
                                  rawContent?.audioMessage;

            if (!viewOnceMedia) {
                return await sock.sendMessage(jid, {
                    text: "❌ The replied message is not a View-Once media message."
                }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const mediaType = rawContent.imageMessage ? 'image' :
                                  (rawContent.videoMessage ? 'video' : 'audio');

                await sock.sendMessage(jid, {
                    text: `🌀 *Activating "${customTrigger}"...* Decrypting View-Once media.`
                }, { quoted: msg });

                const stream = await downloadContentFromMessage(viewOnceMedia, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const caption = viewOnceMedia.caption || "Decrypted View-Once media 👁️";
                const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');

                if (mediaType === 'image') {
                    await sock.sendMessage(senderJid, { image: buffer, caption });
                } else if (mediaType === 'video') {
                    await sock.sendMessage(senderJid, {
                        video: buffer,
                        mimetype: viewOnceMedia.mimetype || "video/mp4",
                        caption
                    });
                } else if (mediaType === 'audio') {
                    await sock.sendMessage(senderJid, {
                        audio: buffer,
                        mimetype: viewOnceMedia.mimetype || "audio/ogg; codecs=opus",
                        ptt: viewOnceMedia.ptt || false
                    });
                }

                await sock.sendMessage(jid, {
                    text: `✅ Media decrypted and sent to your private DM, @${senderJid.split('@')[0]}.`,
                    mentions: [senderJid]
                });

            } catch (error) {
                console.error("❌ [VVS_ROUTER] Decryption failed:", error.message);
                await sock.sendMessage(jid, {
                    text: `❌ Decryption failed: ${error.message}`
                }, { quoted: msg });
            }
        }
    }, 

// ─── SETCMD – Map a sticker to a command ───────────────────────
{
    name: 'setcmd',
    isPrefixless: false,
    execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
        const jid = msg.key.remoteJid;
        if (!isOwner && !isSudo && !isDev) {
            return await sock.sendMessage(jid, { text: "❌ You are not authorized to use this command." }, { quoted: msg });
        }

        // Get the command name from args
        const commandName = args ? args.trim() : '';
        if (!commandName) {
            return await sock.sendMessage(jid, { text: "❌ Please specify a command name. Example: `.setcmd ping`" }, { quoted: msg });
        }

        // Get the sticker's SHA256 hash from the replied message
        const rawMsg = getRawMessage(msg.message);
        const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
        if (!contextInfo || !contextInfo.quotedMessage) {
            return await sock.sendMessage(jid, { text: "❌ Please reply to a sticker." }, { quoted: msg });
        }

        const quoted = contextInfo.quotedMessage;
        const stickerMsg = quoted.stickerMessage || quoted.message?.stickerMessage;
        if (!stickerMsg) {
            return await sock.sendMessage(jid, { text: "❌ The replied message is not a sticker." }, { quoted: msg });
        }

        const fileHash = stickerMsg.fileSha256?.toString('base64');
        if (!fileHash) {
            return await sock.sendMessage(jid, { text: "❌ Could not read sticker hash." }, { quoted: msg });
        }

        // Initialize stickerCommands if needed
        if (!config.stickerCommands) config.stickerCommands = {};

        // Save the mapping
        config.stickerCommands[fileHash] = commandName;
        const { setVar } = require('../vars');
        const success = setVar('stickerCommands', config.stickerCommands);
        if (!success) {
            return await sock.sendMessage(jid, { text: "❌ Failed to save mapping." }, { quoted: msg });
        }

        await sock.sendMessage(jid, { text: `✅ Sticker mapped to command: *${commandName}*` }, { quoted: msg });
    }
},

// ─── DELCMD – Remove sticker command mapping ───────────────────
{
    name: 'delcmd',
    isPrefixless: false,
    execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
        const jid = msg.key.remoteJid;
        if (!isOwner && !isSudo && !isDev) {
            return await sock.sendMessage(jid, { text: "❌ You are not authorized to use this command." }, { quoted: msg });
        }

        // Get the sticker's SHA256 hash from the replied message
        const rawMsg = getRawMessage(msg.message);
        const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
        if (!contextInfo || !contextInfo.quotedMessage) {
            return await sock.sendMessage(jid, { text: "❌ Please reply to a sticker to remove its mapping." }, { quoted: msg });
        }

        const quoted = contextInfo.quotedMessage;
        const stickerMsg = quoted.stickerMessage || quoted.message?.stickerMessage;
        if (!stickerMsg) {
            return await sock.sendMessage(jid, { text: "❌ The replied message is not a sticker." }, { quoted: msg });
        }

        const fileHash = stickerMsg.fileSha256?.toString('base64');
        if (!fileHash) {
            return await sock.sendMessage(jid, { text: "❌ Could not read sticker hash." }, { quoted: msg });
        }

        if (!config.stickerCommands || !config.stickerCommands[fileHash]) {
            return await sock.sendMessage(jid, { text: "❌ No command mapped to this sticker." }, { quoted: msg });
        }

        delete config.stickerCommands[fileHash];
        const { setVar } = require('../vars');
        const success = setVar('stickerCommands', config.stickerCommands);
        if (!success) {
            return await sock.sendMessage(jid, { text: "❌ Failed to remove mapping." }, { quoted: msg });
        }

        await sock.sendMessage(jid, { text: "✅ Sticker command mapping removed." }, { quoted: msg });
    }
}

];

// ─── ALIASES ──────────────────────────────────────────────────────

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'tostatus') aliases.push({ ...cmd, name: 'tostatus' });
    if (cmd.name === 'autoviewstatus') {
        aliases.push({ ...cmd, name: 'autovs' });
    }
    if (cmd.name === 'autoreactstatus') {
        aliases.push({ ...cmd, name: 'autors' });
    }
    if (cmd.name === 'calculator') {
        aliases.push({ ...cmd, name: 'calc' });
    }
    if (cmd.name === 'trt') {
        aliases.push({ ...cmd, name: 'translate' });
    }
});
module.exports.push(...aliases);