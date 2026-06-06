// plugins/tools.js
const settings = require('../settings');
const { saveSettings } = require('../settingsSaver');
const path = require('path');

// Initialize presence memory config securely
if (!settings.presence) {
    settings.presence = {
        autotyping: { all: false, chats: [] },
        autorecording: { all: false, chats: [] },
        alwaysonline: { all: false, chats: [] },
        autoread: { all: false, chats: [] }
    };
}

// Initialize antidelete memory config securely
if (!settings.antidelete) {
    settings.antidelete = {
        status: 'off',
        hereJid: '',
        logDestination: 'bot' // default is 'bot'
    };
}

// Global forward sessions state memory
global.forwardSessions = global.forwardSessions || {};

// Recursive Helper to automatically unwrap ephemeral, view-once, and nested envelopes safely
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

module.exports = [
    // 1. SET BOT PROFILE PICTURE (.setpp) [Mission 3]
    {
        name: 'setpp',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;

            if (!isOwner && !isDev) return;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted || !quoted.imageMessage) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to an image to set it as the bot's profile picture." }, { quoted: msg });
            }

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                await sock.sendMessage(jid, { text: "Updating bot profile picture... 🖼️" }, { quoted: msg });

                const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                await sock.updateProfilePicture(botJid, buffer);

                await sock.sendMessage(jid, { text: "✅ Bot profile picture has been updated successfully!" }, { quoted: msg });
            } catch (error) {
                console.error("SetPP Command Error:", error);
                await sock.sendMessage(jid, { text: `❌ Failed to update profile picture: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 2. SPATIAL GEOGRAPHICAL LOCATOR (.track) [Mission 4]
    {
        name: 'track',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            let targetJid = "";
            const quoted = msg.message.extendedTextMessage?.contextInfo;

            if (quoted && quoted.participant) {
                targetJid = quoted.participant;
            } else if (quoted?.mentionedJid?.length > 0) {
                targetJid = quoted.mentionedJid[0];
            } else {
                targetJid = msg.key.remoteJid;
            }

            const phone = targetJid.split('@')[0];

            let country = "Unknown Domain";
            let coordinates = "Unavailable Spatial coordinates";

            if (phone.startsWith('234')) { country = "Nigeria 🇳🇬"; coordinates = "Lat: 9.0820, Lon: 8.6753"; }
            else if (phone.startsWith('27')) { country = "South Africa 🇿🇦"; coordinates = "Lat: -30.5595, Lon: 22.9375"; }
            else if (phone.startsWith('60')) { country = "Malaysia 🇲🇾"; coordinates = "Lat: 4.2105, Lon: 101.9758"; }
            else if (phone.startsWith('1')) { country = "United States / Canada 🇺🇸🇨🇦"; coordinates = "Lat: 37.0902, Lon: -95.7129"; }
            else if (phone.startsWith('44')) { country = "United Kingdom 🇬🇧"; coordinates = "Lat: 55.3781, Lon: -3.4360"; }
            else if (phone.startsWith('91')) { country = "India 🇮🇳"; coordinates = "Lat: 20.5937, Lon: 78.9629"; }
            else if (phone.startsWith('62')) { country = "Indonesia 🇮🇩"; coordinates = "Lat: -0.7893, Lon: 113.9213"; }
            else if (phone.startsWith('254')) { country = "Kenya 🇰🇪"; coordinates = "Lat: -1.2921, Lon: 36.8219"; }
            else if (phone.startsWith('212')) { country = "Morocco 🇲🇦"; coordinates = "Lat: 31.7917, Lon: -7.0926"; }

            try {
                const { delay } = await import('@itsliaaa/baileys');
                const loadingMsg = await sock.sendMessage(jid, { 
                    text: `👁️ *Six Eyes Space-Time Tracking...* 👁️\n━━━━━━━━━━━━━━━━━━━\n\n` +
                          `Target: @${phone}\n` +
                          `Channelling Infinity space to locate target domain... 🌀`,
                    mentions: [targetJid]
                }, { quoted: msg });

                await delay(1500);

                const report = `🎯 *SPATIAL LOCATOR MANIFESTED* 🎯\n━━━━━━━━━━━━━━━━━━━\n\n` +
                               `👤 *Target User:* @${phone}\n` +
                               `🌍 *Region:* \`${country}\`\n` +
                               `📍 *Coordinates:* \`${coordinates}\`\n` +
                               `📡 *Signal Vector:* \`Within Unlimited Void coverage\`\n` +
                               `⚡ *Scan Latency:* \`${Math.floor(Math.random() * 80) + 10}ms\`\n\n` +
                               `_“No matter where you hide inside this dimension, my Infinity can reach you.”_ 🤞`;

                await sock.sendMessage(jid, { 
                    text: report, 
                    edit: loadingMsg.key,
                    mentions: [targetJid]
                });

            } catch (error) {
                console.error("Track Command Error:", error);
            }
        }
    },

    // 3. GET USER PROFILE PICTURE (.getpp) [Mission 5]
    {
        name: 'getpp',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            let targetJid = "";
            const quoted = msg.message.extendedTextMessage?.contextInfo;

            if (quoted && quoted.participant) {
                targetJid = quoted.participant;
            } else if (quoted?.mentionedJid?.length > 0) {
                targetJid = quoted.mentionedJid[0];
            } else {
                targetJid = msg.key.remoteJid.endsWith('@g.us') ? (msg.key.participant || msg.key.remoteJid) : msg.key.remoteJid;
            }

            const targetNumber = targetJid.split('@')[0];

            try {
                const profileUrl = await sock.profilePictureUrl(targetJid, 'image');

                await sock.sendMessage(jid, { 
                    image: { url: profileUrl }, 
                    caption: `🖼️ Profile picture of @${targetNumber}`,
                    mentions: [targetJid]
                }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { 
                    text: `❌ Failed to fetch profile picture for @${targetNumber}.\n_The user may have restricted their privacy settings or does not have a profile picture._`,
                    mentions: [targetJid]
                }, { quoted: msg });
            }
        }
    },

    // 4. SET BOT PROFILE NAME (.setname <name>) [Mission 6]
    {
        name: 'setname',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;

            if (!isOwner && !isDev) return;

            if (!args) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a new display name for the bot." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: `Updating bot display name to: "${args}"... 📝` }, { quoted: msg });

                await sock.updateProfileName(args);

                settings.botName = args;
                saveSettings();

                await sock.sendMessage(jid, { text: `✅ Bot display name updated successfully to: *${args}*` }, { quoted: msg });
            } catch (error) {
                console.error("SetName Command Error:", error);
                await sock.sendMessage(jid, { text: `❌ Failed to update bot name: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 5. SAVE STATUS UPDATE (.save) [Mission 7]
    {
        name: 'save',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to the status/media you want to save." }, { quoted: msg });
            }

            const rawContent = getRawMessage(quoted);

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');

                if (rawContent.imageMessage) {
                    await sock.sendMessage(jid, { text: "Saving image status... 📥" }, { quoted: msg });
                    const stream = await downloadContentFromMessage(rawContent.imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    await sock.sendMessage(jid, { image: buffer, caption: rawContent.imageMessage.caption || "" });
                } 
                else if (rawContent.videoMessage) {
                    await sock.sendMessage(jid, { text: "Saving video status... 📥" }, { quoted: msg });
                    const stream = await downloadContentFromMessage(rawContent.videoMessage, 'video');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    const mime = rawContent.videoMessage.mimetype || "video/mp4";
                    await sock.sendMessage(jid, { video: buffer, mimetype: mime, caption: rawContent.videoMessage.caption || "" });
                } 
                else if (rawContent.audioMessage) {
                    await sock.sendMessage(jid, { text: "Saving audio status... 📥" }, { quoted: msg });
                    const stream = await downloadContentFromMessage(rawContent.audioMessage, 'audio');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    const mime = rawContent.audioMessage.mimetype || "audio/ogg; codecs=opus";
                    await sock.sendMessage(jid, { audio: buffer, mimetype: mime, ptt: rawContent.audioMessage.ptt || false });
                }
                else {
                    const text = rawContent.conversation || rawContent.extendedTextMessage?.text || "";
                    if (!text) {
                        return await sock.sendMessage(jid, { text: "❌ This format is not supported for status saving." }, { quoted: msg });
                    }
                    await sock.sendMessage(jid, { text: `📝 *Saved Text Status:*\n\n${text}` });
                }
            } catch (error) {
                console.error("Save Status Error:", error);
                await sock.sendMessage(jid, { text: `❌ Failed to save status: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 6. MANIFEST MEDIA TO STATUS UPDATE (.tostatus) [Mission 8]
    {
        name: 'tostatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;

            if (!isOwner && !isDev) return;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to the text/media you want to upload to status." }, { quoted: msg });
            }

            const rawContent = getRawMessage(quoted);

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                await sock.sendMessage(jid, { text: "Uploading to Satoru Gojo Status channel... 🚀" }, { quoted: msg });

                if (rawContent.imageMessage) {
                    const stream = await downloadContentFromMessage(rawContent.imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    await sock.sendMessage('status@broadcast', { 
                        image: buffer, 
                        caption: args || rawContent.imageMessage.caption || "" 
                    });
                } 
                else if (rawContent.videoMessage) {
                    const stream = await downloadContentFromMessage(rawContent.videoMessage, 'video');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    const mime = rawContent.videoMessage.mimetype || "video/mp4";
                    await sock.sendMessage('status@broadcast', { 
                        video: buffer, 
                        mimetype: mime, 
                        caption: args || rawContent.videoMessage.caption || "" 
                    });
                } 
                else {
                    const text = rawContent.conversation || rawContent.extendedTextMessage?.text || "";
                    if (!text) {
                        return await sock.sendMessage(jid, { text: "❌ Unsupported media format for status upload." }, { quoted: msg });
                    }
                    await sock.sendMessage('status@broadcast', { text: text });
                }

                await sock.sendMessage(jid, { text: "✅ Domain Status successfully updated!" }, { quoted: msg });

            } catch (error) {
                console.error("ToStatus Command Error:", error);
                await sock.sendMessage(jid, { text: `❌ Failed to update status: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 7. MULTI-FORM MESSAGE FORWARDING (.fw) [Mission 9]
    {
        name: 'fw',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;

            if (!isOwner && !isDev) return;

            const quoted = msg.message.extendedTextMessage?.contextInfo;

            if (quoted && quoted.stanzaId && !args) {
                const prompt = await sock.sendMessage(jid, { 
                    text: "💬 *Interactive Forward session initiated:*\n\nPlease reply directly to this prompt message with the target phone number (include country code, e.g. `23480...`)." 
                }, { quoted: msg });

                global.forwardSessions[prompt.key.id] = {
                    msgToForward: quoted.quotedMessage,
                    originalMsgKey: quoted.stanzaId,
                    originalParticipant: quoted.participant
                };
                return;
            }

            if (!quoted && args) {
                const spaceIdx = args.indexOf(' ');
                if (spaceIdx === -1) {
                    return await sock.sendMessage(jid, { text: `❌ Invalid Manual Forward format.\nUsage: \`${settings.prefix}fw <number> <text>\`` }, { quoted: msg });
                }

                const targetNumber = args.slice(0, spaceIdx).replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                const textToSend = args.slice(spaceIdx + 1).trim();

                try {
                    await sock.sendMessage(targetNumber, { text: textToSend });
                    await sock.sendMessage(jid, { text: `✅ Text successfully forwarded to @${targetNumber.split('@')[0]}`, mentions: [targetNumber] }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(jid, { text: `❌ Failed to forward message: ${e.message}` }, { quoted: msg });
                }
                return;
            }

            await sock.sendMessage(jid, { text: "❌ Reply to a message with `.fw` to forward it, or use `.fw <number> <text>` to forward manual text." }, { quoted: msg });
        }
    },

    // 8. PRESENCE DASHBOARD (.presence) [Mission 10]
    {
        name: 'presence',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const p = settings.presence;
            const autotypingStatus = p.autotyping.all ? "All Chats 🟢" : (p.autotyping.chats.includes(jid) ? "Here 🟢" : "Off 💤");
            const autorecordingStatus = p.autorecording.all ? "All Chats 🟢" : (p.autorecording.chats.includes(jid) ? "Here 🟢" : "Off 💤");
            const alwaysonlineStatus = p.alwaysonline.all ? "All Chats 🟢" : (p.alwaysonline.chats.includes(jid) ? "Here 🟢" : "Off 💤");
            const autoreadStatus = p.autoread.all ? "All Chats 🟢" : (p.autoread.chats.includes(jid) ? "Here 🟢" : "Off 💤");

            const dashboard = 
                `🕴 *PRESENCE AUTOMATION DASHBOARD* 🕴\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `⌨️ *Auto-Typing:* \`${autotypingStatus}\`\n` +
                `🎙️ *Auto-Recording:* \`${autorecordingStatus}\`\n` +
                `🌐 *Always-Online:* \`${alwaysonlineStatus}\`\n` +
                `👁️ *Auto-Read Chat:* \`${autoreadStatus}\`\n\n` +
                `💡 _Use: \`${settings.prefix}autotyping\`, \`${settings.prefix}autorecording\`, \`${settings.prefix}alwaysonline\`, or \`${settings.prefix}autoread\` followed by (on/off/all/off all) to configure individual triggers._`;

            await sock.sendMessage(jid, { text: dashboard }, { quoted: msg });
        }
    },

    // 9. INDIVIDUAL PRESENCE TRIGGER: AUTO-TYPING (.autotyping) [Mission 10]
    {
        name: 'autotyping',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                if (!settings.presence.autotyping.chats.includes(jid)) settings.presence.autotyping.chats.push(jid);
                await sock.sendMessage(jid, { text: "✅ Auto-Typing activated for *this chat alone*." }, { quoted: msg });
            } else if (target === 'off') {
                settings.presence.autotyping.chats = settings.presence.autotyping.chats.filter(id => id !== jid);
                await sock.sendMessage(jid, { text: "❌ Auto-Typing deactivated for *this chat*." }, { quoted: msg });
            } else if (target === 'all') {
                settings.presence.autotyping.all = true;
                await sock.sendMessage(jid, { text: "✅ Auto-Typing activated globally for *all chats*." }, { quoted: msg });
            } else if (target === 'off all' || target === 'offall') {
                settings.presence.autotyping.all = false;
                settings.presence.autotyping.chats = [];
                await sock.sendMessage(jid, { text: "❌ Auto-Typing deactivated globally." }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: `❌ Use:\n• \`${settings.prefix}autotyping on\`\n• \`${settings.prefix}autotyping off\`\n• \`${settings.prefix}autotyping all\`\n• \`${settings.prefix}autotyping off all\`` }, { quoted: msg });
            }
            saveSettings();
        }
    },

    // 10. INDIVIDUAL PRESENCE TRIGGER: AUTO-RECORDING (.autorecording) [Mission 10]
    {
        name: 'autorecording',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                if (!settings.presence.autorecording.chats.includes(jid)) settings.presence.autorecording.chats.push(jid);
                await sock.sendMessage(jid, { text: "✅ Auto-Recording activated for *this chat alone*." }, { quoted: msg });
            } else if (target === 'off') {
                settings.presence.autorecording.chats = settings.presence.autorecording.chats.filter(id => id !== jid);
                await sock.sendMessage(jid, { text: "❌ Auto-Recording deactivated for *this chat*." }, { quoted: msg });
            } else if (target === 'all') {
                settings.presence.autorecording.all = true;
                await sock.sendMessage(jid, { text: "✅ Auto-Recording activated globally for *all chats*." }, { quoted: msg });
            } else if (target === 'off all' || target === 'offall') {
                settings.presence.autorecording.all = false;
                settings.presence.autorecording.chats = [];
                await sock.sendMessage(jid, { text: "❌ Auto-Recording deactivated globally." }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: `❌ Use:\n• \`${settings.prefix}autorecording on\`\n• \`${settings.prefix}autorecording off\`\n• \`${settings.prefix}autorecording all\`\n• \`${settings.prefix}autorecording off all\`` }, { quoted: msg });
            }
            saveSettings();
        }
    },

    // 11. INDIVIDUAL PRESENCE TRIGGER: ALWAYS ONLINE (.alwaysonline) [Mission 10]
    {
        name: 'alwaysonline',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                if (!settings.presence.alwaysonline.chats.includes(jid)) settings.presence.alwaysonline.chats.push(jid);
                await sock.sendMessage(jid, { text: "✅ Always-Online activated for *this chat alone*." }, { quoted: msg });
            } else if (target === 'off') {
                settings.presence.alwaysonline.chats = settings.presence.alwaysonline.chats.filter(id => id !== jid);
                await sock.sendMessage(jid, { text: "❌ Always-Online deactivated for *this chat*." }, { quoted: msg });
            } else if (target === 'all') {
                settings.presence.alwaysonline.all = true;
                await sock.sendMessage(jid, { text: "✅ Always-Online activated globally for *all chats*." }, { quoted: msg });
            } else if (target === 'off all' || target === 'offall') {
                settings.presence.alwaysonline.all = false;
                settings.presence.alwaysonline.chats = [];
                await sock.sendMessage(jid, { text: "❌ Always-Online deactivated globally." }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: `❌ Use:\n• \`${settings.prefix}alwaysonline on\`\n• \`${settings.prefix}alwaysonline off\`\n• \`${settings.prefix}alwaysonline all\`\n• \`${settings.prefix}alwaysonline off all\`` }, { quoted: msg });
            }
            saveSettings();
        }
    },

    // 12. INDIVIDUAL PRESENCE TRIGGER: AUTO READ (.autoread) [Mission 10]
    {
        name: 'autoread',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                if (!settings.presence.autoread.chats.includes(jid)) settings.presence.autoread.chats.push(jid);
                await sock.sendMessage(jid, { text: "✅ Auto-Read activated for *this chat alone*." }, { quoted: msg });
            } else if (target === 'off') {
                settings.presence.autoread.chats = settings.presence.autoread.chats.filter(id => id !== jid);
                await sock.sendMessage(jid, { text: "❌ Auto-Read deactivated for *this chat*." }, { quoted: msg });
            } else if (target === 'all') {
                settings.presence.autoread.all = true;
                await sock.sendMessage(jid, { text: "✅ Auto-Read activated globally for *all chats*." }, { quoted: msg });
            } else if (target === 'off all' || target === 'offall') {
                settings.presence.autoread.all = false;
                settings.presence.autoread.chats = [];
                await sock.sendMessage(jid, { text: "❌ Auto-Read deactivated globally." }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: `❌ Use:\n• \`${settings.prefix}autoread on\`\n• \`${settings.prefix}autoread off\`\n• \`${settings.prefix}autoread all\`\n• \`${settings.prefix}autoread off all\`` }, { quoted: msg });
            }
            saveSettings();
        }
    },

    // 13. ADVANCED ANTIDELETE CONTROLLER (.antidelete) [Mission 11]
    {
        name: 'antidelete',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                settings.antidelete.status = 'on';
                await sock.sendMessage(jid, { text: "🛡️ *Anti-Delete protection activated globally* for all conversations!" }, { quoted: msg });
                saveSettings();
            } else if (target === 'off') {
                settings.antidelete.status = 'off';
                await sock.sendMessage(jid, { text: "🛡️ *Anti-Delete protection deactivated completely.*" }, { quoted: msg });
                saveSettings();
            } else if (target === 'here') {
                settings.antidelete.status = 'here';
                settings.antidelete.hereJid = jid;
                await sock.sendMessage(jid, { text: "🛡️ *Anti-Delete protection activated* for *this chat alone*." }, { quoted: msg });
                saveSettings();
            } else if (target === 'log') {
                const currentDest = settings.antidelete.logDestination || 'bot';
                const prompt = `📊 *Anti-Delete Log Configuration:*\n\n` +
                               `• *Current Destination:* \`${currentDest === 'bot' ? "Bot DM 🤖" : "Your (User) DM 👤"}\`\n\n` +
                               `Select your logging destination preference using the interactive buttons below:`;

                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}antidelete_log user`, buttonText: { displayText: 'User DM' }, type: 1 },
                        { buttonId: `${settings.prefix}antidelete_log bot`, buttonText: { displayText: 'Bot DM' }, type: 1 }
                    ],
                    headerType: 1
                };

                try {
                    await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }
            } else {
                const currentStatus = settings.antidelete.status;
                const prompt = `🛡️ *Anti-Delete Configuration:*\n\n` +
                               `• *Status:* \`${currentStatus.toUpperCase()}\`\n\n` +
                               `Select an option below to configure protection parameters:`;

                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}antidelete on`, buttonText: { displayText: 'Enable All' }, type: 1 },
                        { buttonId: `${settings.prefix}antidelete here`, buttonText: { displayText: 'Enable Here' }, type: 1 },
                        { buttonId: `${settings.prefix}antidelete off`, buttonText: { displayText: 'Disable' }, type: 1 }
                    ],
                    headerType: 1
                };

                try {
                    await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }
            }
        }
    },

    // 14. ANTIDELETE LOG CONFIG LOGGER SELECTION (.antidelete_log) [Mission 11 Helper]
    {
        name: 'antidelete_log',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'user') {
                settings.antidelete.logDestination = 'user';
                await sock.sendMessage(jid, { text: "✅ Anti-Delete log successfully redirected to *your personal DM*." }, { quoted: msg });
            } else if (target === 'bot') {
                settings.antidelete.logDestination = 'bot';
                await sock.sendMessage(jid, { text: "✅ Anti-Delete log successfully redirected to the *bot's DM*." }, { quoted: msg });
            } else {
                return;
            }
            saveSettings();
        }
    }
];

// Add structural aliases
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'fw') {
        aliases.push({ ...cmd, name: 'forward' });
    }
});
module.exports.push(...aliases);