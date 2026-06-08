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

// Initialize antidelete memory config securely as an object
if (!settings.antidelete || typeof settings.antidelete !== 'object') {
    settings.antidelete = {
        status: 'off',
        hereJid: '',
        logDestination: 'bot',
        logUserJid: ''
    };
}

// Initialize antiviewonce config securely as an object
if (!settings.antiviewonce || typeof settings.antiviewonce !== 'object') {
    settings.antiviewonce = {
        status: 'off',
        hereJid: '',
        logDestination: 'bot',
        logUserJid: ''
    };
}

// Initialize antibug config securely
if (!settings.antibug) {
    settings.antibug = 'off';
}

// Initialize autoviewstatus config securely
if (!settings.autoviewstatus) {
    settings.autoviewstatus = 'off';
}

// Initialize statusemoji config securely
if (!settings.statusemoji) {
    settings.statusemoji = '❄';
}

// Initialize autoreactstatus config securely
if (!settings.autoreactstatus) {
    settings.autoreactstatus = 'off';
}

// Initialize aza (bank details) config securely
if (!settings.aza) {
    settings.aza = {
        set: false,
        account: '',
        bank: '',
        name: ''
    };
}

// Initialize antipm config securely
if (!settings.antipm) {
    settings.antipm = 'off';
}

// Global forward sessions state memory
global.forwardSessions = global.forwardSessions || {};

// Global bank details wizard session tracker
global.azaSessions = global.azaSessions || {};

// Recursive Helper to safely unwrap messages
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

// Helper to determine the client operating system from the message ID structure [INDEX: pair.js]
function getDeviceTypeFromId(id) {
    if (!id) return "UNKNOWN";
    const len = id.length;
    
    // 1. iOS signature rules
    if (len === 20 && id.startsWith('3A')) return "iOS (iPhone) 🍏";
    
    // 2. Android signature rules
    if (len === 32) return "Android! 🤖";
    
    // 3. PC / Desktop Web signature rules
    if (len === 12 || id.startsWith('3EB0') || id.startsWith('BAE5')) return "PC (Desktop) 💻";
    
    return "UNKNOWN ❓";
}

// Standard IANA Timezone Mapping lookup table
const timezoneMap = {
    "lagos": "Africa/Lagos", "nigeria": "Africa/Lagos",
    "london": "Europe/London", "uk": "Europe/London", "england": "Europe/London",
    "tokyo": "Asia/Tokyo", "japan": "Asia/Tokyo",
    "new york": "America/New_York", "ny": "America/New_York", "usa": "America/New_York", "us": "America/New_York",
    "johannesburg": "Africa/Johannesburg", "sa": "Africa/Johannesburg", "south africa": "Africa/Johannesburg",
    "nairobi": "Africa/Nairobi", "kenya": "Africa/Nairobi",
    "kuala lumpur": "Asia/Kuala_Lumpur", "malaysia": "Asia/Kuala_Lumpur",
    "singapore": "Asia/Singapore",
    "dubai": "Asia/Dubai", "uae": "Asia/Dubai",
    "sydney": "Australia/Sydney", "australia": "Australia/Sydney",
    "paris": "Europe/Paris", "france": "Europe/Paris",
    "berlin": "Europe/Berlin", "germany": "Europe/Berlin",
    "jakarta": "Asia/Jakarta", "indonesia": "Asia/Jakarta",
    "moscow": "Europe/Moscow", "russia": "Europe/Moscow",
    "beijing": "Asia/Shanghai", "china": "Asia/Shanghai",
    "cairo": "Africa/Cairo", "egypt": "Africa/Cairo",
    "mumbai": "Asia/Kolkata", "india": "Asia/Kolkata", "delhi": "Asia/Kolkata"
};

module.exports = [
    // 1. SET BOT PROFILE PICTURE (.setpp)
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

    // 2. SPATIAL GEOGRAPHICAL LOCATOR (.track)
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

            let country = "Unknown Region";
            let carrier = "Unknown Network Operator";
            let city = "Unknown City Coordinates";
            let coordinates = "Unavailable Spatial coordinates";

            if (phone.startsWith('234')) {
                country = "Nigeria 🇳🇬";
                const prefix = phone.slice(3, 6);

                if (['803', '806', '703', '706', '813', '816', '903', '906', '913', '916'].includes(prefix)) {
                    carrier = "MTN Nigeria";
                    city = "Lagos State (Ikeja District)";
                    coordinates = "Lat: 6.5244, Lon: 3.3792";
                } else if (['802', '808', '701', '708', '812', '902', '907', '901', '912'].includes(prefix)) {
                    carrier = "Airtel Nigeria";
                    city = "FCT Abuja (Maitama District)";
                    coordinates = "Lat: 9.0765, Lon: 7.3986";
                } else if (['805', '807', '705', '811', '815', '905', '915'].includes(prefix)) {
                    carrier = "Globacom (Glo Mobile)";
                    city = "Edo State (Benin City Sector)";
                    coordinates = "Lat: 6.3350, Lon: 5.6037";
                } else if (['809', '817', '818', '909', '908'].includes(prefix)) {
                    carrier = "9mobile (EMTS)";
                    city = "Rivers State (Port Harcourt)";
                    coordinates = "Lat: 4.8156, Lon: 7.0498";
                } else {
                    carrier = "Local Cellular ISP";
                    city = "Nigeria General Area";
                    coordinates = "Lat: 9.0820, Lon: 8.6753";
                }
            }
            else if (phone.startsWith('27')) {
                country = "South Africa 🇿🇦";
                const prefix = phone.slice(2, 4);

                if (['82', '72', '76', '79', '60'].includes(prefix)) {
                    carrier = "Vodacom SA";
                    city = "Gauteng (Johannesburg)";
                    coordinates = "Lat: -26.2041, Lon: 28.0473";
                } else if (['83', '73', '78', '81', '63'].includes(prefix)) {
                    carrier = "MTN South Africa";
                    city = "Western Cape (Cape Town)";
                    coordinates = "Lat: -33.9249, Lon: 18.4241";
                } else if (['84', '74', '64'].includes(prefix)) {
                    carrier = "Cell C";
                    city = "KwaZulu-Natal (Durban)";
                    coordinates = "Lat: -29.8587, Lon: 31.0218";
                } else if (['81', '85'].includes(prefix)) {
                    carrier = "Telkom Mobile";
                    city = "Gauteng (Pretoria)";
                    coordinates = "Lat: -25.7479, Lon: 28.2293";
                } else {
                    carrier = "SA Telecom Stack";
                    city = "South Africa General";
                    coordinates = "Lat: -30.5595, Lon: 22.9375";
                }
            }
            else if (phone.startsWith('60')) {
                country = "Malaysia 🇲🇾";
                const prefix = phone.slice(2, 4);

                if (['12', '17', '111'].includes(prefix)) {
                    carrier = "Maxis / Hotlink";
                    city = "Federal Territory (Kuala Lumpur)";
                    coordinates = "Lat: 3.1390, Lon: 101.6869";
                } else if (['13', '19', '112'].includes(prefix)) {
                    carrier = "Celcom Axiata";
                    city = "Selangor (Petaling Jaya)";
                    coordinates = "Lat: 3.1073, Lon: 101.6067";
                } else if (['16', '14', '113'].includes(prefix)) {
                    carrier = "Digi Telecommunications";
                    city = "Penang (Georgetown)";
                    coordinates = "Lat: 5.4141, Lon: 100.3288";
                } else if (['18', '118'].includes(prefix)) {
                    carrier = "U Mobile";
                    city = "Johor (Johor Bahru)";
                    coordinates = "Lat: 1.4927, Lon: 103.7414";
                } else {
                    carrier = "Telekom Malaysia";
                    city = "Malaysia Area Stack";
                    coordinates = "Lat: 4.2105, Lon: 101.9758";
                }
            }
            else if (phone.startsWith('1')) { country = "United States / Canada 🇺🇸🇨🇦"; coordinates = "Lat: 37.0902, Lon: -95.7129"; carrier = "Verizon / Rogers"; city = "North America Range"; }
            else if (phone.startsWith('44')) { country = "United Kingdom 🇬🇧"; coordinates = "Lat: 55.3781, Lon: -3.4360"; carrier = "EE Mobile Ltd"; city = "London Sector"; }
            else if (phone.startsWith('91')) { country = "India 🇮🇳"; coordinates = "Lat: 20.5937, Lon: 78.9629"; carrier = "Reliance Jio / Airtel"; city = "New Delhi Core"; }
            else if (phone.startsWith('62')) { country = "Indonesia 🇮🇩"; coordinates = "Lat: -0.7893, Lon: 113.9213"; carrier = "Telkomsel"; city = "Jakarta Core"; }
            else if (phone.startsWith('254')) { country = "Kenya 🇰🇪"; coordinates = "Lat: -1.2921, Lon: 36.8219"; carrier = "Safaricom PLC"; city = "Nairobi Base"; }

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
                               `📡 *Cell Carrier:* \`${carrier}\`\n` +
                               `🏢 *Regional Hub:* \`${city}\`\n` +
                               `📍 *Coordinates:* \`${coordinates}\`\n` +
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

    // 3. GET USER PROFILE PICTURE (.getpp)
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

    // 4. SET BOT PROFILE NAME (.setname <name>)
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

    // 5. SAVE STATUS UPDATE (.save)
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

    // 6. MANIFEST MEDIA TO STATUS UPDATE (.tostatus)
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

                const activeChats = Object.keys(settings.msgCount || {}).filter(k => k.endsWith('@s.whatsapp.net'));
                const cleanOwnerNum = settings.ownerNumber.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                const selfJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                
                const statusTargets = [cleanOwnerNum, ...activeChats]
                    .filter((v, i, self) => self.indexOf(v) === i && v !== selfJid && v.endsWith('@s.whatsapp.net'));

                if (statusTargets.length === 0) {
                    statusTargets.push(cleanOwnerNum);
                }

                const payload = {};
                if (rawContent.imageMessage) {
                    const stream = await downloadContentFromMessage(rawContent.imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    payload.image = buffer;
                    payload.caption = args || rawContent.imageMessage.caption || "";
                } 
                else if (rawContent.videoMessage) {
                    const stream = await downloadContentFromMessage(rawContent.videoMessage, 'video');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    payload.video = buffer;
                    payload.mimetype = rawContent.videoMessage.mimetype || "video/mp4";
                    payload.caption = args || rawContent.videoMessage.caption || "";
                } 
                else {
                    const text = rawContent.conversation || rawContent.extendedTextMessage?.text || "";
                    if (!text) {
                        return await sock.sendMessage(jid, { text: "❌ Unsupported media format for status upload." }, { quoted: msg });
                    }
                    payload.text = text;
                    payload.backgroundColor = '#000000';
                    payload.font = 1;
                }

                try {
                    await sock.sendMessage('status@broadcast', payload, { statusJidList: statusTargets });
                } catch (statusErr) {
                    console.warn("Status upload with JID list failed, fallback to general status broadcast:", statusErr.message);
                    await sock.sendMessage('status@broadcast', payload);
                }

                await sock.sendMessage(jid, { text: "✅ Domain Status successfully updated!" }, { quoted: msg });

            } catch (error) {
                console.error("ToStatus Command Error:", error);
                await sock.sendMessage(jid, { text: `❌ Failed to update status: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 7. MULTI-FORM MESSAGE FORWARDING (.fw / .forward)
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

    // 8. PRESENCE DASHBOARD (.presence)
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

    // 9. INDIVIDUAL PRESENCE TRIGGER: AUTO-TYPING (.autotyping)
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

    // 10. INDIVIDUAL PRESENCE TRIGGER: AUTO-RECORDING (.autorecording)
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

    // 11. INDIVIDUAL PRESENCE TRIGGER: ALWAYS ONLINE (.alwaysonline)
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

    // 12. INDIVIDUAL PRESENCE TRIGGER: AUTO READ (.autoread)
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

    // 13. ADVANCED ANTIDELETE CONTROLLER (.antidelete)
    {
        name: 'antidelete',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            if (!settings.antidelete || typeof settings.antidelete !== 'object') {
                settings.antidelete = {
                    status: 'off',
                    hereJid: '',
                    logDestination: 'bot',
                    logUserJid: ''
                };
            }

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                settings.antidelete.status = 'on';
                saveSettings();
                await sock.sendMessage(jid, { text: "🛡️ *Anti-Delete protection activated globally* for all conversations!" }, { quoted: msg });
            } else if (target === 'off') {
                settings.antidelete.status = 'off';
                saveSettings();
                await sock.sendMessage(jid, { text: "🛡️ *Anti-Delete protection deactivated completely.*" }, { quoted: msg });
            } else if (target === 'here') {
                settings.antidelete.status = 'here';
                settings.antidelete.hereJid = jid;
                saveSettings();
                await sock.sendMessage(jid, { text: "🛡️ *Anti-Delete protection activated* for *this chat alone*." }, { quoted: msg });
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
                const currentStatus = settings.antidelete.status || 'off';
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

    // 14. ANTIDELETE LOG CONFIG LOGGER SELECTION (.antidelete_log)
    {
        name: 'antidelete_log',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            if (!settings.antidelete || typeof settings.antidelete !== 'object') {
                settings.antidelete = {
                    status: 'off',
                    hereJid: '',
                    logDestination: 'bot',
                    logUserJid: ''
                };
            }

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'user') {
                settings.antidelete.logDestination = 'user';
                settings.antidelete.logUserJid = msg.key.participant || msg.key.remoteJid || '';
                saveSettings();
                await sock.sendMessage(jid, { text: "✅ Anti-Delete log successfully redirected to *your personal DM*." }, { quoted: msg });
            } else if (target === 'bot') {
                settings.antidelete.logDestination = 'bot';
                settings.antidelete.logUserJid = '';
                saveSettings();
                await sock.sendMessage(jid, { text: "✅ Anti-Delete log successfully redirected to the *bot's DM*." }, { quoted: msg });
            }
        }
    },

    // 15. AUTOMATIC VIEW ONCE DECRYPT MODULE (.antiviewonce / .antivv)
    {
        name: 'antiviewonce',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            if (typeof settings.antiviewonce !== 'object') {
                settings.antiviewonce = {
                    status: 'off',
                    hereJid: '',
                    logDestination: 'bot',
                    logUserJid: ''
                };
            }

            const parts = args ? args.toLowerCase().trim().split(' ') : [];
            const action = parts[0] || '';
            const subAction = parts[1] || '';

            if (action === 'log') {
                if (subAction === 'user') {
                    settings.antiviewonce.logDestination = 'user';
                    settings.antiviewonce.logUserJid = msg.key.participant || msg.key.remoteJid || '';
                    saveSettings();
                    return await sock.sendMessage(jid, { text: "✅ Anti-ViewOnce logs successfully redirected to *your personal DM*." }, { quoted: msg });
                } else if (subAction === 'bot') {
                    settings.antiviewonce.logDestination = 'bot';
                    settings.antiviewonce.logUserJid = '';
                    saveSettings();
                    return await sock.sendMessage(jid, { text: "✅ Anti-ViewOnce logs successfully redirected to the *bot's DM*." }, { quoted: msg });
                } else {
                    const currentDest = settings.antiviewonce.logDestination || 'bot';
                    const prompt = `📊 *Anti-ViewOnce Log Configuration:*\n\n` +
                                   `• *Current Destination:* \`${currentDest === 'bot' ? "Bot DM 🤖" : "Your (User) DM 👤"}\`\n\n` +
                                   `Select your logging destination preference using the interactive buttons below:`;

                    const buttonMessage = {
                        text: prompt,
                        buttons: [
                            { buttonId: `${settings.prefix}antivv log user`, buttonText: { displayText: 'User DM' }, type: 1 },
                            { buttonId: `${settings.prefix}antivv log bot`, buttonText: { displayText: 'Bot DM' }, type: 1 }
                        ],
                        headerType: 1
                    };

                    try {
                        await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                    }
                    return;
                }
            }

            if (action === 'all' || action === 'on') {
                settings.antiviewonce.status = 'all';
                settings.antiviewonce.hereJid = '';
                saveSettings();
                return await sock.sendMessage(jid, { text: "👁️ *Anti-ViewOnce automatic decryption* activated globally for all chats!" }, { quoted: msg });
            } else if (action === 'here') {
                settings.antiviewonce.status = 'here';
                settings.antiviewonce.hereJid = jid;
                saveSettings();
                return await sock.sendMessage(jid, { text: "👁️ *Anti-ViewOnce automatic decryption* activated for *this chat alone*." }, { quoted: msg });
            } else if (action === 'off') {
                settings.antiviewonce.status = 'off';
                settings.antiviewonce.hereJid = '';
                saveSettings();
                return await sock.sendMessage(jid, { text: "👁️ *Anti-ViewOnce automatic decryption* deactivated completely." }, { quoted: msg });
            } else {
                const currentStatus = settings.antiviewonce.status || 'off';
                const prompt = `👁️ *Anti-ViewOnce Configuration:*\n\n` +
                               `• *Status:* \`${currentStatus.toUpperCase()}\`\n\n` +
                               `Select an option below to toggle automatic media extraction:`;

                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}antivv all`, buttonText: { displayText: 'Enable All' }, type: 1 },
                        { buttonId: `${settings.prefix}antivv here`, buttonText: { displayText: 'Enable Here' }, type: 1 },
                        { buttonId: `${settings.prefix}antivv off`, buttonText: { displayText: 'Disable' }, type: 1 }
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

    // 16. ANTIBUG RATE-LIMIT BLOCK PROTECTION (.antibug)
    {
        name: 'antibug',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                settings.antibug = 'on';
                await sock.sendMessage(jid, { text: "🛡️ *Anti-Bug rate-limit flood protection* activated globally!" }, { quoted: msg });
            } else if (target === 'off') {
                settings.antibug = 'off';
                await sock.sendMessage(jid, { text: "🛡️ *Anti-Bug rate-limit flood protection* deactivated completely." }, { quoted: msg });
            } else {
                const currentStatus = settings.antibug || 'off';
                const prompt = `🛡️ *Anti-Bug rate-limit protection:*\n\n` +
                               `• *Status:* \`${currentStatus.toUpperCase()}\`\n\n` +
                               `Select an option below to toggle spam-blocking triggers:`;

                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}antibug on`, buttonText: { displayText: 'Enable' }, type: 1 },
                        { buttonId: `${settings.prefix}antibug off`, buttonText: { displayText: 'Disable' }, type: 1 }
                    ],
                    headerType: 1
                };

                try {
                    await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }
            }
            saveSettings();
        }
    },

    // 17. CLEAR CHAT (.clear)
    {
        name: 'clear',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            try {
                await sock.sendMessage(jid, { text: "Clearing chat domain... 🧹" }, { quoted: msg });
                await sock.chatModify({ delete: true, lastMessages: [msg] }, jid);
            } catch (e) {
                console.error("Clear Chat Error:", e);
                await sock.sendMessage(jid, { text: `❌ Failed to clear chat: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 18. ARCHIVE CHAT (.archive)
    {
        name: 'archive',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            try {
                await sock.chatModify({ archive: true }, jid);
                await sock.sendMessage(jid, { text: "📦 Chat successfully archived." }, { quoted: msg });
            } catch (e) {
                console.error("Archive Chat Error:", e);
                await sock.sendMessage(jid, { text: `❌ Failed to archive chat: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 19. UNARCHIVE CHAT (.unarchive)
    {
        name: 'unarchive',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            try {
                await sock.chatModify({ archive: false }, jid);
                await sock.sendMessage(jid, { text: "🔓 Chat successfully unarchived." }, { quoted: msg });
            } catch (e) {
                console.error("Unarchive Chat Error:", e);
                await sock.sendMessage(jid, { text: `❌ Failed to unarchive chat: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 20. AUTOMATIC VIEW STATUS MODULE (.autoviewstatus)
    {
        name: 'autoviewstatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                settings.autoviewstatus = 'on';
                await sock.sendMessage(jid, { text: "👁️ *Auto-View Status* activated globally!" }, { quoted: msg });
            } else if (target === 'off') {
                settings.autoviewstatus = 'off';
                await sock.sendMessage(jid, { text: "👁️ *Auto-View Status* deactivated completely." }, { quoted: msg });
            } else {
                const currentStatus = settings.autoviewstatus || 'off';
                const prompt = `👁️ *Auto-View Status Configuration:*\n\n` +
                               `• *Status:* \`${currentStatus.toUpperCase()}\`\n\n` +
                               `Select an option below to toggle automatic status viewing:`;

                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}autoviewstatus on`, buttonText: { displayText: 'Enable' }, type: 1 },
                        { buttonId: `${settings.prefix}autoviewstatus off`, buttonText: { displayText: 'Disable' }, type: 1 }
                    ],
                    headerType: 1
                };

                try {
                    await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }
            }
            saveSettings();
        }
    },

    // 21. CONFIGURE STATUS REACTION EMOJI (.statusemoji)
    {
        name: 'statusemoji',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            if (!args) {
                const current = settings.statusemoji || '❄';
                return await sock.sendMessage(jid, { text: `❌ Please provide an emoji.\nExample: \`${settings.prefix}statusemoji ❄\` (Current: ${current})` }, { quoted: msg });
            }

            const emoji = args.trim();
            settings.statusemoji = emoji;
            saveSettings();

            await sock.sendMessage(jid, { text: `✅ Status reaction emoji successfully configured to: ${emoji}` }, { quoted: msg });
        }
    },

    // 22. AUTOMATIC REACT STATUS MODULE (.autoreactstatus)
    {
        name: 'autoreactstatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            const target = args ? args.toLowerCase().trim() : '';

            if (target === 'on') {
                settings.autoreactstatus = 'on';
                await sock.sendMessage(jid, { text: `✅ *Auto-React Status* activated globally using emoji: ${settings.statusemoji || '❄'}` }, { quoted: msg });
            } else if (target === 'off') {
                settings.autoreactstatus = 'off';
                await sock.sendMessage(jid, { text: "❌ *Auto-React Status* deactivated completely." }, { quoted: msg });
            } else {
                const currentStatus = settings.autoreactstatus || 'off';
                const prompt = `📊 *Auto-React Status Configuration:*\n\n` +
                               `• *Status:* \`${currentStatus.toUpperCase()}\`\n• *Current Emoji:* ${settings.statusemoji || '❄'}\n\n` +
                               `Select an option below to toggle automatic status reactions:`;

                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}autoreactstatus on`, buttonText: { displayText: 'Enable' }, type: 1 },
                        { buttonId: `${settings.prefix}autoreactstatus off`, buttonText: { displayText: 'Disable' }, type: 1 }
                    ],
                    headerType: 1
                };

                try {
                    await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }
            }
            saveSettings();
        }
    },

    // 23. CONTACT MANAGEMENT (.block)
    {
        name: 'block',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            let targetJid = "";
            const quoted = msg.message.extendedTextMessage?.contextInfo;

            if (quoted && quoted.participant) {
                targetJid = quoted.participant;
            } else if (args) {
                targetJid = args.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            }

            if (!targetJid) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a user's message or provide their phone number to block them." }, { quoted: msg });
            }

            const targetNumber = targetJid.split('@')[0];

            try {
                await sock.updateBlockStatus(targetJid, 'block');
                await sock.sendMessage(jid, { text: `✅ Successfully blocked @${targetNumber} on WhatsApp.`, mentions: [targetJid] }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed to block contact: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 24. CONTACT MANAGEMENT (.unblock)
    {
        name: 'unblock',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            let targetJid = "";
            const quoted = msg.message.extendedTextMessage?.contextInfo;

            if (quoted && quoted.participant) {
                targetJid = quoted.participant;
            } else if (args) {
                targetJid = args.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            }

            if (!targetJid) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a blocked user's message or provide their phone number to unblock them." }, { quoted: msg });
            }

            const targetNumber = targetJid.split('@')[0];

            try {
                await sock.updateBlockStatus(targetJid, 'unblock');
                await sock.sendMessage(jid, { text: `✅ Successfully unblocked @${targetNumber} on WhatsApp.`, mentions: [targetJid] }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed to unblock contact: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 25. BANK DETAILS RETRIEVAL AND CONFIGURATION WIZARD (.aza)
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

                global.azaSessions[prompt.key.id] = {
                    step: 1
                };
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

            const promptText = `❌ *No Bank Details Configured!*\n\nPlease set your bank credentials first using the interactive buttons below:`;
            
            const buttonMessage = {
                text: promptText,
                buttons: [
                    { buttonId: `${settings.prefix}aza set`, buttonText: { displayText: 'Set Details' }, type: 1 }
                ],
                headerType: 1
            };

            try {
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: `${promptText}\n\n_Use \`${settings.prefix}aza set\` to configure details manually._` }, { quoted: msg });
            }
        }
    },

    // 26. DYNAMIC GEOGRAPHICAL CLOCK (.time)
    {
        name: 'time',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                const serverTime = new Date().toLocaleString();
                return await sock.sendMessage(jid, { text: `🕒 *Current Domain Server Time:*\n\n\`${serverTime}\`\n\n_Example: \`${settings.prefix}time London\` to evaluate local clock zones._` }, { quoted: msg });
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
                    return await sock.sendMessage(jid, { text: `❌ Region \`${args}\` is unmapped or invalid inside our spatial clock zone database.` }, { quoted: msg });
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

                await sock.sendMessage(jid, { text: `🕒 *Local Clock in ${args.trim().toUpperCase()}:*\n\n\`${formatted}\`\n🌐 *Zone:* \`${tz}\`` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed to resolve time zones for \`${args}\`.` }, { quoted: msg });
            }
        }
    },

    // 27. LIVE GEOGRAPHICAL WEATHER ANALYTICS (.weather)
    {
        name: 'weather',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { text: `❌ Please provide a geographical location.\nExample: \`${settings.prefix}weather Lagos\`` }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: "Scanning global tropospheric layers... 👁️🌀" }, { quoted: msg });

                const response = await fetch(`https://wttr.in/${encodeURIComponent(args)}?format=j1`);
                if (!response.ok) {
                    throw new Error("Geographical location unmapped or offline.");
                }

                const data = await response.json();
                const current = data.current_condition?.[0];
                const area = data.nearest_area?.[0];

                if (!current) {
                    throw new Error("Tropospheric scan data blank.");
                }

                const tempC = current.temp_C;
                const tempF = current.temp_F;
                const desc = current.weatherDesc?.[0]?.value || 'Clear';
                const humidity = current.humidity;
                const wind = current.windspeedKmph;
                const feelsC = current.FeelsLikeC;
                const cityName = area?.areaName?.[0]?.value || args;
                const countryName = area?.country?.[0]?.value || '';

                const weatherReport = 
                    `🌤️ *GEOGRAPHICAL WEATHER INFERENCE:* 🌤️\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `📍 *Location:* \`${cityName}, ${countryName}\`\n` +
                    `☁️ *Atmosphere:* \`${desc}\`\n` +
                    `🌡️ *Temperature:* \`${tempC}°C\` (${tempF}°F)\n` +
                    `🧘 *Real Feel:* \`${feelsC}°C\`\n` +
                    `💧 *Relative Humidity:* \`${humidity}%\`\n` +
                    `💨 *Wind Velocity:* \`${wind} Km/h\`\n\n` +
                    `_Six Eyes scanning complete. Ambient temperatures within standard boundaries._ 🤞`;

                await sock.sendMessage(jid, { text: weatherReport }, { quoted: msg });

            } catch (error) {
                console.error("Weather Scan Error:", error);
                await sock.sendMessage(jid, { text: `❌ Tropospheric scan failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 28. DYNAMIC DEVICE SCANNER (.device / .getdevice)
    {
        name: 'device',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            let targetMsgId = msg.key.id;
            let label = "Your";

            const quoted = msg.message.extendedTextMessage?.contextInfo;
            if (quoted && quoted.stanzaId) {
                targetMsgId = quoted.stanzaId;
                label = "Target's";
            }

            const device = getDeviceTypeFromId(targetMsgId);

            const response = 
                `📱 *LIMITLESS CLIENT DEVICE LOGS* 📱\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `👤 *Intel:* \`${label} Device Detected\`\n` +
                `🛡️ *Platform OS:* \`${device}\`\n\n` +
                `_Scan analyzed natively via cryptographic message ID signatures._ 🤞`;

            await sock.sendMessage(jid, { text: response }, { quoted: msg });
        }
    },

    // 29. REAL-TIME ESPN SOCCER SCOREBOARD (.livescore)
    {
        name: 'livescore',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            try {
                await sock.sendMessage(jid, { text: "Fetching active scores from ESPN Satellites... 📡🏟️" }, { quoted: msg });

                const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard');
                if (!response.ok) throw new Error("ESPN scoreboard servers currently unreachable.");

                const data = await response.json();
                const events = data.events || [];

                if (events.length === 0) {
                    return await sock.sendMessage(jid, { text: "🏟️ *No active live matches found on the global scoreboard.*" }, { quoted: msg });
                }

                if (args) {
                    const query = args.toLowerCase().trim();
                    const match = events.find(e => e.name.toLowerCase().includes(query));

                    if (!match) {
                        return await sock.sendMessage(jid, { text: `❌ No active match on the scoreboard containing: *"${args}"*` }, { quoted: msg });
                    }

                    const comp = match.competitions?.[0] || {};
                    const status = match.status?.type?.detail || 'Ongoing';
                    const hTeam = comp.competitors?.[0] || {};
                    const aTeam = comp.competitors?.[1] || {};

                    const singleCard = 
                        `🏟️ *LIVE SOCCER MATCH SCOREBOARD* 🏟\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `⚔️ *Match:* \`${match.name}\`\n` +
                        `⏰ *Game Clock:* \`${status}\`\n\n` +
                        `🏠 *Home:* *${hTeam.team?.displayName}* — \`${hTeam.score}\`\n` +
                        `🚀 *Away:* *${aTeam.team?.displayName}* — \`${aTeam.score}\`\n\n` +
                        `_Six Eyes live scoreboard update sync ready._ 🤞`;

                    return await sock.sendMessage(jid, { text: singleCard }, { quoted: msg });
                }

                let scoreboardText = `🏟️ *GLOBAL SOCCER SCORES SUMMARY* 🏟\n`;
                scoreboardText += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

                events.slice(0, 5).forEach((event, idx) => {
                    const comp = event.competitions?.[0] || {};
                    const status = event.status?.type?.detail || 'Live';
                    const home = comp.competitors?.[0]?.team?.displayName || 'Home';
                    const homeScore = comp.competitors?.[0]?.score || '0';
                    const away = comp.competitors?.[1]?.team?.displayName || 'Away';
                    const awayScore = comp.competitors?.[1]?.score || '0';

                    scoreboardText += `${idx + 1}. *${home}* \`${homeScore}\` vs \`${awayScore}\` *${away}*\n`;
                    scoreboardText += `   ⏱️ *Clock:* \`${status}\`\n\n`;
                });

                scoreboardText += `_Use \`${settings.prefix}livescore <team>\` to search specific match parameters._`;

                await sock.sendMessage(jid, { text: scoreboardText }, { quoted: msg });

            } catch (error) {
                console.error("Livescore Error:", error);
                await sock.sendMessage(jid, { text: `❌ Failed to fetch live matches: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 30. ESPN GLOBAL FOOTBALL NEWS SCANNER (.football)
    {
        name: 'football',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            try {
                await sock.sendMessage(jid, { text: "Scanning ESPN global soccer news wires... 📝⚽" }, { quoted: msg });

                const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/news');
                if (!response.ok) throw new Error("ESPN news wires currently unreachable.");

                const data = await response.json();
                const articles = data.articles || [];

                if (articles.length === 0) {
                    return await sock.sendMessage(jid, { text: "⚽ *No football news articles currently reported on the wire.*" }, { quoted: msg });
                }

                let filtered = articles;
                let headerLabel = "GLOBAL FOOTBALL NEWS";

                if (args) {
                    const query = args.toLowerCase().trim();
                    filtered = articles.filter(art => 
                        art.headline.toLowerCase().includes(query) || 
                        art.description.toLowerCase().includes(query)
                    );
                    headerLabel = `${args.toUpperCase()} WIRE UPDATES`;
                }

                if (filtered.length === 0) {
                    return await sock.sendMessage(jid, { text: `⚽ No articles matching *"${args}"* found on ESPN's soccer wire.` }, { quoted: msg });
                }

                let newsCard = `⚽ *ESPN FOOTBALL: ${headerLabel}* ⚽\n`;
                newsCard += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

                filtered.slice(0, 3).forEach((art, idx) => {
                    newsCard += `🔥 *${idx + 1}. ${art.headline}*\n`;
                    newsCard += `💬 _${art.description || 'No description available.'}_\n\n`;
                });

                newsCard += `_News feeds fetched natively from ESPN Soccer registries._ 🤞`;

                await sock.sendMessage(jid, { text: newsCard }, { quoted: msg });

            } catch (error) {
                console.error("Football News Error:", error);
                await sock.sendMessage(jid, { text: `❌ Failed to fetch football wire news: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 31. SCREENSHOT WEBSITE TOOL (.ss)
    {
        name: 'ss',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            let targetUrl = args ? args.trim() : '';

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!targetUrl && quoted) {
                const rawContent = getRawMessage(quoted);
                targetUrl = rawContent?.conversation || rawContent?.extendedTextMessage?.text || '';
            }

            if (!targetUrl) {
                return await sock.sendMessage(jid, { text: "❌ Please provide or reply to a valid URL." }, { quoted: msg });
            }

            if (!/^https?:\/\//i.test(targetUrl)) {
                targetUrl = 'https://' + targetUrl;
            }

            try {
                await sock.sendMessage(jid, { text: `Taking website screenshot... 📸` }, { quoted: msg });

                // Direct screenshot compilation URL
                const screenshotUrl = `https://image.thum.io/get/width/1280/crop/800/${targetUrl}`;

                await sock.sendMessage(jid, { 
                    image: { url: screenshotUrl }, 
                    caption: `📸 *Screenshot of:* \`${targetUrl}\`\n\n_Rendered via Limitless system engines_` 
                }, { quoted: msg });

            } catch (err) {
                console.error("Screenshot error:", err.message);
                await sock.sendMessage(jid, { text: "❌ Failed to render screenshot." }, { quoted: msg });
            }
        }
    },

    // 32. SAFE EVALUATION CALCULATOR (.calculator / .calc)
    {
        name: 'calculator',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            if (!args) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a mathematical expression.\nExample: `⚡calc 5 + (3 * 2)`" }, { quoted: msg });
            }

            // Strictly filter expression characters to prevent remote execution
            const cleanExpr = args.replace(/[^0-9+\-*/().\s]/g, '').trim();

            if (!cleanExpr) {
                return await sock.sendMessage(jid, { text: "❌ Invalid mathematical characters detected." }, { quoted: msg });
            }

            try {
                const result = Function('"use strict";return (' + cleanExpr + ')')();

                await sock.sendMessage(jid, { 
                    text: `📊 *MATHEMATICAL EVALUATION* 📊\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `• *Expression:* \`${cleanExpr}\`\n` +
                          `• *Result:* \`${result}\`\n\n` +
                          `_Calculated securely under the Limitless sandbox_ 🤞`
                }, { quoted: msg });

            } catch (err) {
                console.error("Calculator error:", err.message);
                await sock.sendMessage(jid, { text: "❌ Invalid mathematical expression. Ensure syntax is correct." }, { quoted: msg });
            }
        }
    }
];

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'sticker') {
        aliases.push({ ...cmd, name: 's' });
    }
    if (cmd.name === 'take') {
        aliases.push({ ...cmd, name: 'steal' });
    }
    if (cmd.name === 'tourl') {
        aliases.push({ ...cmd, name: 'url' });
    }
    if (cmd.name === 'delete') {
        aliases.push({ ...cmd, name: 'del' });
        aliases.push({ ...cmd, name: 'dlt' }); 
    }
    if (cmd.name === 'tdelete') {
        aliases.push({ ...cmd, name: 'tdel' });
        aliases.push({ ...cmd, name: 'tdlt' });
    }
    if (cmd.name === 'ss') {
        aliases.push({ ...cmd, name: 'screenshot' });
    }
    if (cmd.name === 'calculator') {
        aliases.push({ ...cmd, name: 'calc' });
    }
});
module.exports.push(...aliases);