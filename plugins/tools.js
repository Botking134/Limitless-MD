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

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

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

async function queryGroq(messages, model = "llama-3.3-70b-versatile") {
    const apiKey = config.groqApiKey;
    if (!apiKey) throw new Error("GROQ_API_KEY is not set in config or .env");
    const response = await fetch(GROQ_BASE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, messages, temperature: 0.7 })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 1. SETPP (Bot Profile Picture - Fixed Media Pulling)
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
            if (!quoted) return await sock.sendMessage(jid, { text: "❌ Please reply to an image." }, { quoted: msg });

            const rawContent = getRawMessage(quoted);
            const imageMessage = rawContent?.imageMessage;
            if (!imageMessage) return await sock.sendMessage(jid, { text: "❌ Please reply to an image." }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const botJid = normalizeToJid(sock.user.id);
                await sock.updateProfilePicture(botJid, buffer);
                await sock.sendMessage(jid, { text: "✅ Bot profile picture has been updated!" }, { quoted: msg });
            } catch (error) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 2. TRACK (Spatial geographical locator - Fixed LID translation)
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

    // 3. GETPP (User Profile Picture - Fixed fallbacks & LID)
    {
        name: 'getpp',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let targetJid = parseTarget(msg, args) || msg.key.participant || msg.key.remoteJid || '';

            if (targetJid.endsWith('@lid')) {
                const resolved = await getPhoneJid(sock, targetJid, jid);
                if (resolved) targetJid = resolved;
            }

            try {
                let profileUrl;
                try {
                    profileUrl = await sock.profilePictureUrl(targetJid, 'image');
                } catch (err) {
                    // Fallback to low-resolution preview
                    profileUrl = await sock.profilePictureUrl(targetJid, 'preview');
                }
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

    
// 7. FW (Forwarding - Fixed Smart Parsing & Delivery)
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

            // ─── Mode 1: Direct forward with args (Smart parsing) ──────────
            if (args && !contextInfo?.stanzaId) {
                const parts = args.trim().split(' ');
                let targetJid = '';
                let textToSend = '';

                const isJidCheck = (p) => p.endsWith('@s.whatsapp.net') || p.endsWith('@g.us') || /^\d{7,15}$/.test(p);

                if (isJidCheck(parts[0])) {
                    targetJid = parts[0].includes('@') ? parts[0] : parts[0] + '@s.whatsapp.net';
                    textToSend = parts.slice(1).join(' ').trim();
                } else if (isJidCheck(parts[parts.length - 1])) {
                    targetJid = parts[parts.length - 1].includes('@') ? parts[parts.length - 1] : parts[parts.length - 1] + '@s.whatsapp.net';
                    textToSend = parts.slice(0, parts.length - 1).join(' ').trim();
                }

                if (!targetJid || !textToSend) {
                    return await sock.sendMessage(jid, { text: "❌ Format: .fw <targetNumber> <text> or reply to a message and use .fw <targetNumber>" }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(targetJid, { text: textToSend });
                    await sock.sendMessage(jid, { text: `✅ Message forwarded to ${targetJid}` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(jid, { text: `❌ Failed: ${e.message}` }, { quoted: msg });
                }
                return;
            }

            // ─── Mode 2: Reply to a message with .fw <targetNumber> (Fixed XML-not-well-formed validation) ──────
            if (contextInfo && contextInfo.stanzaId && args) {
                const cleanTarget = args.trim();
                const targetJid = cleanTarget.endsWith('@g.us') ? cleanTarget : (cleanTarget.replace(/[^0-9]/g, '') + '@s.whatsapp.net');
                if (targetJid.length < 8) return await sock.sendMessage(jid, { text: "❌ Invalid target JID." }, { quoted: msg });

                try {
                    const quotedMsg = contextInfo.quotedMessage;
                    if (!quotedMsg) return await sock.sendMessage(jid, { text: "❌ No quoted message found." }, { quoted: msg });

                    const { proto } = await import('@itsliaaa/baileys');
                    const fullMessage = proto.WebMessageInfo.create({
                        key: {
                            remoteJid: jid,
                            id: contextInfo.stanzaId,
                            // Participant is strictly forbidden on DM remoteJids
                            participant: jid.endsWith('@g.us') ? contextInfo.participant : undefined
                        },
                        message: quotedMsg
                    });

                    await sock.copyNForward(targetJid, fullMessage, true);
                    await sock.sendMessage(jid, { text: `✅ Message forwarded to ${targetJid}` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(jid, { text: `❌ Forward failed: ${e.message}` }, { quoted: msg });
                }
                return;
            }

            // ─── Mode 3: Interactive prompt (no args, reply to a message) ──
            if (contextInfo && contextInfo.stanzaId && !args) {
                const prompt = await sock.sendMessage(jid, {
                    text: "📤 *FORWARD WIZARD* 📤\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
                          "Please reply directly to *this message* with the target phone number (e.g., 2348123456789) or group JID."
                }, { quoted: msg });

                global.forwardSessions[prompt.key.id] = {
                    msgToForward: contextInfo.quotedMessage,
                    originalMsgKey: contextInfo.stanzaId,
                    originalParticipant: contextInfo.participant
                };
                return;
            }

            await sock.sendMessage(jid, { text: "❌ Usage:\n• `.fw <targetNumber> <text>`\n• Reply to a message with `.fw <targetNumber>`\n• Reply to a message and use `.fw` (interactive)" }, { quoted: msg });
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

    // 13. ANTIDELETE (Fixed Legacy Buttons)
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
                    `🛡️ *ANTIDELETE CONFIGURATION* 🛡️\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `*Current Mode:* ${statusMap[current] || '⛔ Off'}\n\n` +
                    `To update this mode, run:\n` +
                    `• \`${config.prefix}antidelete -g\` (Groups Only)\n` +
                    `• \`${config.prefix}antidelete -pm\` (DMs Only)\n` +
                    `• \`${config.prefix}antidelete -all\` (All Chats)\n` +
                    `• \`${config.prefix}antidelete -off\` (Turn Off)`;

                return await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
            }

            const mode = args.toLowerCase().trim();
            if (['-g', '-pm', '-all', '-off'].includes(mode)) {
                const cleanMode = mode.replace('-', '');
                if (!config.antidelete) config.antidelete = {};
                config.antidelete.mode = cleanMode === 'g' ? 'group' : cleanMode;
                saveState();
                const statusMap = {
                    'off': '⛔ Off',
                    'group': '🏢 Groups Only',
                    'pm': '💬 DMs Only',
                    'all': '🌐 All Chats'
                };
                const updatedMode = config.antidelete.mode;
                await sock.sendMessage(jid, { text: `✅ *Antidelete mode updated:* ${statusMap[updatedMode] || updatedMode}` }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: `❌ Invalid option. Use -g, -pm, -all, or -off.` }, { quoted: msg });
            }
        }
    },

    // 14. ANTIVIEWONCE (Fixed Legacy Buttons)
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
                    `🛡️ *ANTIVIEWONCE CONFIGURATION* 🛡️\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `*Current Mode:* ${statusMap[current] || '⛔ Off'}\n\n` +
                    `To update this mode, run:\n` +
                    `• \`${config.prefix}antiviewonce -g\` (Groups Only)\n` +
                    `• \`${config.prefix}antiviewonce -pm\` (DMs Only)\n` +
                    `• \`${config.prefix}antiviewonce -all\` (All Chats)\n` +
                    `• \`${config.prefix}antiviewonce -off\` (Turn Off)`;

                return await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
            }

            const mode = args.toLowerCase().trim();
            if (['-g', '-pm', '-all', '-off'].includes(mode)) {
                const cleanMode = mode.replace('-', '');
                if (!config.antiviewonce) config.antiviewonce = {};
                config.antiviewonce.mode = cleanMode === 'g' ? 'group' : cleanMode;
                saveState();
                const statusMap = {
                    'off': '⛔ Off',
                    'group': '🏢 Groups Only',
                    'pm': '💬 DMs Only',
                    'all': '🌐 All Chats'
                };
                const updatedMode = config.antiviewonce.mode;
                await sock.sendMessage(jid, { text: `✅ *Antiviewonce mode updated:* ${statusMap[updatedMode] || updatedMode}` }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: `❌ Invalid option. Use -g, -pm, -all, or -off.` }, { quoted: msg });
            }
        }
    },

    // 15. ANTIBUG (Fixed spam rate warnings)
    {
        name: 'antibug',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                config.antibug = 'on';
                await sock.sendMessage(jid, { text: "🛡️ *Antibug protection enabled!* (Anti-flood active: 2 msgs/sec threshold is now armed)" }, { quoted: msg });
            } else if (target === 'off') {
                config.antibug = 'off';
                await sock.sendMessage(jid, { text: "🛡️ *Antibug protection disabled.*" }, { quoted: msg });
            }
            saveState();
        }
    },

    // 16. CLEAR (Fixed light-payload serializations)
    {
        name: 'clear',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            try {
                await sock.chatModify({ delete: true, lastMessages: [{ key: msg.key, messageTimestamp: msg.messageTimestamp }] }, jid);
                await sock.sendMessage(jid, { react: { text: "✓", key: msg.key } });
            } catch (e) { /* ignore */ }
        }
    },

    // 17. ARCHIVE (Fixed light-payload serializations)
    {
        name: 'archive',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            try {
                await sock.chatModify({ archive: true, lastMessages: [{ key: msg.key, messageTimestamp: msg.messageTimestamp }] }, jid);
                await sock.sendMessage(jid, { react: { text: "✓", key: msg.key } });
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed to archive chat: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 18. UNARCHIVE (Fixed light-payload serializations)
    {
        name: 'unarchive',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;
            try {
                await sock.chatModify({ archive: false, lastMessages: [{ key: msg.key, messageTimestamp: msg.messageTimestamp }] }, jid);
                await sock.sendMessage(jid, { react: { text: "✓", key: msg.key } });
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

    // 22. BLOCK (Fixed LID translations)
    {
        name: 'block',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            let targetJid = parseTarget(msg, args);
            if (!targetJid) return;

            if (targetJid.endsWith('@lid')) {
                const resolved = await getPhoneJid(sock, targetJid, jid);
                if (resolved) targetJid = resolved;
            }

            try {
                await sock.updateBlockStatus(targetJid, 'block');
                await sock.sendMessage(jid, { react: { text: "✓", key: msg.key } });
            } catch (e) { /* ignore */ }
        }
    },

    // 23. UNBLOCK (Fixed LID translations)
    {
        name: 'unblock',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            let targetJid = parseTarget(msg, args);
            if (!targetJid) return;

            if (targetJid.endsWith('@lid')) {
                const resolved = await getPhoneJid(sock, targetJid, jid);
                if (resolved) targetJid = resolved;
            }

            try {
                await sock.updateBlockStatus(targetJid, 'unblock');
                await sock.sendMessage(jid, { react: { text: "✓", key: msg.key } });
            } catch (e) { /* ignore */ }
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

    // 26. WEATHER (Transitioned to keyless wttr.in + Groq formatting)
    {
        name: 'weather',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: "❌ Please provide a location (e.g., .weather Lagos)" }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { text: "Fetching live weather intelligence... 🌤️" }, { quoted: msg });

                const response = await axios.get(`https://wttr.in/${encodeURIComponent(args)}?format=j1`);
                const weatherData = JSON.stringify(response.data).slice(0, 4000); 

                const prompt = `Below is raw JSON weather data for "${args}". Please parse and format this into a clean, highly readable, beautiful weather forecast card with appropriate emojis. Do not output raw JSON, output only the clean weather report text.`;
                const responseText = await queryGroq([
                    { role: "system", content: "You are a professional weather assistant." },
                    { role: "user", content: `${prompt}\n\nData:\n${weatherData}` }
                ], "llama-3.3-70b-versatile");

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

    // 28. SS (Screenshot - Fixed to download rendering buffer first)
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
                await sock.sendMessage(jid, { text: "Generating website screenshot... 📸" }, { quoted: msg });
                const screenshotUrl = `https://image.thum.io/get/width/1280/crop/800/${targetUrl}`;
                
                // Fetch the rendering buffer first to force full page render
                const response = await axios.get(screenshotUrl, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data);

                await sock.sendMessage(jid, { image: buffer, caption: `📸 *Screenshot of:* \`${targetUrl}\`` }, { quoted: msg });
            } catch (err) { 
                await sock.sendMessage(jid, { text: "❌ Failed to capture screenshot." }, { quoted: msg });
            }
        }
    },

    // 29. CALCULATOR (calc - Fixed empty & syntax error handling)
    {
        name: 'calculator',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a mathematical expression. (e.g., .calc (2+3)*5)" }, { quoted: msg });
            }

            const cleanExpr = args.replace(/[^0-9+\-*/().\s]/g, '').trim();
            if (!cleanExpr) {
                return await sock.sendMessage(jid, { text: "❌ Invalid characters. Use only numbers and operators." }, { quoted: msg });
            }

            try {
                const result = Function('"use strict";return (' + cleanExpr + ')')();
                if (result === undefined || isNaN(result)) throw new Error();
                await sock.sendMessage(jid, {
                    text: `📊 *EVALUATION* 📊\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `• *Expression:* \`${cleanExpr}\`\n` +
                          `• *Result:* \`${result}\``
                }, { quoted: msg });
            } catch (err) { 
                await sock.sendMessage(jid, { text: "❌ Invalid mathematical expression." }, { quoted: msg });
            }
        }
    },

    // 30. TRT (Translate - Transitioned to Groq)
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
                await sock.sendMessage(jid, { text: "Translating via Groq... 🌐" }, { quoted: msg });

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

                const translatedText = await queryGroq([
                    { role: "system", content: "You are an expert translator." },
                    { role: "user", content: `${prompt}\n\nText:\n${textToTranslate}` }
                ], "llama-3.3-70b-versatile");

                const translationCard =
                    `🌐 *GROQ AI TRANSLATION* 🌐\n` +
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

    // 31. SPAM (Looper - Fixed media pulling using getRawMessage)
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


// 20. TOJID (Direct Group JID Status Upload)
    {
        name: 'tojid',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            // Direct permission check (bypasses missing verifyPermissions function)
            const isAuthorized = isOwner || isSudo || isDev;
            if (!isAuthorized) return;

            const argsStr = Array.isArray(args) ? args.join(' ').trim() : (args || '').trim();
            const targetJid = argsStr ? argsStr.split(' ')[0] : '';
            if (!targetJid || !targetJid.endsWith('@g.us')) {
                return await sock.sendMessage(jid, { text: "❌ Provide a valid group JID." });
            }
            const remaining = argsStr.replace(targetJid, '').trim();
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = quoted ? getRawMessage(quoted) : null;
            try {
                const { downloadContentFromMessage, prepareWAMessageMedia, generateWAMessageFromContent, proto } = await import('@itsliaaa/baileys');
                let messagePayload = {};
                let mediaType = null;
                let buffer = null;
                let caption = '';
                let targetMsg = null; // Correctly scoped outside the block

                if (rawContent?.imageMessage || rawContent?.videoMessage || rawContent?.audioMessage) {
                    mediaType = rawContent.imageMessage ? 'image' : (rawContent.videoMessage ? 'video' : 'audio');
                    targetMsg = rawContent[mediaType + 'Message'];
                    const stream = await downloadContentFromMessage(targetMsg, mediaType);
                    let buf = Buffer.from([]);
                    for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
                    buffer = buf;
                    caption = targetMsg.caption || '';
                }

                if (buffer) {
                    const mediaOptions = mediaType === 'image' ? { image: buffer, caption } :
                                       (mediaType === 'video' ? { video: buffer, caption } :
                                       { audio: buffer, mimetype: targetMsg.mimetype, ptt: targetMsg.ptt || false, seconds: targetMsg.seconds });
                    const prepared = await prepareWAMessageMedia(mediaOptions, { upload: sock.waUploadToServer });
                    const msgObj = {};
                    if (mediaType === 'image') msgObj.imageMessage = prepared.imageMessage;
                    else if (mediaType === 'video') msgObj.videoMessage = prepared.videoMessage;
                    else msgObj.audioMessage = prepared.audioMessage;
                    messagePayload = { groupStatusMessageV2: { message: msgObj } };
                } else {
                    const text = remaining || quoted?.conversation || quoted?.extendedTextMessage?.text || '';
                    if (!text) {
                        return await sock.sendMessage(jid, { text: "❌ Provide text or reply to media." });
                    }
                    const randomHex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
                    const bgColor = (0xff000000 + parseInt(randomHex, 16)) | 0; // Force signed 32-bit conversion
                    messagePayload = { groupStatusMessageV2: { message: { extendedTextMessage: { text, backgroundArgb: bgColor, font: 2 } } } };
                }

                const statusMsg = generateWAMessageFromContent(targetJid, proto.Message.fromObject(messagePayload), { userJid: sock.user.id });
                await sock.relayMessage(targetJid, statusMsg.message, { messageId: statusMsg.key.id });
                
                // Only sends the final success reaction confirmation (no intermediate processing logs)
                await sock.sendMessage(jid, { react: { text: '✓', key: msg.key } });
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${e.message}` });
            }
        }
    },




    // 32. VV (Manual ViewOnce Decryption - Fixed media pulling using getRawMessage)
    {
        name: 'vv',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
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

                await sock.sendMessage(jid, {
                    video: { url: "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExZzh6bzl1azdlcmlsZmM4d3hnemJuNG54bDV0b3M2N3RjZXczd254OCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/8qXJTU5oEhQZO/giphy.mp4" },
                    gifPlayback: true,
                    caption: "Hmmmmmm..."
                });

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

    // 33. KAMUI (ViewOnce Decrypter - Fixed media pulling using getRawMessage)
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

                await sock.sendMessage(jid, {
                    video: { url: "https://media.giphy.com/media/LUnjrcDnwdbi/giphy.mp4" },
                    gifPlayback: true,
                    caption: "ＫＡＭＵＩ!!!!!!"
                });

                await sock.sendMessage(jid, {
                    react: { text: "🌀", key: msg.key }
                });

                const stream = await downloadContentFromMessage(viewOnceMedia, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const caption = viewOnceMedia.caption || "Decrypted View-Once media 👁️";
                const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');

                await sock.sendMessage(senderJid, {
                    text: "Orae Wa Uchiha Obito 👁"
                });

                await sock.sendMessage(senderJid, {
                    video: { url: "https://media.giphy.com/media/mzdeCXqTmG1IA/giphy.mp4" },
                    gifPlayback: true,
                    caption: "Ｋａｍｕｉ!!!! 🌀"
                });

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

    // 34. SETCMD
    {
        name: 'setcmd',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) {
                return await sock.sendMessage(jid, { text: "❌ You are not authorized to use this command." }, { quoted: msg });
            }

            const commandName = args ? args.trim() : '';
            if (!commandName) {
                return await sock.sendMessage(jid, { text: "❌ Please specify a command name. Example: `.setcmd ping`" }, { quoted: msg });
            }

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

            const hashBuffer = stickerMsg.fileSha256;
            if (!hashBuffer) {
                return await sock.sendMessage(jid, { text: "❌ Could not read sticker hash." }, { quoted: msg });
            }
            const fileHash = hashBuffer.toString('base64');

            if (!config.stickerCommands) config.stickerCommands = {};

            config.stickerCommands[fileHash] = commandName;
            const { setVar } = require('../vars');
            const success = setVar('stickerCommands', config.stickerCommands);
            if (!success) {
                return await sock.sendMessage(jid, { text: "❌ Failed to save mapping." }, { quoted: msg });
            }

            saveState();
            await sock.sendMessage(jid, { text: `✅ Sticker mapped to command: *${commandName}*` }, { quoted: msg });
        }
    },

// 36. SILENT_DECRYPTER (Prefixless silent View-Once decrypter)
    {
        name: 'silent_decrypter',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const cleanQuery = args ? args.trim().toLowerCase() : '';

            // Strictly restricted to authorized users (Dev, Sudo, Owner)
            if (!isOwner && !isSudo && !isDev) return;

            // Bypass if it begins with the command prefix
            if (cleanQuery.startsWith(config.prefix)) return;

            // Trigger on the specified emoji or aliases
            const triggers = ['🥷', 'wow', 'damn', 'whoa', '🌚', '❤'];
            if (!triggers.includes(cleanQuery)) return;

            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return; // Silent exit if no quoted message is present

            const rawContent = getRawMessage(quoted);
            const viewOnceMedia = rawContent?.imageMessage ||
                                  rawContent?.videoMessage ||
                                  rawContent?.audioMessage;

            if (!viewOnceMedia) return; // Silent exit if quoted message is not View-Once

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const mediaType = rawContent.imageMessage ? 'image' :
                                  (rawContent.videoMessage ? 'video' : 'audio');

                // Resolve the sender JID (handles LID-to-Phone translation)
                let senderJid = msg.key.participant || msg.key.remoteJid || '';
                senderJid = normalizeToJid(senderJid);

                if (senderJid.endsWith('@lid')) {
                    const resolved = await getPhoneJid(sock, senderJid, jid);
                    if (resolved) senderJid = resolved;
                }

                // Download View-Once media bytes
                const stream = await downloadContentFromMessage(viewOnceMedia, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const caption = viewOnceMedia.caption || "Silently decrypted media 🥷";

                // Direct delivery to the resolved sender's DM
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

                // React to the trigger message with the ninja emoji as silent confirmation
                await sock.sendMessage(jid, {
                    react: { text: "🥷", key: msg.key }
                });

            } catch (error) {
                console.error("❌ [SILENT_DECRYPTER] Failed:", error.message);
            }
        }
    },


    // 35. DELCMD
    {
        name: 'delcmd',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) {
                return await sock.sendMessage(jid, { text: "❌ You are not authorized to use this command." }, { quoted: msg });
            }

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