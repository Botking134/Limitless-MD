// plugins/tools.js
const settings = require('../settings');
const { saveSettings } = require('../helpers/settingsSaver'); 
const { saveState } = require('../stateManager'); 
const { getPhoneJid, normalizeToJid } = require('../stateManager');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

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

// Standardized JID Parser
function parseTarget(msg, args) {
    if (args) {
        const cleanDigits = args.replace(/[^0-9]/g, '');
        if (cleanDigits.length >= 7) {
            return `${cleanDigits}@s.whatsapp.net`;
        }
    }

    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo;
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
    // Strip out any codec parameters (e.g. converting 'ogg; codecs=opus' into 'ogg')
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
            const contextInfo = rawMsg?.contextInfo;
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

            // Resolve LID to standard phone-number JID first to preserve tracking metrics
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

    // 5. SAVE STATUS UPDATE (Direct private DM redirection applied)
    {
        name: 'save',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo;
            const quoted = contextInfo?.quotedMessage;
            
            if (!quoted) {
                return await sock.sendMessage(jid, { text: "❌ Please reply directly to a status update." }, { quoted: msg });
            }

            const rawContent = getRawMessage(quoted);
            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');

                const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
                // Route saved media straight to the user's private DM, keeping group chats clean
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
            const contextInfo = rawMsg?.contextInfo;
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
            const contextInfo = rawMsg?.contextInfo;

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
            } else if (target === 'off') {
                settings.presence.autotyping.chats = settings.presence.autotyping.chats.filter(id => id !== jid);
            } else if (target === 'all') {
                settings.presence.autotyping.all = true;
            } else if (target === 'off all' || target === 'offall') {
                settings.presence.autotyping.all = false;
                settings.presence.auttyping.chats = [];
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
            } else if (target === 'off') {
                settings.presence.autorecording.chats = settings.presence.autorecording.chats.filter(id => id !== jid);
            } else if (target === 'all') {
                settings.presence.autorecording.all = true;
            } else if (target === 'off all' || target === 'offall') {
                settings.presence.autorecording.all = false;
                settings.presence.autorecording.chats = [];
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

            if (target === 'on') {
                if (!settings.presence.alwaysonline.chats.includes(jid)) settings.presence.alwaysonline.chats.push(jid);
            } else if (target === 'off') {
                settings.presence.alwaysonline.chats = settings.presence.alwaysonline.chats.filter(id => id !== jid);
            } else if (target === 'all') {
                settings.presence.alwaysonline.all = true;
            } else if (target === 'off all' || target === 'offall') {
                settings.presence.alwaysonline.all = false;
                settings.presence.alwaysonline.chats = [];
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

            if (target === 'on') {
                if (!settings.presence.autoread.chats.includes(jid)) settings.presence.autoread.chats.push(jid);
            } else if (target === 'off') {
                settings.presence.autoread.chats = settings.presence.autoread.chats.filter(id => id !== jid);
            } else if (target === 'all') {
                settings.presence.autoread.all = true;
            } else if (target === 'off all' || target === 'offall') {
                settings.presence.alwaysonline.all = false;
                settings.presence.autoread.chats = [];
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
            if (!isOwner && !isSudo && !isDev) return;

            if (!settings.antidelete || typeof settings.antidelete !== 'object') {
                settings.antidelete = { status: 'off', hereJid: '', logDestination: 'bot', logUserJid: '' };
            }

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'user') {
                settings.antidelete.logDestination = 'user';
                const senderJid = msg.key.participant || msg.key.remoteJid || '';
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
            if (!isOwner && !isSudo && !isDev) return; 

            if (typeof settings.antiviewonce !== 'object') {
                settings.antiviewonce = { status: 'off', hereJid: '', logDestination: 'bot', logUserJid: '' };
            }

            const parts = args ? args.toLowerCase().trim().split(' ') : [];
            const action = parts[0] || '';
            const subAction = parts[1] || '';

            if (action === 'log') {
                if (subAction === 'user') {
                    settings.antiviewonce.logDestination = 'user';
                    const senderJid = msg.key.participant || msg.key.remoteJid || '';
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
            } else if (action === 'here') {
                settings.antiviewonce.status = 'here';
                settings.antiviewonce.hereJid = jid;
            } else if (action === 'off') {
                settings.antiviewonce.status = 'off';
                settings.antiviewonce.hereJid = '';
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
            } else if (target === 'off') {
                settings.antibug = 'off';
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

    // 20. AUTOMATIC VIEW STATUS MODULE
    {
        name: 'autoviewstatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';
            if (target === 'on') {
                settings.autoviewstatus = 'on';
            } else if (target === 'off') {
                settings.autoviewstatus = 'off';
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
            if (!args) return;

            const emoji = args.trim();
            settings.statusemoji = emoji;
            saveSettings();
            saveState();
        }
    },

    // 22. AUTOMATIC REACT STATUS MODULE
    {
        name: 'autoreactstatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';
            if (target === 'on') {
                settings.autoreactstatus = 'on';
            } else if (target === 'off') {
                settings.autoreactstatus = 'off';
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

    // 27. LIVE GEOGRAPHICAL WEATHER ANALYTICS
    {
        name: 'weather',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return;

            try {
                const response = await fetch(`https://wttr.in/${encodeURIComponent(args)}?format=j1`);
                if (!response.ok) throw new Error();

                const data = await response.json();
                const current = data.current_condition?.[0];
                const area = data.nearest_area?.[0];

                if (!current) throw new Error();

                const tempC = current.temp_C;
                const tempF = current.temp_F;
                const desc = current.weatherDesc?.[0]?.value || 'Clear';
                const humidity = current.humidity;
                const wind = current.windspeedKmph;
                const feelsC = current.FeelsLikeC;
                const cityName = area?.areaName?.[0]?.value || args;
                const countryName = area?.country?.[0]?.value || '';

                const weatherReport = 
                    `🌤️ *WEATHER REPORT:* 🌤️\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `📍 *Location:* \`${cityName}, ${countryName}\`\n` +
                    `☁️ *Atmosphere:* \`${desc}\`\n` +
                    `🌡️ *Temperature:* \`${tempC}°C\` (${tempF}°F)\n` +
                    `🧘 *Real Feel:* \`${feelsC}°C\`\n` +
                    `💧 *Relative Humidity:* \`${humidity}%\`\n` +
                    `💨 *Wind Velocity:* \`${wind} Km/h\``;

                await sock.sendMessage(jid, { text: weatherReport }, { quoted: msg });
            } catch (error) {}
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
            const contextInfo = rawMsg?.contextInfo;
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
            const contextInfo = rawMsg?.contextInfo;
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

    // 31. GOOGLE TRANSLATION UTILITY (.trt / .translate)
    {
        name: 'trt',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ *Invalid Translation Format!*\n\n` +
                          `*Usage Options:*\n` +
                          `• \`${settings.prefix}trt <target_lang> <text>\` (e.g., \`${settings.prefix}trt ja hello\`)\n` +
                          `• \`${settings.prefix}trt <source>-<target> <text>\` (e.g., \`${settings.prefix}trt en-es hello\`)\n` +
                          `• \`${settings.prefix}trt <source> to <target> <text>\` (e.g., \`${settings.prefix}trt en to fr hello\`)\n` +
                          `• Reply directly to a message with \`${settings.prefix}trt <target_lang>\``
                }, { quoted: msg });
            }

            try {
                const parts = args.trim().split(' ');
                let sourceLang = 'auto';
                let targetLang = 'en';
                let textToTranslate = '';

                if (parts[0].includes('-')) {
                    const langs = parts[0].split('-');
                    sourceLang = langs[0] || 'auto';
                    targetLang = langs[1] || 'en';
                    textToTranslate = parts.slice(1).join(' ');
                } else if (parts[1]?.toLowerCase() === 'to') {
                    sourceLang = parts[0];
                    targetLang = parts[2];
                    textToTranslate = parts.slice(3).join(' ');
                } else {
                    targetLang = parts[0];
                    textToTranslate = parts.slice(1).join(' ');
                }

                const rawMsg = getRawMessage(msg.message);
                const contextInfo = rawMsg?.contextInfo;
                const quoted = contextInfo?.quotedMessage;

                if (!textToTranslate.trim() && quoted) {
                    const rawContent = getRawMessage(quoted);
                    textToTranslate = rawContent?.conversation || rawContent?.extendedTextMessage?.text || rawContent?.imageMessage?.caption || rawContent?.videoMessage?.caption || '';
                }

                if (!textToTranslate.trim()) {
                    return await sock.sendMessage(jid, { text: "❌ Please provide text to translate or reply to a message." }, { quoted: msg });
                }

                const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(textToTranslate)}`;
                
                const response = await fetch(url);
                if (!response.ok) throw new Error("Translation API failed to respond.");

                const data = await response.json();
                const translatedText = data[0].map(item => item[0]).join('').trim();

                const translationCard = 
                    `🌐 *GOOGLE TRANSLATION COMPLETED* 🌐\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `📥 *Original:* _"${textToTranslate.trim()}"_\n` +
                    `📤 *Translation:* *"${translatedText}"*\n\n` +
                    `🌐 *Language Route:* \`${sourceLang.toUpperCase()} ➔ ${targetLang.toUpperCase()}\``;

                await sock.sendMessage(jid, { text: translationCard }, { quoted: msg });

            } catch (error) {
                console.error("Translation Command Error:", error.message);
                await sock.sendMessage(jid, { text: "❌ Translation processing failed. Ensure the language codes are correct." }, { quoted: msg });
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
            const contextInfo = rawMsg?.contextInfo;
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
});
module.exports.push(...aliases);