 
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

// Initialize antidelete memory config securely as an object (mindful of status & logs)
if (!settings.antidelete || typeof settings.antidelete !== 'object') {
    settings.antidelete = {
        status: 'off',
        hereJid: '',
        logDestination: 'bot',
        logUserJid: ''
    };
}

// Initialize antiviewonce config securely as an object (mindful of status & logs)
if (!settings.antiviewonce || typeof settings.antiviewonce !== 'object') {
    settings.antiviewonce = {
        status: 'off', // 'all', 'here', 'off'
        hereJid: '',
        logDestination: 'bot', // 'user', 'bot'
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

// Helper to determine the client operating system from the message ID structure
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

            // NIGERIAN PREFIX TRIANGULATION
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
            // SOUTH AFRICAN PREFIX TRIANGULATION
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
            // MALAYSIAN PREFIX TRIANGULATION
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
            // FALLBACK REGIONAL BASES
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

            // Resolve Target JID
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
                
                // Exclude selfJid from target configuration list to prevent protocol rejection
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

    // 14. ANTIDELETE LOG CONFIG LOGGER SELECTION (.antidelete_log)
    {
        name: 'antidelete_log',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            // Ensure object structure is initialized defensively
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
                // Securely records configuring user's active JID or LID for logs
                settings.antidelete.logUserJid = msg.key.participant || msg.key.remoteJid || '';
                await sock.sendMessage(jid, { text: "✅ Anti-Delete logs successfully redirected to *your personal DM*." }, { quoted: msg });
            } else if (target === 'bot') {
                settings.antidelete.logDestination = 'bot';
                settings.antidelete.logUserJid = '';
                await sock.sendMessage(jid, { text: "✅ Anti-Delete logs successfully redirected to the *bot's DM*." }, { quoted: msg });
            } else {
                return;
            }
            saveSettings();
        }
    },

    // 15. AUTOMATIC VIEW ONCE DECRYPT MODULE (.antiviewonce / .antivv)
    {
        name: 'antiviewonce',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isDev) return;

            // Defensive object check (highly mindful of previous config string values)
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

            // Handle logging destination parameters
            if (action === 'log') {
                if (subAction === 'user') {
                    settings.antiviewonce.logDestination = 'user';
                    // Saves the active configuring user's JID or LID securely
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

            // Handle active toggle configurations
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

                return await sock.sendMessage(jid, { detailsCard }, { quoted: msg });
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
    }
];

// Add structural aliases safely via external array collector
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'fw') {
        aliases.push({ ...cmd, name: 'forward' });
    }
    if (cmd.name === 'device') {
        aliases.push({ ...cmd, name: 'getdevice' });
    }
    if (cmd.name === 'antiviewonce') {
        aliases.push({ ...cmd, name: 'antivv' });
    }
});
module.exports.push(...aliases);
```

---

### 2. Updated `pair.js`

This file is now updated with the correct routing handlers, ensuring that `antidelete` and `antiviewonce` both successfully forward logs directly to your personal JID/LID when **User's DM** is chosen:

```javascript
// pair.js
const readline = require('readline');
const { Boom } = require('@hapi/boom');
const commands = require('./commands');
const settings = require('./settings');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// Global in-memory set to track message IDs sent by the bot process
const botSentMessageIds = new Set();
const devStatePath = path.join(__dirname, 'dev_state.json');

// Global Cache for deleted message tracking
global.messageStore = global.messageStore || {};

// Global Cache for spam/antibug block tracking
global.spamTracker = global.spamTracker || {};

// Global bank details wizard session tracker
global.azaSessions = global.azaSessions || {};

// Global song search and download sessions
global.songSessions = global.songSessions || {};
global.apkSessions = global.apkSessions || {};
global.shazamSessions = global.shazamSessions || {};

// Helper to calculate AFK elapsed time
function getAfkDuration(ms) {
    const seconds = Math.floor((Date.now() - ms) / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${s}s`;
}

// Recursive Helper to automatically unwrap ephemeral, view-once, and nested envelopes safely in background loops
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

// Unified Message Deletion Logger Helper (Mindful of LID and JID)
async function handleMessageDeletion(sock, originalMsg, jid, revokerJid) {
    try {
        const antideleteConfig = settings.antidelete || { status: 'off', logDestination: 'bot' };
        const status = antideleteConfig.status;

        let shouldLog = false;
        if (status === 'on') {
            shouldLog = true;
        } else if (status === 'here') {
            shouldLog = (antideleteConfig.hereJid === jid);
        }

        // Avoid logging self-deletions to prevent endless loopbacks
        if (shouldLog && !originalMsg.key.fromMe) {
            const sender = originalMsg.key.participant || originalMsg.key.remoteJid || '';
            const rawContent = getRawMessage(originalMsg.message);
            if (!rawContent) return;

            const textContent = rawContent.conversation || 
                                rawContent.extendedTextMessage?.text || 
                                rawContent.imageMessage?.caption || 
                                rawContent.videoMessage?.caption || 
                                '';

            // Highly resilient destination JID resolution (LID-Safe)
            let destJid = '';
            if (antideleteConfig.logDestination === 'user' && antideleteConfig.logUserJid) {
                destJid = antideleteConfig.logUserJid;
            } else {
                // Default to Bot's own account (LID-Safe fallback)
                destJid = sock.user.id ? (sock.user.id.split(':')[0] + (sock.user.id.includes('@lid') ? '@lid' : '@s.whatsapp.net')) : '';
                if (!destJid) {
                    destJid = settings.botJid || (settings.ownerNumber + '@s.whatsapp.net');
                }
            }

            const logHeader = `🚨 *ANTIDELETE LOG INTEL:* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `👥 *Group/Chat:* @${jid.split('@')[0]}\n` +
                              `👤 *Sender:* @${sender.split('@')[0]}\n` +
                              `🗑️ *Deleted by:* @${revokerJid.split('@')[0]}\n`;

            const { downloadContentFromMessage } = await import('@itsliaaa/baileys');

            if (rawContent.imageMessage) {
                const stream = await downloadContentFromMessage(rawContent.imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                await sock.sendMessage(destJid, { 
                    image: buffer, 
                    caption: `${logHeader}📷 *Type:* Image\n📝 *Caption:* "${textContent}"`,
                    mentions: [sender, revokerJid]
                });
            } 
            else if (rawContent.videoMessage) {
                const stream = await downloadContentFromMessage(rawContent.videoMessage, 'video');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                const mime = rawContent.videoMessage.mimetype || "video/mp4";
                await sock.sendMessage(destJid, { 
                    video: buffer, 
                    mimetype: mime,
                    caption: `${logHeader}🎥 *Type:* Video\n📝 *Caption:* "${textContent}"`,
                    mentions: [sender, revokerJid]
                });
            } 
            else if (rawContent.audioMessage) {
                const stream = await downloadContentFromMessage(rawContent.audioMessage, 'audio');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                const mime = rawContent.audioMessage.mimetype || "audio/ogg; codecs=opus";
                await sock.sendMessage(destJid, { 
                    text: `${logHeader}🎵 *Type:* Voice Note/Audio`, 
                    mentions: [sender, revokerJid] 
                });
                await sock.sendMessage(destJid, { 
                    audio: buffer, 
                    mimetype: mime, 
                    ptt: rawContent.audioMessage.ptt || false 
                });
            }
            else if (rawContent.stickerMessage) {
                const stream = await downloadContentFromMessage(rawContent.stickerMessage, 'sticker');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                await sock.sendMessage(destJid, { 
                    text: `${logHeader}🎨 *Type:* Sticker`, 
                    mentions: [sender, revokerJid] 
                });
                await sock.sendMessage(destJid, { 
                    sticker: buffer 
                });
            }
            else {
                if (textContent) {
                    await sock.sendMessage(destJid, { 
                        text: `${logHeader}💬 *Type:* Text Message\n📝 *Content:* \n\n"${textContent}"`,
                        mentions: [sender, revokerJid]
                    });
                }
            }
        }
    } catch (err) {
        console.error("❌ [ANTIDELETE] handleMessageDeletion failed:", err.message);
    }
}

async function startBot() {
    // 1. AUTO-SETUP DURING DEPLOYMENT
    if (!fs.existsSync(path.join(__dirname, '.git'))) {
        console.log("⚙️ [GIT AUTO-SETUP] No .git tracking directory found. Attempting automatic setup...");
        const repoUrl = "https://github.com/Botking134/Limitless-MD.git";
        const { execSync } = require('child_process');
        
        try {
            execSync(`git init && git remote add origin ${repoUrl} && git fetch origin && (git checkout -f main || git checkout -f master)`);
            console.log("✅ [GIT AUTO-SETUP] Git successfully initialized and linked automatically.");
        } catch (setupError) {
            console.error("❌ [GIT AUTO-SETUP] Automatic git initialization failed:", setupError.message);
        }
    }

    const { 
        default: makeWASocket, 
        useMultiFileAuthState, 
        delay, 
        Browsers, 
        DisconnectReason 
    } = await import('@itsliaaa/baileys');

    const BASE_DEVS = ["27713655070", "601129363700", "2347059092107", "2347040401291"];
    if (!Array.isArray(settings.devs)) {
        settings.devs = [...BASE_DEVS];
    } else {
        BASE_DEVS.forEach(dev => {
            if (!settings.devs.includes(dev)) settings.devs.push(dev);
        });
    }

    settings.devLids = [];

    try {
        if (fs.existsSync(devStatePath)) {
            settings.devLids = JSON.parse(fs.readFileSync(devStatePath, 'utf-8'));
            console.log(`📡 [DEV LIDS] Loaded ${settings.devLids.length} developer LIDs from dev_state.json`);
        }
    } catch (e) {
        console.error("Failed to load dev_state.json:", e.message);
    }

    const { state, saveCreds } = await useMultiFileAuthState('session_auth');
    let targetNumber = null;

    if (!state.creds.registered) {
        console.log(`\n========================================`);
        console.log(`👑 ${settings.botName.toUpperCase()} PAIRING SYSTEM`);
        console.log(`========================================`);
        console.log('👉 Enter your WhatsApp number with country code (e.g. 2348012345678):');
        
        let numberInput = await question('');
        targetNumber = numberInput.replace(/[^0-9]/g, '');

        if (!targetNumber) {
            console.log('❌ Invalid number format. Please restart the bot.');
            process.exit(1);
        }
    }

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: require('pino')({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome')
    });

    // Wrapped sendMessage with simulated auto-typing and auto-recording delays
    const originalSendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = async (jid, content, options) => {
        if (settings.presence && !jid.endsWith('@broadcast')) {
            const autotypingActive = settings.presence.autotyping.all || settings.presence.autotyping.chats.includes(jid);
            const autorecordingActive = settings.presence.autorecording.all || settings.presence.autorecording.chats.includes(jid);

            try {
                if (autorecordingActive) {
                    await sock.sendPresenceUpdate('recording', jid);
                    await delay(1500); 
                    await sock.sendPresenceUpdate('paused', jid);
                } else if (autotypingActive) {
                    await sock.sendPresenceUpdate('composing', jid);
                    await delay(1200); 
                    await sock.sendPresenceUpdate('paused', jid);
                }
            } catch (presErr) {}
        }

        const sent = await originalSendMessage(jid, content, options);
        if (sent && sent.key && sent.key.id) {
            botSentMessageIds.add(sent.key.id);
            if (botSentMessageIds.size > 500) {
                const firstKey = botSentMessageIds.values().next().value;
                botSentMessageIds.delete(firstKey);
            }
        }
        return sent;
    };

    sock.ev.on('creds.update', saveCreds);

    let pairingCodeRequested = false;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (targetNumber && !pairingCodeRequested) {
            pairingCodeRequested = true;
            console.log('🔄 Connecting to WhatsApp servers...');
            await delay(5000); 
            
            try {
                const code = await sock.requestPairingCode(targetNumber, "INFINITY");
                console.log(`\n🔑 Your Pairing Code: \x1b[32m\x1b[1m${code}\x1b[0m`);
                console.log(`👉 Open WhatsApp -> Linked Devices -> Link with Phone Number to input it.\n`);
            } catch (error) {
                console.error('❌ Failed to request a pairing code from WhatsApp:', error);
                pairingCodeRequested = false; 
            }
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`\n🔌 Socket Connection Closed. Status Code: ${reason}`);
            
            if (reason === DisconnectReason.loggedOut) {
                console.log('❌ Device logged out. Please delete the "session_auth" folder and run again.');
                process.exit(1);
            } else {
                console.log(`🔄 Attempting system restart in 5 seconds...`);
                setTimeout(() => {
                    startBot();
                }, 5000); 
            }
        } else if (connection === 'open') {
            console.log(`\n========================================`);
            console.log(`✅ SUCCESS: ${settings.botName} is officially ONLINE!`);
            console.log(`🛡️  System Creator secured: ${settings.ownerName}`);
            console.log(`========================================\n`);

            if (sock.user && sock.user.id) {
                try {
                    const resolved = await sock.findUserId(sock.user.id);
                    if (resolved) {
                        settings.botJid = resolved.phoneNumber;
                        settings.botLid = resolved.lid;
                        console.log(`📡 [BOT JIDS] Resolved Phone: ${settings.botJid} | LID: ${settings.botLid}`);
                    }
                } catch (err) {
                    console.error("⚠️ [BOT JIDS] Self-JID resolution failed:", err.message);
                }
            }

            // Always-Online presence broadcast loop (evaluated every 15 seconds)
            setInterval(async () => {
                if (settings.presence && settings.presence.alwaysonline?.all) {
                    try {
                        await sock.sendPresenceUpdate('available');
                    } catch (e) {}
                }
            }, 15000);

            // AUTOMATED 3-HOUR LOG SUMMARIZER SCHEDULER
            let lastTriggeredHour = -1;
            setInterval(async () => {
                const now = new Date();
                const watHour = (now.getUTCHours() + 1) % 24; 
                const watMinute = now.getUTCMinutes();

                if (watHour % 3 === 0 && watMinute === 0 && lastTriggeredHour !== watHour) {
                    lastTriggeredHour = watHour;

                    if (settings.gclogActive) {
                        for (const gJid of Object.keys(settings.gclogActive)) {
                            if (settings.gclogActive[gJid] === true) {
                                const logs = settings.conversationLogs?.[gJid] || [];
                                
                                if (logs.length > 0) {
                                    try {
                                        const logString = logs.map(l => `[${new Date(l.time).toLocaleTimeString()}] ${l.sender}: ${l.text}`).join('\n');
                                        
                                        const s1 = "gsk_";
                                        const s2 = "tPB0xMyZ2oijloaBNcDs";
                                        const s3 = "WGdyb3FY5iC2p9hwRE";
                                        const s4 = "SIJXAV3t53LZg9";
                                        const GROQ_API_KEY = s1 + s2 + s3 + s4;

                                        const systemPrompt = 
                                            "You are Satoru Gojo from Jujutsu Kaisen. Analyze this group log from the last 3 hours " +
                                            "and provide a highly engaging, cocky, and playful summary of topics, drama, or decisions. Keep it brief.";
                                        
                                        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                                            method: "POST",
                                            headers: {
                                                "Content-Type": "application/json",
                                                "Authorization": `Bearer ${GROQ_API_KEY}`
                                            },
                                            body: JSON.stringify({
                                                model: "llama-3.3-70b-versatile",
                                                messages: [
                                                    { role: "system", content: systemPrompt },
                                                    { role: "user", content: logString }
                                                ]
                                            })
                                        });

                                        if (response.ok) {
                                            const data = await response.json();
                                            const summary = data.choices?.[0]?.message?.content || "";
                                            
                                            if (summary) {
                                                const timeSuffix = watHour === 0 ? '12 AM' : watHour === 12 ? '12 PM' : watHour > 12 ? `${watHour - 12} PM` : `${watHour} AM`;
                                                
                                                await sock.sendMessage(gJid, {
                                                    text: `🤞 *AUTOMATED 3-HOUR DOMAIN SUMMARY* 🤞\n` +
                                                          `⏰ *Nigeria Time:* ${timeSuffix} WAT\n` +
                                                          `━━━━━━━━━━━━━━━━━━━\n\n${summary}`
                                                });
                                                settings.conversationLogs[gJid] = [];
                                            }
                                        }
                                    } catch (e) {
                                        console.error("Auto GCLOG execution error:", e.message);
                                    }
                                }
                            }
                        }
                    }
                }
            }, 30 * 1000);

            try {
                const ownerJid = `${settings.ownerNumber}@s.whatsapp.net`;
                await sock.sendMessage(ownerJid, {
                    text: `🔵 *${settings.botName.toUpperCase()} ACTIVE* 🔴\n\n` +
                          `*“Throughout Heaven and Earth,* \n` +
                          `*I alone am the honoured one.”* 🤞🌎\n\n` +
                          `━━━━━━━━━━━━━━━━━━━\n` +
                          `🤖 *Bot Name:* ${settings.botName}\n` +
                          `👤 *Creator:* ${settings.ownerName}\n` +
                          `📡 *Status:* Connection Secured & Ready`
                });
                console.log(`📩 [NOTIFIER] Sent Gojo-themed connection message to owner's DM.`);
            } catch (err) {
                console.error(`⚠️ [NOTIFIER] Failed to send connection message to owner:`, err.message);
            }
        }
    });

    // Fallback Message Deletion Interceptor (messages.update)
    sock.ev.on('messages.update', async (updates) => {
        try {
            for (const update of updates) {
                if (update.update.message === null) {
                    const deletedMsgId = update.key.id;
                    const jid = update.key.remoteJid;

                    if (global.messageStore && global.messageStore[deletedMsgId]) {
                        const originalMsg = global.messageStore[deletedMsgId];
                        await handleMessageDeletion(sock, originalMsg, jid, update.key.participant || update.key.remoteJid || '');
                    }
                }
            }
        } catch (e) {
            console.error("❌ [ANTIDELETE] Failed to intercept update stream:", e.message);
        }
    });

    // Message stream handler
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const msg = chatUpdate.messages[0];
            if (!msg.message) return; 

            const jid = msg.key.remoteJid;
            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const senderNumber = senderJid.split('@')[0]; 
            const isGroup = jid.endsWith('@g.us');
            
            const botJid = settings.botJid || (sock.user?.id ? (sock.user.id.includes('@lid') ? '' : sock.user.id.replace(/:.*/, '') + '@s.whatsapp.net') : '');
            const botLid = settings.botLid || (sock.user?.id ? (sock.user.id.includes('@lid') ? sock.user.id.replace(/:.*/, '') + '@lid' : '') : '');

            if (!Array.isArray(settings.devs)) {
                settings.devs = ["27713655070", "601129363700", "2347059092107", "2347040401291"];
            }

            if (!Array.isArray(settings.devLids)) {
                settings.devLids = [];
            }

            let isDev = settings.devs.includes(senderNumber);
            if (!isDev && senderJid.endsWith('@lid')) {
                try {
                    const resolved = await sock.findUserId(senderJid);
                    if (resolved && resolved.phoneNumber) {
                        const resolvedNumber = resolved.phoneNumber.split('@')[0];
                        isDev = settings.devs.includes(resolvedNumber);
                        
                        if (isDev && !settings.devLids.includes(senderJid)) {
                            settings.devLids.push(senderJid);
                            try {
                                fs.writeFileSync(devStatePath, JSON.stringify(settings.devLids, null, 2), 'utf-8');
                                console.log(`📡 [DEV LIDS] Dynamic developer LID saved to dev_state.json: ${senderJid}`);
                            } catch (e) {
                                console.error("Failed to save dev_state.json:", e.message);
                            }
                        }
                    }
                } catch (e) {
                    console.error("LID Dev Resolution Error:", e.message);
                }
            }

            const isBanned = Array.isArray(settings.banned) && settings.banned.includes(senderNumber);
            if (isBanned) return;

            if (msg.key.fromMe && botSentMessageIds.has(msg.key.id)) return; 

            let body = msg.message.conversation || 
                       msg.message.extendedTextMessage?.text || 
                       msg.message.buttonsResponseMessage?.selectedButtonId || 
                       msg.message.templateButtonReplyMessage?.selectedId || 
                       '';

            if (msg.message.stickerMessage) {
                const fileHash = msg.message.stickerMessage.fileSha256?.toString('base64');
                if (fileHash && settings.stickerCommands && settings.stickerCommands[fileHash]) {
                    let mapped = settings.stickerCommands[fileHash];
                    if (!mapped.startsWith(settings.prefix) && !['speed', 'kamui', 'gojo'].includes(mapped.toLowerCase())) {
                        mapped = settings.prefix + mapped;
                    }
                    body = mapped;
                }
            }

            const trimmedMessage = body.trim();
            const lowerMessage = trimmedMessage.toLowerCase();

            // Populate global message store cache
            global.messageStore[msg.key.id] = msg;
            const storeKeys = Object.keys(global.messageStore);
            if (storeKeys.length > 1000) {
                delete global.messageStore[storeKeys[0]]; 
            }

            if (!Array.isArray(settings.owners)) {
                settings.owners = [settings.ownerNumber];
            }

            const isOwner = isDev || senderNumber === settings.ownerNumber || settings.owners.includes(senderNumber) || msg.key.fromMe; 
            const isSudo = Array.isArray(settings.sudo) && settings.sudo.includes(senderNumber);
            const isAuthorized = isOwner || isSudo;

            // 1. AUTOMATED STATUS BROADCAST OBSERVER
            if (jid === 'status@broadcast') {
                if (settings.autoviewstatus === 'on') {
                    try {
                        await sock.readMessages([msg.key]);
                    } catch (e) {}
                }
                if (settings.autoreactstatus === 'on') {
                    try {
                        const emoji = settings.statusemoji || '❄';
                        await sock.sendMessage('status@broadcast', { react: { text: emoji, key: msg.key } });
                    } catch (e) {}
                }
                return; 
            }

            // Primary Message Deletion Interceptor (protocolMessage REVOKE)
            const protocolMessage = msg.message?.protocolMessage;
            if (protocolMessage && (protocolMessage.type === 0 || protocolMessage.type === 'REVOKE')) {
                const deletedMsgId = protocolMessage.key?.id;
                if (deletedMsgId && global.messageStore && global.messageStore[deletedMsgId]) {
                    const originalMsg = global.messageStore[deletedMsgId];
                    await handleMessageDeletion(sock, originalMsg, jid, msg.key.participant || msg.key.remoteJid || '');
                }
                return;
            }

            // 2. ANTIBUG RATE-LIMIT FLOOD INTERCEPTOR
            if (settings.antibug === 'on' && !isAuthorized && !msg.key.fromMe) {
                const now = Date.now();
                if (!global.spamTracker[senderNumber]) {
                    global.spamTracker[senderNumber] = [];
                }
                global.spamTracker[senderNumber].push(now);

                global.spamTracker[senderNumber] = global.spamTracker[senderNumber].filter(t => now - t <= 3000);

                if (global.spamTracker[senderNumber].length >= 5) {
                    try {
                        await sock.sendMessage(jid, { 
                            text: `can't bypass my infinity huh? @${senderNumber}`, 
                            mentions: [senderJid] 
                        }, { quoted: msg });

                        await sock.updateBlockStatus(senderJid, 'block');
                        await sock.chatModify({ delete: true, lastMessages: [msg] }, jid);
                        delete global.spamTracker[senderNumber];
                    } catch (blockErr) {
                        console.error("Antibug blocking failed:", blockErr.message);
                    }
                    return; 
                }
            }

            // 3. CHAT INTERCEPTOR: Resolve active interactive forward sessions
            const quotedMsgId = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
            if (quotedMsgId && global.forwardSessions && global.forwardSessions[quotedMsgId]) {
                const session = global.forwardSessions[quotedMsgId];
                
                const parsedNumber = trimmedMessage.replace(/[^0-9]/g, '');
                if (parsedNumber.length < 7) {
                    await sock.sendMessage(jid, { text: "❌ Invalid target phone number format. Please ensure country code is included." }, { quoted: msg });
                    return;
                }

                const targetDestJid = `${parsedNumber}@s.whatsapp.net`;
                
                try {
                    await sock.sendMessage(jid, { text: `Forwarding content to @${parsedNumber}... ⏳`, mentions: [targetDestJid] }, { quoted: msg });
                    
                    await sock.sendMessage(targetDestJid, { 
                        forward: { 
                            key: { id: session.originalMsgKey, remoteJid: jid, participant: session.originalParticipant }, 
                            message: session.msgToForward 
                        } 
                    });

                    await sock.sendMessage(jid, { text: `✅ Message forwarded successfully to @${parsedNumber}!`, mentions: [targetDestJid] }, { quoted: msg });
                    delete global.forwardSessions[quotedMsgId];
                } catch (e) {
                    await sock.sendMessage(jid, { text: `❌ Forwarding session failed: ${e.message}` }, { quoted: msg });
                }
                return; 
            }

            // 4. CHAT INTERCEPTOR: Resolve active bank details configuration wizard sessions
            if (quotedMsgId && global.azaSessions && global.azaSessions[quotedMsgId] && isAuthorized) {
                const session = global.azaSessions[quotedMsgId];
                
                if (session.step === 1) {
                    const cleanNum = trimmedMessage.replace(/[^0-9]/g, '');
                    if (cleanNum.length < 5) {
                        await sock.sendMessage(jid, { text: "❌ *Invalid Account Number!*\n\nThe account number must be at least 5 digits long. Please reply to the original Step 1 message again with a valid number." }, { quoted: msg });
                        return;
                    }

                    const prompt = await sock.sendMessage(jid, { 
                        text: `🏦 *BANK DETAILS CONFIGURATION WIZARD* 🏦\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `• *Step 2:* Excellent. Now, please reply directly to *this message* with your *Bank Name* (e.g., Sterling Bank, Access Bank).` 
                    }, { quoted: msg });

                    global.azaSessions[prompt.key.id] = {
                        step: 2,
                        account: cleanNum
                    };
                    delete global.azaSessions[quotedMsgId];
                    return;
                }

                if (session.step === 2) {
                    const bankName = trimmedMessage.trim();
                    if (bankName.length < 2) {
                        await sock.sendMessage(jid, { text: "❌ *Invalid Bank Name!*\n\nPlease reply directly to the Step 2 message with a valid bank name." }, { quoted: msg });
                        return;
                    }

                    const prompt = await sock.sendMessage(jid, { 
                        text: `🏦 *BANK DETAILS CONFIGURATION WIZARD* 🏦\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `• *Step 3:* Almost done. Now, please reply directly to *this message* with your *Full Name* as it appears on the bank account.` 
                    }, { quoted: msg });

                    global.azaSessions[prompt.key.id] = {
                        step: 3,
                        account: session.account,
                        bank: bankName
                    };
                    delete global.azaSessions[quotedMsgId];
                    return;
                }

                if (session.step === 3) {
                    const fullName = trimmedMessage.trim();
                    if (fullName.length < 3) {
                        await sock.sendMessage(jid, { text: "❌ *Invalid Full Name!*\n\nPlease reply directly to the Step 3 message with your actual full name." }, { quoted: msg });
                        return;
                    }

                    settings.aza = {
                        set: true,
                        account: session.account,
                        bank: session.bank,
                        name: fullName
                    };
                    const { saveSettings } = require('./settingsSaver');
                    saveSettings();

                    await sock.sendMessage(jid, { 
                        text: `✅ *Bank Details Setup Complete!* 🏦\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `👤 *NAME:* \`${fullName}\`\n` +
                              `🏦 *BANK:* \`${session.bank}\`\n` +
                              `💳 *ACCOUNT NO:* \`${session.account}\`` 
                    }, { quoted: msg });

                    delete global.azaSessions[quotedMsgId];
                    return;
                }
            }

            // 5. CHAT INTERCEPTOR: Resolve active song selection download sessions
            if (quotedMsgId && global.songSessions && global.songSessions[quotedMsgId]) {
                const session = global.songSessions[quotedMsgId];
                const index = parseInt(trimmedMessage.trim());

                if (!isNaN(index) && index >= 1 && index <= session.results.length) {
                    const chosen = session.results[index - 1];
                    delete global.songSessions[quotedMsgId]; // Clean up memory

                    await sock.sendMessage(jid, { text: `📥 *Downloading selected song:* "${chosen.title}"...` }, { quoted: msg });

                    try {
                        const response = await fetch(`https://apis.davidcyril.name.ng/play?query=${encodeURIComponent(chosen.title)}`);
                        if (!response.ok) throw new Error("API failed to respond.");

                        const data = await response.json();
                        if (data.status && data.result) {
                            const downloadUrl = data.result.download_url;
                            if (downloadUrl) {
                                await sock.sendMessage(jid, {
                                    audio: { url: downloadUrl },
                                    mimetype: 'audio/mpeg',
                                    ptt: false
                                }, { quoted: msg });
                                return;
                            }
                        }
                        throw new Error("Download link empty in API response.");
                    } catch (err) {
                        console.error("Song Downloader Interceptor Error:", err);
                        await sock.sendMessage(jid, { text: `❌ Failed to download song: ${err.message}` }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { text: `❌ Invalid choice. Please reply with a number between 1 and ${session.results.length}.` }, { quoted: msg });
                }
                return; 
            }

            // 6. CHAT INTERCEPTOR: Resolve active APK selection download sessions
            if (quotedMsgId && global.apkSessions && global.apkSessions[quotedMsgId]) {
                const session = global.apkSessions[quotedMsgId];
                const index = parseInt(trimmedMessage.trim());

                if (!isNaN(index) && index >= 1 && index <= session.results.length) {
                    const chosen = session.results[index - 1];
                    delete global.apkSessions[quotedMsgId]; // Clean up memory

                    await sock.sendMessage(jid, { text: `📥 *Downloading selected APK:* "${chosen.name}"...` }, { quoted: msg });

                    try {
                        const response = await fetch(`https://apis.davidcyril.name.ng/apkdl?id=${encodeURIComponent(chosen.id)}`);
                        if (!response.ok) throw new Error("API failed to respond.");

                        const data = await response.json();
                        
                        const result = data.result || data;
                        const downloadUrl = result.download_url || result.downloadUrl || result.link || result.url;
                        const appName = result.name || result.app_name || chosen.name;
                        const version = result.version || "N/A";
                        const size = result.size || "Unknown";

                        if (downloadUrl) {
                            const cap = `📦 *APK COMPLETED* 📦\n━━━━━━━━━━━━━━━━━━━\n\n` +
                                        `📌 *Name:* ${appName}\n` +
                                        `⚙️ *Version:* ${version}\n` +
                                        `⚖️ *Size:* ${size}\n\n` +
                                        `_Downloaded via Satoru Gojo_ 🤞`;

                            await sock.sendMessage(jid, {
                                document: { url: downloadUrl },
                                mimetype: "application/vnd.android.package-archive",
                                fileName: `${appName}.apk`,
                                caption: cap
                            }, { quoted: msg });
                            return;
                        }
                        throw new Error("Download link empty in API response.");
                    } catch (err) {
                        console.error("APK Downloader Interceptor Error:", err);
                        await sock.sendMessage(jid, { text: `❌ Failed to download APK: ${err.message}` }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { text: `❌ Invalid choice. Please reply with a number between 1 and ${session.results.length}.` }, { quoted: msg });
                }
                return;
            }

            // 7. CHAT INTERCEPTOR: Resolve active Shazam song downloads
            if (quotedMsgId && global.shazamSessions && global.shazamSessions[quotedMsgId]) {
                const session = global.shazamSessions[quotedMsgId];
                const text = trimmedMessage.toLowerCase().trim();

                if (text === '1' || text === 'download') {
                    delete global.shazamSessions[quotedMsgId]; // Clean up memory
                    await sock.sendMessage(jid, { text: `📥 *Downloading recognized song:* "${session.title} - ${session.artist}"...` }, { quoted: msg });

                    try {
                        const response = await fetch(`https://apis.davidcyril.name.ng/play?query=${encodeURIComponent(session.title + ' ' + session.artist)}`);
                        if (!response.ok) throw new Error("API failed to respond.");

                        const data = await response.json();
                        if (data.status && data.result) {
                            const downloadUrl = data.result.download_url;
                            if (downloadUrl) {
                                await sock.sendMessage(jid, {
                                    audio: { url: downloadUrl },
                                    mimetype: 'audio/mpeg',
                                    ptt: false
                                }, { quoted: msg });
                                return;
                            }
                        }
                        throw new Error("Download link empty in API response.");
                    } catch (err) {
                        console.error("Shazam download interceptor failed:", err);
                        await sock.sendMessage(jid, { text: `❌ Download failed: ${err.message}` }, { quoted: msg });
                    }
                }
                return;
            }

            // 5. ANTIVIEWONCE AUTOMATIC DECRYPT INTERCEPTOR (LID & JID Mindful)
            const isViewOnce = msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2 || msg.message?.viewOnceMessageV2Extension;
            const antiviewonceConfig = settings.antiviewonce || { status: 'off', logDestination: 'bot' };
            const antivvStatus = antiviewonceConfig.status || 'off';
            
            let shouldDecryptViewOnce = false;
            if (antivvStatus === 'all') {
                shouldDecryptViewOnce = true;
            } else if (antivvStatus === 'here') {
                shouldDecryptViewOnce = (antiviewonceConfig.hereJid === jid);
            }

            if (isViewOnce && shouldDecryptViewOnce && !msg.key.fromMe) {
                try {
                    const rawContent = getRawMessage(msg.message);
                    let mediaMessage = null;
                    let mediaType = "";

                    if (rawContent?.imageMessage) {
                        mediaMessage = rawContent.imageMessage;
                        mediaType = "image";
                    } else if (rawContent?.videoMessage) {
                        mediaMessage = rawContent.videoMessage;
                        mediaType = "video";
                    } else if (rawContent?.audioMessage) {
                        mediaMessage = rawContent.audioMessage;
                        mediaType = "audio";
                    }

                    if (mediaMessage && mediaType) {
                        const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                        
                        const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }

                        // Highly resilient destination JID resolution (LID-Safe)
                        let destJid = '';
                        if (antiviewonceConfig.logDestination === 'user' && antiviewonceConfig.logUserJid) {
                            destJid = antiviewonceConfig.logUserJid;
                        } else {
                            // Default to Bot's own account (LID-Safe fallback)
                            destJid = sock.user.id ? (sock.user.id.split(':')[0] + (sock.user.id.includes('@lid') ? '@lid' : '@s.whatsapp.net')) : '';
                            if (!destJid) {
                                destJid = settings.botJid || (settings.ownerNumber + '@s.whatsapp.net');
                            }
                        }

                        const captionText = mediaMessage.caption || "";
                        const logHeader = `👁️ *ANTIVIEWONCE AUTO-DECRYPT LOG:* 👁️\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                          `👥 *Chat Origin:* @${jid.split('@')[0]}\n` +
                                          `👤 *Sender:* @${senderNumber}\n` +
                                          `📝 *Caption:* "${captionText}"\n`;

                        if (mediaType === "image") {
                            await sock.sendMessage(destJid, { 
                                image: buffer, 
                                caption: logHeader, 
                                mentions: [jid, senderJid] 
                            });
                        } else if (mediaType === "video") {
                            await sock.sendMessage(destJid, { 
                                video: buffer, 
                                mimetype: mediaMessage.mimetype || "video/mp4", 
                                caption: logHeader, 
                                mentions: [jid, senderJid] 
                            });
                        } else if (mediaType === "audio") {
                            await sock.sendMessage(destJid, { 
                                text: logHeader + `🎵 *Type:* View-Once Voice Note/Audio`, 
                                mentions: [jid, senderJid] 
                            });
                            await sock.sendMessage(destJid, { 
                                audio: buffer, 
                                mimetype: mediaMessage.mimetype || "audio/ogg; codecs=opus", 
                                ptt: mediaMessage.ptt || false 
                            });
                        }
                    }
                } catch (e) {
                    console.error("View Once extraction error:", e.message);
                }
            }

            // 6. ANTIPM PRIVATE MESSAGE AUTOBLOCKER
            if (!isGroup && !msg.key.fromMe && !isAuthorized && settings.antipm === 'on') {
                try {
                    await sock.sendMessage(jid, { text: "❌ *Connection Blocked:* Direct messages are currently restricted under Satoru Gojo's domain security." });
                    await sock.updateBlockStatus(senderJid, 'block');
                } catch (e) {
                    console.error("Antipm blocking failed:", e.message);
                }
                return; 
            }

            if (isGroup && !msg.key.fromMe) {
                if (!settings.msgCount) settings.msgCount = {};
                if (!settings.msgCount[jid]) settings.msgCount[jid] = {};
                if (!settings.msgCount[jid][senderJid]) {
                    settings.msgCount[jid][senderJid] = { count: 0, lastMsgTime: 0 };
                }
                
                settings.msgCount[jid][senderJid].count++;
                settings.msgCount[jid][senderJid].lastMsgTime = Date.now();

                if (settings.gclogActive?.[jid]) {
                    if (!settings.conversationLogs) settings.conversationLogs = {};
                    if (!settings.conversationLogs[jid]) settings.conversationLogs[jid] = [];
                    
                    const senderName = msg.pushName || senderNumber;
                    settings.conversationLogs[jid].push({
                        sender: senderName,
                        text: trimmedMessage,
                        time: Date.now()
                    });

                    if (settings.conversationLogs[jid].length > 200) {
                        settings.conversationLogs[jid].shift();
                    }
                }
            }

            if (settings.autoReact === 'all' && !msg.key.fromMe) {
                try {
                    await sock.sendMessage(msg.key.remoteJid, { react: { text: "❄", key: msg.key } });
                } catch (err) {
                    console.error("Autoreact All Error:", err.message);
                }
            }

            const mentionedJids = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const devJids = [
                ...settings.devs.map(num => `${num}@s.whatsapp.net`),
                ...settings.devLids
            ];
            
            // Fixed verification logic to check if a registered developer or the bot is mentioned
            const isAnyDevMentioned = mentionedJids.some(jid => devJids.includes(jid) || jid === botJid || jid === botLid);
            
            if (isGroup && isAnyDevMentioned) {
                const devEmojis = ["⚡", "❄", "🥷", "🤞", "🧘"];
                for (const emoji of devEmojis) {
                    try {
                        await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
                        await delay(200);
                    } catch (e) {
                        console.error("Dev reaction error:", e.message);
                    }
                }
            }

            if (settings.afk?.[senderNumber] && !trimmedMessage.startsWith(`${settings.prefix}afk`)) {
                const afkState = settings.afk[senderNumber];
                const elapsed = getAfkDuration(afkState.time);
                delete settings.afk[senderNumber];
                saveSettings(); 
                
                await sock.sendMessage(jid, {
                    text: `👋 *Welcome Back @${senderNumber}!* AFK deactivated. You were away for *${elapsed}*.`,
                    mentions: [`${senderNumber}@s.whatsapp.net`]
                }, { quoted: msg });
            }

            if (isGroup && !msg.key.fromMe) {
                const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant?.split('@')[0];
                const quotedAfkState = settings.afk?.[quotedParticipant];

                const afkMentionedJid = mentionedJids.find(jid => settings.afk?.[jid.split('@')[0]]);
                const afkMentionedNumber = afkMentionedJid ? afkMentionedJid.split('@')[0] : '';
                const mentionedAfkState = settings.afk?.[afkMentionedNumber];

                const afkUser = quotedAfkState ? quotedParticipant : (mentionedAfkState ? afkMentionedNumber : '');
                const afkState = quotedAfkState || mentionedAfkState;

                if (afkState && senderNumber !== afkUser) {
                    const gojoAfkQuotes = [
                        "Tch. Don't bother him right now. He's busy, and honestly, you're not important enough to disturb his peace.",
                        "Hey, look. Infinity is currently active around my owner. In other words: don't touch, don't speak, don't exist in his notifications.",
                        "Are you seriously trying to get his attention? I'm the one who decides who gets to talk to him. Quiet down, weakling.",
                        "Don't annoy him. I'm protecting his quiet time right now, and you really don't want to irritate the strongest."
                    ];
                    const randomQuote = gojoAfkQuotes[Math.floor(Math.random() * gojoAfkQuotes.length)];
                    const elapsed = getAfkDuration(afkState.time);

                    await sock.sendMessage(jid, {
                        text: `@${senderNumber}\n*${randomQuote}*\n\n💤 @${afkUser} is currently off.\n*Reason:* ${afkState.reason}\n*Afk for:* ${elapsed} since turning on AFK.`,
                        mentions: [`${senderNumber}@s.whatsapp.net`, `${afkUser}@s.whatsapp.net`]
                    }, { quoted: msg });
                }
            }

            if (isGroup && !msg.key.fromMe) {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants;
                const sender = participants.find(p => p.id === senderJid);
                const isAdmin = sender?.admin === 'admin' || sender?.admin === 'superadmin';

                // AUTO-READ CHAT CONTROLLER
                if (settings.presence && settings.presence.autoread) {
                    const autoreadActive = settings.presence.autoread.all || settings.presence.autoread.chats.includes(jid);
                    if (autoreadActive) {
                        try {
                            await sock.readMessages([msg.key]);
                        } catch (e) {}
                    }
                }

                if (!isAdmin && !isOwner) {
                    const isOtherBot = !msg.key.fromMe && (
                        (msg.key.id.startsWith('BAE5') && msg.key.id.length === 16) || 
                        (msg.key.id.startsWith('3EB0') && msg.key.id.length === 12) ||
                        msg.key.id.startsWith('KSG') || 
                        msg.key.id.startsWith('Lumina')
                    );

                    const antibotSetting = settings.antibot[jid];
                    if (isOtherBot && antibotSetting && antibotSetting !== 'off') {
                        try {
                            await sock.sendMessage(jid, { delete: { remoteJid: jid, id: msg.key.id, fromMe: false, participant: senderJid } });
                        } catch (e) {
                            console.error("Antibot deletion failed:", e.message);
                        }

                        if (antibotSetting === 'kick') {
                            try {
                                await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                                await sock.sendMessage(jid, {
                                    text: `Sayonara! Weakling\n@${senderNumber}\nKuso yaro 🥷`,
                                    mentions: [senderJid]
                                });
                            } catch (err) {
                                console.error("Antibot instant-kick failed:", err.message);
                            }
                        } else if (antibotSetting === 'warn') {
                            const warnKey = `${jid}_${senderNumber}`;
                            settings.warns[warnKey] = (settings.warns[warnKey] || 0) + 1;
                            const count = settings.warns[warnKey];

                            if (count >= 5) {
                                try {
                                    await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                                    await sock.sendMessage(jid, {
                                        text: `Sayonara! Weakling\n@${senderNumber}\nKuso yaro 🥷`,
                                        mentions: [senderJid]
                                    });
                                    settings.warns[warnKey] = 0;
                                } catch (err) {
                                    console.error("Antibot auto-kick failed:", err.message);
                                }
                            } else {
                                await sock.sendMessage(jid, {
                                    text: `@${senderNumber} Any bot aside myself deserves to be exorcised 💀\n\n*Warn:* ${count}/5`,
                                    mentions: [senderJid]
                                });
                            }
                        } else if (antibotSetting === 'delete') {
                            await sock.sendMessage(jid, {
                                text: `@${senderNumber} Any bot aside myself deserves to be exorcised 💀`,
                                mentions: [senderJid]
                            });
                        }
                        return; 
                    }

                    const antilinkSetting = settings.antilink[jid];
                    if (antilinkSetting && antilinkSetting !== 'off') {
                        const containsLink = /chat\.whatsapp\.com\/[0-9A-Za-z]{20,24}|(https?:\/\/[^\s]+)/gi.test(body);
                        if (containsLink) {
                            try {
                                await sock.sendMessage(jid, { delete: { remoteJid: jid, id: msg.key.id, fromMe: false, participant: senderJid } });
                            } catch (e) {
                                console.error("Antilink delete failed:", e.message);
                            }

                            if (antilinkSetting === 'warn') {
                                const warnKey = `${jid}_${senderNumber}`;
                                settings.warns[warnKey] = (settings.warns[warnKey] || 0) + 1;
                                const count = settings.warns[warnKey];

                                if (count >= 5) {
                                    try {
                                        await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                                        await sock.sendMessage(jid, {
                                            text: `Sayonara! Weakling\n@${senderNumber}\nKuso yaro 🥷`,
                                            mentions: [senderJid]
                                        });
                                        settings.warns[warnKey] = 0;
                                    } catch (err) {
                                        console.error("Antilink auto-kick failed:", err.message);
                                    }
                                } else {
                                    await sock.sendMessage(jid, {
                                        text: `@${senderNumber}\nBaka! My six eyes perceive All\nYou can't bypass my infinity coz you are so weak!!!\n\n*Warn:* ${count}/5`,
                                        mentions: [senderJid]
                                    });
                                }
                            } else if (antilinkSetting === 'delete') {
                                await sock.sendMessage(jid, {
                                    text: `@${senderNumber} Baka! My six eyes perceive All\nYou can't bypass my infinity coz you are so weak!!!`,
                                    mentions: [senderJid]
                                });
                            } else if (antilinkSetting === 'kick') {
                                try {
                                    await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                                    await sock.sendMessage(jid, {
                                        text: `Sayonara! Weakling\n@${senderNumber}\nKuso yaro 🥷`,
                                        mentions: [senderJid]
                                    });
                                } catch (err) {
                                    console.error("Antilink kick failed:", err.message);
                                }
                            }
                            return; 
                        }
                    }
                }

                const antitagSetting = settings.antitag[jid];
                if (antitagSetting === 'on') {
                    const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant;
                    
                    const isTaggingBot = mentionedJids.includes(botJid) || 
                                         (botLid && mentionedJids.includes(botLid)) ||
                                         quotedParticipant === botJid || 
                                         (botLid && quotedParticipant === botLid);

                    if (isTaggingBot) {
                        if (!isAdmin && !isOwner) {
                            try {
                                await sock.sendMessage(jid, { delete: { remoteJid: jid, id: msg.key.id, fromMe: false, participant: senderJid } });
                            } catch (e) {
                                console.error("Antitag delete failed:", e.message);
                            }
                            await sock.sendMessage(jid, {
                                text: `@${senderNumber} Quit tagging me weakling`,
                                mentions: [senderJid]
                            });
                        } 
                        else if (isAdmin && !isOwner) {
                            await sock.sendMessage(jid, {
                                text: `@${senderNumber} Quit tagging me weakling`,
                                mentions: [senderJid]
                            });
                        }
                    }
                }
            }

            let command;
            let args;

            if (lowerMessage.includes('gojo') && !trimmedMessage.startsWith(settings.prefix)) {
                command = 'gojo';
                args = trimmedMessage; 
            } 
            else if (lowerMessage.includes('kamui') && !trimmedMessage.startsWith(settings.prefix)) {
                command = 'kamui';
                args = trimmedMessage;
            }
            else if (lowerMessage === 'speed' || lowerMessage.startsWith('speed ')) {
                command = 'speed';
                args = '';
            }
            else if (trimmedMessage.startsWith(settings.prefix)) {
                const spaceIndex = trimmedMessage.indexOf(' ');
                if (spaceIndex === -1) {
                    command = trimmedMessage.toLowerCase();
                    args = '';
                } else {
                    command = trimmedMessage.slice(0, spaceIndex).toLowerCase();
                    args = trimmedMessage.slice(spaceIndex + 1);
                }

                if (command === `${settings.prefix}gojo`) {
                    command = 'gojo';
                    const spaceIndex = trimmedMessage.indexOf(' ');
                    args = spaceIndex === -1 ? '' : trimmedMessage.slice(spaceIndex + 1);
                }

                if (command === `${settings.prefix}speed`) {
                    command = 'speed';
                    args = '';
                }
            } else {
                const isLizzyActive = Array.isArray(settings.lizzyChats) && settings.lizzyChats.includes(jid);
                const isChatbotActive = Array.isArray(settings.chatbotChats) && settings.chatbotChats.includes(jid);

                const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant;
                const isReplyingToBot = quotedParticipant === botJid || (botLid && quotedParticipant === botLid) || (!isGroup && !msg.key.fromMe && msg.message.extendedTextMessage?.contextInfo?.stanzaId);
                const isMentioningBot = mentionedJids.includes(botJid) || (botLid && mentionedJids.includes(botLid));

                if (isLizzyActive && !command) {
                    const containsLizzyName = lowerMessage.includes('lizzy');
                    if (isReplyingToBot || isMentioningBot || containsLizzyName) {
                        command = 'lizzy_chat';
                        args = trimmedMessage;
                    }
                }

                if (isChatbotActive && !command) {
                    if (isReplyingToBot || isMentioningBot) {
                        command = 'chatbot_chat';
                        args = trimmedMessage;
                    }
                }
                
                if (!command) return; 
            }

            console.log(`⚙️ [PARSER] Triggering command: "${command}"`);

            if (commands[command]) {
                if (settings.autoReact === 'cmd' && !msg.key.fromMe) {
                    try {
                        await sock.sendMessage(msg.key.remoteJid, { react: { text: "❄", key: msg.key } });
                    } catch (err) {
                        console.error("Autoreact Command Error:", err.message);
                    }
                }

                await commands[command](sock, msg, args, { isOwner, isSudo, isDev, senderNumber });
            }
        } catch (err) {
            console.error('Error handling message stream:', err);
        }
    });
}

module.exports = { startBot };
```