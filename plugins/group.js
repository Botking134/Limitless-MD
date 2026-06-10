// plugins/group.js
const settings = require('../settings'); 
const { saveSettings } = require('../settingsSaver'); 
const { saveState } = require('../stateManager'); // State persistence manager
const commands = require('../commands'); 

if (!global.tkickTimers) global.tkickTimers = {};
if (!global.kickallActive) global.kickallActive = {};
if (!global.groupTimers) global.groupTimers = {};
if (!global.silencedUsers) global.silencedUsers = {}; 

// Reusable Helper to resolve any JID (such as LID) to standard Phone format
async function resolveToPhoneJid(sock, jid) {
    if (!jid) return '';
    if (jid.endsWith('@s.whatsapp.net')) return jid;
    if (jid.endsWith('@lid')) {
        try {
            const res = await sock.findUserId(jid);
            if (res && res.phoneNumber) return res.phoneNumber;
        } catch (e) {}
    }
    const num = jid.split('@')[0].split(':')[0];
    return `${num}@s.whatsapp.net`;
}

// Reusable Helper to verify permissions including dual admin check
async function verifyPermissions(sock, msg, jid, isOwner, isDev = false, commandName = '') {
    if (isDev) return true; // Developers bypass completely

    const groupMetadata = await sock.groupMetadata(jid);
    const participants = groupMetadata.participants;

    // 1. Verify Bot is Admin
    const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const botParticipant = participants.find(p => p.id.split('@')[0] === sock.user.id.split(':')[0]);
    const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

    // Bypassed specifically for the '.tag' command
    if (commandName === 'tag') {
        const senderJid = msg.key.participant || msg.key.remoteJid || '';
        let sender = participants.find(p => p.id === senderJid);
        const isAdmin = sender?.admin === 'admin' || sender?.admin === 'superadmin';
        return isAdmin || isOwner;
    }

    if (!isBotAdmin) {
        await sock.sendMessage(jid, { text: "❌ Group commands can only be used if I'm an administrator in this group!" }, { quoted: msg });
        return false;
    }

    // 2. Verify Sender (Owner/Sudo) is Admin
    const senderJid = msg.key.participant || msg.key.remoteJid || '';
    let sender = participants.find(p => p.id === senderJid);
    if (!sender && senderJid.endsWith('@lid')) {
        try {
            const resolved = await sock.findUserId(senderJid);
            if (resolved && resolved.phoneNumber) {
                sender = participants.find(p => p.id === resolved.phoneNumber);
            }
        } catch (e) {}
    }

    const isAdmin = sender?.admin === 'admin' || sender?.admin === 'superadmin';

    if (!isAdmin) {
        await sock.sendMessage(jid, { text: "❌ Both the bot and the owner/sudo must be administrators to run this group command!" }, { quoted: msg });
        return false;
    }

    return true;
}

// Reusable Helper to parse target user from message (LID-Safe)
function parseTargetUser(msg, args) {
    let targetJid = '';
    const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
    if (mentions && mentions.length > 0) {
        targetJid = mentions[0];
    } else if (msg.message.extendedTextMessage?.contextInfo?.participant) {
        targetJid = msg.message.extendedTextMessage.contextInfo.participant;
    } else if (args) {
        targetJid = args.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    }
    return targetJid;
}

// Duration string parser
function parseDuration(str) {
    const match = str.match(/^(\d+)([smh])$/i);
    if (!match) return null;
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
    return null;
}

// Recursive Helper to automatically unwrap messages
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
    // 1. .mute / .unmute UNIFIED TOGGLES
    {
        name: 'mute',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'mute');
            if (!isAuthorized) return;

            if (!args) {
                const prompt = `🔒 *Gotei 13 Domain Control Panel:*\n\nSelect an option below to update domain parameters:`;
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}mute close`, buttonText: { displayText: 'Mute Group 🔒' }, type: 1 },
                        { buttonId: `${settings.prefix}mute open`, buttonText: { displayText: 'Unmute Group 🔓' }, type: 1 }
                    ],
                    headerType: 1
                };
                try { 
                    return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); 
                } catch (e) { 
                    return await sock.sendMessage(jid, { text: `${prompt}\n\n• \`${settings.prefix}mute close\`\n• \`${settings.prefix}mute open\`` }, { quoted: msg }); 
                }
            }

            const parts = args.split(' ');
            const action = parts[0].toLowerCase().trim();
            const timeString = parts[1] || '';
            const durationMs = timeString ? parseDuration(timeString) : null;

            const isOpening = ['open', 'unlock', 'unmute'].includes(action);

            if (isOpening) {
                await sock.groupSettingUpdate(jid, 'not_announcement');
                let timeNotice = "";

                if (durationMs) {
                    timeNotice = `\n_This domain will automatically close in ${timeString}._`;
                    if (global.groupTimers[jid]) clearTimeout(global.groupTimers[jid]);
                    global.groupTimers[jid] = setTimeout(async () => {
                        await sock.groupSettingUpdate(jid, 'announcement');
                        await sock.sendMessage(jid, { text: "🔒 *Group Status Updated:*\n\nTime is up. Only Administrators can speak." });
                        delete global.groupTimers[jid];
                    }, durationMs);
                }
                await sock.sendMessage(jid, { text: `🔓 *Group Status Updated:*\n\nEveryone is now free to speak.${timeNotice}` }, { quoted: msg });
            } else {
                await sock.groupSettingUpdate(jid, 'announcement');
                let timeNotice = "";

                if (durationMs) {
                    timeNotice = `\n_This domain will automatically open in ${timeString}._`;
                    if (global.groupTimers[jid]) clearTimeout(global.groupTimers[jid]);
                    global.groupTimers[jid] = setTimeout(async () => {
                        await sock.groupSettingUpdate(jid, 'not_announcement');
                        await sock.sendMessage(jid, { text: "🔓 *Group Status Updated:*\n\nEveryone is now free to speak." });
                        delete global.groupTimers[jid];
                    }, durationMs);
                }
                await sock.sendMessage(jid, { text: `🔒 *Group Status Updated:*\n\nOnly Administrators can speak.${timeNotice}` }, { quoted: msg });
            }
        }
    },

    // 2. KICK MEMBER
    {
        name: 'kick',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'kick');
            if (!isAuthorized) return;

            const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const targets = mentions.length > 0 ? mentions : [parseTargetUser(msg, args)];
            const cleanTargets = targets.filter(t => t && t.split('@')[0] !== settings.ownerNumber);

            if (cleanTargets.length === 0) return await sock.sendMessage(jid, { text: "❌ No valid targets provided." }, { quoted: msg });

            for (const target of cleanTargets) {
                await sock.groupParticipantsUpdate(jid, [target], "remove");
            }
            await sock.sendMessage(jid, { text: `👋 Exorcised ${cleanTargets.length} target(s) from this domain.`, mentions: cleanTargets }, { quoted: msg });
        }
    },

    // 3. PROMOTE TO ADMIN
    {
        name: 'promote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'promote');
            if (!isAuthorized) return;

            const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const targets = mentions.length > 0 ? mentions : [parseTargetUser(msg, args)];
            const cleanTargets = targets.filter(t => t);

            if (cleanTargets.length === 0) return await sock.sendMessage(jid, { text: "❌ Identify targets to promote." }, { quoted: msg });

            for (const target of cleanTargets) {
                await sock.groupParticipantsUpdate(jid, [target], "promote");
            }
            await sock.sendMessage(jid, { text: `👑 Elevated ${cleanTargets.length} member(s) to Administrative status.`, mentions: cleanTargets }, { quoted: msg });
        }
    },

    // 4. DEMOTE FROM ADMIN
    {
        name: 'demote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'demote');
            if (!isAuthorized) return;

            const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const targets = mentions.length > 0 ? mentions : [parseTargetUser(msg, args)];
            const cleanTargets = targets.filter(t => t && t.split('@')[0] !== settings.ownerNumber);

            if (cleanTargets.length === 0) return await sock.sendMessage(jid, { text: "❌ Identify targets to demote." }, { quoted: msg });

            for (const target of cleanTargets) {
                await sock.groupParticipantsUpdate(jid, [target], "demote");
            }
            await sock.sendMessage(jid, { text: `👋 Demoted ${cleanTargets.length} admin(s) back to standard members.`, mentions: cleanTargets }, { quoted: msg });
        }
    },

    // 5. TAG ALL PARTICIPANTS (Vertically Structured Columns)
    {
        name: 'tagall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'tagall');
            if (!isAuthorized) return;

            const messageText = args ? args : "Attention everyone!";
            const groupMetadata = await sock.groupMetadata(jid);
            const participants = groupMetadata.participants;

            const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
            const members = participants.filter(p => p.admin === null || p.admin === undefined);

            let text = `🔮 *${settings.botName.toUpperCase()} SUMMON* 🔮\n`;
            text += `📢 *Note:* _"${messageText}"_\n\n`;

            text += `👑 *Group Admins:*\n`;
            for (let i = 0; i < admins.length; i += 2) {
                const a1 = admins[i] ? `@${admins[i].id.split('@')[0]}` : '';
                const a2 = admins[i + 1] ? `     @${admins[i + 1].id.split('@')[0]}` : '';
                text += `${a1}${a2}\n`;
            }

            text += `\n👥 *Members:*\n`;
            for (let i = 0; i < members.length; i += 2) {
                const m1 = members[i] ? `@${members[i].id.split('@')[0]}` : '';
                const m2 = members[i + 1] ? `     @${members[i + 1].id.split('@')[0]}` : '';
                text += `${m1}${m2}\n`;
            }

            const allJids = participants.map(p => p.id);

            await sock.sendMessage(jid, {
                text: text,
                mentions: allJids
            }, { quoted: msg });
        }
    },

    // 6. GHOST TAG (Bypasses Admin Requirement on Sender)
    {
        name: 'tag',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'tag');
            if (!isAuthorized) return;

            const groupMetadata = await sock.groupMetadata(jid);
            const participants = groupMetadata.participants.map(p => p.id);

            const quoted = msg.message.extendedTextMessage?.contextInfo;
            let targetQuotedMsg = msg; 
            let quotedText = '';
            
            if (quoted && quoted.stanzaId) {
                targetQuotedMsg = {
                    key: { remoteJid: jid, id: quoted.stanzaId, participant: quoted.participant },
                    message: quoted.quotedMessage || {}
                };
                const qMsg = quoted.quotedMessage;
                quotedText = qMsg?.conversation || qMsg?.extendedTextMessage?.text || qMsg?.imageMessage?.caption || qMsg?.videoMessage?.caption || '';
            }

            const messageText = args ? args : (quotedText ? quotedText : "🤞 *Summoned by Satoru Gojo.*");

            await sock.sendMessage(jid, {
                text: messageText,
                mentions: participants
            }, { quoted: targetQuotedMsg });
        }
    },

    // 7. FETCH GROUP LINK
    {
        name: 'link',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'link');
            if (!isAuthorized) return;

            const code = await sock.groupInviteCode(jid);
            const inviteLink = `https://chat.whatsapp.com/${code}`;

            await sock.sendMessage(jid, { text: `🔮 *Limitless Domain Link:*\n\n${inviteLink}` }, { quoted: msg });
        }
    },

    // 8. ANTILINK CONTROLLER
    {
        name: 'antilink',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'antilink');
            if (!isAuthorized) return;

            if (!args) {
                const current = settings.antilink[jid] || 'off';
                const prompt = `🔮 *Limitless Antilink Settings:* (Current: \`${current}\`)\n\nSelect an option:`;
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}antilink delete`, buttonText: { displayText: 'Delete' }, type: 1 },
                        { buttonId: `${settings.prefix}antilink warn`, buttonText: { displayText: 'Warn' }, type: 1 },
                        { buttonId: `${settings.prefix}antilink off`, buttonText: { displayText: 'Disable' }, type: 1 }
                    ],
                    headerType: 1
                };
                try { return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (e) { return await sock.sendMessage(jid, { text: prompt }, { quoted: msg }); }
            }

            const action = args.toLowerCase().trim();

            if (['warn', 'delete', 'kick', 'off'].includes(action)) {
                settings.antilink[jid] = action;
                saveSettings();
                saveState();
                await sock.sendMessage(jid, { text: `🔒 *Antilink updated:* \`${action.toUpperCase()}\`` }, { quoted: msg });
            }
        }
    },

    // 9. ADMINS-ONLY TAG
    {
        name: 'admins',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'admins');
            if (!isAuthorized) return;

            const groupMetadata = await sock.groupMetadata(jid);
            const participants = groupMetadata.participants;
            const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
            
            const adminJids = admins.map(a => a.id);
            const mentionsList = admins.map(a => `@${a.id.split('@')[0]}`).join(' ');

            await sock.sendMessage(jid, { text: `🔮 *Limitless Admin Summon:*\n\n${mentionsList}`, mentions: adminJids }, { quoted: msg });
        }
    },

    // 10. ANTITAG MODE CONTROLLER
    {
        name: 'antitag',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'antitag');
            if (!isAuthorized) return;

            if (!args) {
                const current = settings.antitag[jid] || 'off';
                const prompt = `🔮 *Limitless Antitag Setting:* (Current: \`${current}\`)\n\nSelect an option below:`;
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}antitag on`, buttonText: { displayText: 'Enable' }, type: 1 },
                        { buttonId: `${settings.prefix}antitag off`, buttonText: { displayText: 'Disable' }, type: 1 }
                    ],
                    headerType: 1
                };
                try { return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (e) { return await sock.sendMessage(jid, { text: prompt }, { quoted: msg }); }
            }

            const action = args.toLowerCase().trim();

            if (action === 'on') {
                settings.antitag[jid] = 'on';
                await sock.sendMessage(jid, { text: "🔒 *Antitag Activated.*" }, { quoted: msg });
            } else if (action === 'off') {
                settings.antitag[jid] = 'off';
                await sock.sendMessage(jid, { text: "🔓 *Antitag Deactivated.*" }, { quoted: msg });
            }
            saveSettings(); 
            saveState();
        }
    },

    // 11. ANTIBOT CONFIGURABLE MODE CONTROLLER
    {
        name: 'antibot',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'antibot');
            if (!isAuthorized) return;

            if (!args) {
                const current = settings.antibot[jid] || 'off';
                const prompt = `🔮 *Limitless Antibot Setting:* (Current: \`${current}\`)\n\nSelect an option:`;
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}antibot delete`, buttonText: { displayText: 'Delete' }, type: 1 },
                        { buttonId: `${settings.prefix}antibot warn`, buttonText: { displayText: 'Warn' }, type: 1 },
                        { buttonId: `${settings.prefix}antibot off`, buttonText: { displayText: 'Disable' }, type: 1 }
                    ],
                    headerType: 1
                };
                try { return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (e) { return await sock.sendMessage(jid, { text: prompt }, { quoted: msg }); }
            }

            const action = args.toLowerCase().trim();

            if (['warn', 'delete', 'kick', 'off'].includes(action)) {
                settings.antibot[jid] = action;
                saveSettings(); 
                saveState();
                await sock.sendMessage(jid, { text: `🔒 *Antibot updated:* \`${action.toUpperCase()}\`` }, { quoted: msg });
            }
        }
    },

    // 12. WARNINGS SYSTEM COMMAND
    {
        name: 'warn',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'warn');
            if (!isAuthorized) return;

            const quoted = msg.message.extendedTextMessage?.contextInfo;
            if (!quoted || !quoted.stanzaId) return await sock.sendMessage(jid, { text: "❌ Please reply to the message you want to warn." }, { quoted: msg });

            const targetJid = quoted.participant;
            const targetNumber = targetJid.split('@')[0];
            const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

            if (targetNumber === settings.ownerNumber) return await sock.sendMessage(jid, { text: "❌ You cannot warn the owner." }, { quoted: msg });

            try { await sock.sendMessage(jid, { delete: { remoteJid: jid, id: quoted.stanzaId, fromMe: targetJid === botJid, participant: targetJid } }); } catch (e) {}

            const warnKey = `${jid}_${targetNumber}`;
            settings.warns[warnKey] = (settings.warns[warnKey] || 0) + 1;
            const count = settings.warns[warnKey];

            if (count >= 5) {
                try {
                    await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
                    await sock.sendMessage(jid, { text: `Sayonara! @${targetNumber}`, mentions: [targetJid] });
                    settings.warns[warnKey] = 0;
                } catch (err) {}
            } else {
                await sock.sendMessage(jid, { text: `⚠️ *Warning Issued:* @${targetNumber}\n\n*Warns:* ${count}/5`, mentions: [targetJid] });
            }
            saveSettings(); 
            saveState();
        }
    },

    // 13. SEND DYNAMIC STATUS AND DUAL-ROUTE GROUP STATUS (.togcstatus)
    {
        name: 'togcstatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'togcstatus');
            if (!isAuthorized) return;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = quoted ? getRawMessage(quoted) : null;

            try {
                const {
                    downloadContentFromMessage,
                    prepareWAMessageMedia,
                    generateWAMessageFromContent,
                    proto
                } = await import('@itsliaaa/baileys'); // Dynamic import to prevent require ESM crashes

                let targetJid = jid; 
                let sendToStatus = false;

                if (args && args.trim().endsWith('@g.us')) {
                    targetJid = args.trim();
                    sendToStatus = true; 
                }

                let messagePayload = {};

                if (rawContent && (rawContent.videoMessage || rawContent.imageMessage || rawContent.audioMessage)) {
                    const mediaType = rawContent.videoMessage ? "video" : (rawContent.imageMessage ? "image" : "audio");
                    const targetMessage = rawContent[mediaType + "Message"];

                    const stream = await downloadContentFromMessage(targetMessage, mediaType);
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    let mediaOptions = {};
                    if (mediaType === "image") {
                        mediaOptions = { image: buffer, caption: targetMessage.caption || '' };
                    } else if (mediaType === "video") {
                        mediaOptions = { video: buffer, caption: targetMessage.caption || '' };
                    } else if (mediaType === "audio") {
                        mediaOptions = {
                            audio: buffer,
                            mimetype: targetMessage.mimetype,
                            ptt: targetMessage.ptt || false,
                            seconds: targetMessage.seconds
                        };
                    }

                    const preparedMedia = await prepareWAMessageMedia(
                        mediaOptions,
                        { upload: sock.waUploadToServer }
                    );

                    let mediaMessage = {};
                    if (mediaType === "image") mediaMessage = { imageMessage: preparedMedia.imageMessage };
                    else if (mediaType === "video") mediaMessage = { videoMessage: preparedMedia.videoMessage };
                    else if (mediaType === "audio") mediaMessage = { audioMessage: preparedMedia.audioMessage };

                    messagePayload = {
                        groupStatusMessageV2: { message: mediaMessage }
                    };
                } 
                else {
                    const textToSend = args || quoted?.conversation || quoted?.extendedTextMessage?.text || '';
                    if (!textToSend) {
                        return await sock.sendMessage(jid, { text: "❌ Please reply to text or media to post on group status." }, { quoted: msg });
                    }

                    // Compile random background hex
                    const randomHex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
                    const bgColor = 0xff000000 + parseInt(randomHex, 16);

                    messagePayload = {
                        groupStatusMessageV2: {
                            message: {
                                extendedTextMessage: {
                                    text: textToSend,
                                    backgroundArgb: bgColor,
                                    font: 2
                                }
                            }
                        }
                    };
                }

                if (sendToStatus) {
                    await sock.sendMessage(jid, { text: `Uploading media to status list for JID: \`${targetJid}\`... 📡` }, { quoted: msg });
                }

                const statusMsg = generateWAMessageFromContent(
                    targetJid,
                    proto.Message.fromObject(messagePayload),
                    { userJid: sock.user.id }
                );

                await sock.relayMessage(
                    targetJid,
                    statusMsg.message,
                    { messageId: statusMsg.key.id }
                );

                await sock.sendMessage(jid, { react: { text: "✓", key: msg.key } });

            } catch (error) {
                console.error("togcstatus error:", error.message);
                await sock.sendMessage(jid, { text: `❌ Failed to execute command: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 14. GET GROUP PROFILE PICTURE
    {
        name: 'getgpp',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'getgpp');
            if (!isAuthorized) return;

            try {
                const profileUrl = await sock.profilePictureUrl(jid, 'image');
                await sock.sendMessage(jid, { image: { url: profileUrl }, caption: "🖼️ Current Group Profile Picture" }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: "❌ Failed to fetch Group Profile Picture." }, { quoted: msg });
            }
        }
    },

    // 15. SET GROUP PROFILE PICTURE
    {
        name: 'setpp',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'setpp');
            if (!isAuthorized) return;

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted || !quoted.imageMessage) return await sock.sendMessage(jid, { text: "❌ Please reply to an image." }, { quoted: msg });

            try {
                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                await sock.updateProfilePicture(jid, buffer);
                await sock.sendMessage(jid, { text: "✅ Successfully updated Group Profile Picture!" }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: "❌ Failed to update profile picture." }, { quoted: msg });
            }
        }
    },

    // 16. WELCOME MODULE CONTROLLER
    {
        name: 'welcome',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'welcome');
            if (!isAuthorized) return;

            if (!settings.welcome) settings.welcome = {};

            const parts = args ? args.split(' ') : [];
            const subAction = parts[0] ? parts[0].toLowerCase().trim() : '';

            if (subAction === 'on') {
                settings.welcome[jid] = settings.welcome[jid] || { active: true, msg: "" };
                settings.welcome[jid].active = true;
                saveSettings();
                saveState();
                return await sock.sendMessage(jid, { text: "✅ Welcoming sequence activated for new members." }, { quoted: msg });
            } 
            
            if (subAction === 'off') {
                settings.welcome[jid] = settings.welcome[jid] || { active: false, msg: "" };
                settings.welcome[jid].active = false;
                saveSettings();
                saveState();
                return await sock.sendMessage(jid, { text: "❌ Welcoming sequence deactivated." }, { quoted: msg });
            } 
            
            if (subAction === 'set') {
                const customMsg = parts.slice(1).join(' ').trim();
                if (!customMsg) return await sock.sendMessage(jid, { text: "❌ Provide a custom message." }, { quoted: msg });

                settings.welcome[jid] = settings.welcome[jid] || { active: true };
                settings.welcome[jid].msg = customMsg;
                saveSettings();
                saveState();
                return await sock.sendMessage(jid, { text: `✅ Custom welcome message set.` }, { quoted: msg });
            }

            const currentStatus = settings.welcome[jid]?.active ? "Enabled ✅" : "Disabled ❌";
            const prompt = `🌸 *Welcome Module Configuration:*\n\nStatus: \`${currentStatus}\``;
            await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
        }
    },

    // 17. GOODBYE MODULE CONTROLLER
    {
        name: 'goodbye',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'goodbye');
            if (!isAuthorized) return;

            if (!settings.goodbye) settings.goodbye = {};

            const parts = args ? args.split(' ') : [];
            const subAction = parts[0] ? parts[0].toLowerCase().trim() : '';

            if (subAction === 'on') {
                settings.goodbye[jid] = settings.goodbye[jid] || { active: true, msg: "" };
                settings.goodbye[jid].active = true;
                saveSettings();
                saveState();
                return await sock.sendMessage(jid, { text: "✅ Goodbye notification sequence activated." }, { quoted: msg });
            } 
            
            if (subAction === 'off') {
                settings.goodbye[jid] = settings.goodbye[jid] || { active: false, msg: "" };
                settings.goodbye[jid].active = false;
                saveSettings();
                saveState();
                return await sock.sendMessage(jid, { text: "❌ Goodbye notification sequence deactivated." }, { quoted: msg });
            } 
            
            if (subAction === 'set') {
                const customMsg = parts.slice(1).join(' ').trim();
                if (!customMsg) return await sock.sendMessage(jid, { text: "❌ Provide custom goodbye message." }, { quoted: msg });

                settings.goodbye[jid] = settings.goodbye[jid] || { active: true };
                settings.goodbye[jid].msg = customMsg;
                saveSettings();
                saveState();
                return await sock.sendMessage(jid, { text: `✅ Custom goodbye message set.` }, { quoted: msg });
            }

            const currentStatus = settings.goodbye[jid]?.active ? "Enabled ✅" : "Disabled ❌";
            const prompt = `🌸 *Goodbye Module Configuration:*\n\nStatus: \`${currentStatus}\``;
            await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
        }
    },

    // 18. CLEAR WELCOME CONFIGS
    {
        name: 'delwelcome',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'delwelcome');
            if (!isAuthorized) return;

            if (settings.welcome && settings.welcome[jid]) delete settings.welcome[jid];
            await sock.sendMessage(jid, { text: "✅ Welcome settings removed." }, { quoted: msg });
            saveSettings();
            saveState();
        }
    },

    // 19. CLEAR GOODBYE CONFIGS
    {
        name: 'delgoodbye',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'delgoodbye');
            if (!isAuthorized) return;

            if (settings.goodbye && settings.goodbye[jid]) delete settings.goodbye[jid];
            await sock.sendMessage(jid, { text: "✅ Goodbye settings removed." }, { quoted: msg });
            saveSettings();
            saveState();
        }
    },

    // 20. CREATE GROUP POLL
    {
        name: 'poll',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const match = args ? args.match(/^(.+?)\s*\((.+?)\)$/) : null;

            if (!match) return await sock.sendMessage(jid, { text: "❌ Format: Question? (Option1/Option2)" }, { quoted: msg });

            const question = match[1].trim();
            const options = match[2].split('/').map(o => o.trim()).filter(o => o);

            if (options.length < 2) return await sock.sendMessage(jid, { text: "❌ Minimum 2 options required." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { poll: { name: question, values: options, selectableCount: 1 } }, { quoted: msg });
            } catch (e) {}
        }
    },

    // 21. ANTI STATUS GROUP MENTION (.antigm)
    {
        name: 'antigm',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'antigm');
            if (!isAuthorized) return;

            if (!settings.antigm) settings.antigm = {};

            if (!args) {
                const current = settings.antigm[jid] || 'off';
                const prompt = `🔮 *Limitless AntiGroup-Mention status:* (Current: \`${current}\`)\n\nSelect an option:`;
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}antigm delete`, buttonText: { displayText: 'Delete' }, type: 1 },
                        { buttonId: `${settings.prefix}antigm warn`, buttonText: { displayText: 'Warn' }, type: 1 },
                        { buttonId: `${settings.prefix}antigm off`, buttonText: { displayText: 'Disable' }, type: 1 }
                    ],
                    headerType: 1
                };
                try { return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (e) { return await sock.sendMessage(jid, { text: prompt }, { quoted: msg }); }
            }

            const action = args.toLowerCase().trim();
            if (['warn', 'delete', 'kick', 'off'].includes(action)) {
                settings.antigm[jid] = action;
                await sock.sendMessage(jid, { text: `🔒 *Protection updated:* \`${action.toUpperCase()}\`` }, { quoted: msg });
                saveSettings();
                saveState();
            }
        }
    },

    // 22. CONVERSATION LOGGER & SUMMARIZER
    {
        name: 'gclog',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'gclog');
            if (!isAuthorized) return;

            if (!settings.gclogActive) settings.gclogActive = {};

            const action = args ? args.toLowerCase().trim() : '';

            if (action === 'on') {
                settings.gclogActive[jid] = true;
                await sock.sendMessage(jid, { text: "🔒 *GCLOG Activated.*" }, { quoted: msg });
                saveSettings();
                saveState();
                return;
            }

            if (action === 'off') {
                settings.gclogActive[jid] = false;
                await sock.sendMessage(jid, { text: "🔓 *GCLOG Deactivated.*" }, { quoted: msg });
                if (settings.conversationLogs?.[jid]) delete settings.conversationLogs[jid];
                saveSettings();
                saveState();
                return;
            }

            if (action === 'check') {
                const active = settings.gclogActive[jid];
                const logs = settings.conversationLogs?.[jid] || [];

                if (!active) return await sock.sendMessage(jid, { text: "⚠️ Log recorder is offline." }, { quoted: msg });
                if (logs.length === 0) return await sock.sendMessage(jid, { text: "📊 No logs found." }, { quoted: msg });

                await sock.sendMessage(jid, { text: "⏳ *Summarizing message flow...*" }, { quoted: msg });

                const logString = logs.map(l => `[${new Date(l.time).toLocaleTimeString()}] ${l.sender}: ${l.text}`).join('\n');
                const s1 = "gsk_";
                const s2 = "tPB0xMyZ2oijloaBNcDs";
                const s3 = "WGdyb3FY5iC2p9hwRE";
                const s4 = "SIJXAV3t53LZg9";
                const GROQ_API_KEY = s1 + s2 + s3 + s4;

                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${GROQ_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: "llama-3.3-70b-versatile",
                        messages: [
                            { role: "system", content: "You are Satoru Gojo. Summarize this log playfully and cockily. Keep it brief." },
                            { role: "user", content: logString }
                        ]
                    })
                });

                if (!response.ok) throw new Error();
                const data = await response.json();
                const responseText = data.choices?.[0]?.message?.content || "Could not generate summary.";

                await sock.sendMessage(jid, { text: `🤞 *LIMITLESS SYSTEM LOG SUMMARY:*\n\n${responseText}` }, { quoted: msg });
                return;
            }

            const activeStatus = settings.gclogActive[jid] ? "Active 🟢" : "Inactive 💤";
            const prompt = `📊 *Group Chat Log (GCLOG) Configuration:*\n\nStatus: \`${activeStatus}\``;
            await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
        }
    },

    // 23. CREATE NEW GROUP CHAT
    {
        name: 'creategc',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            if (!args) return await sock.sendMessage(jid, { text: "❌ Provide a group name." }, { quoted: msg });

            try {
                const senderJid = msg.key.participant || msg.key.remoteJid;
                const phoneJid = await resolveToPhoneJid(sock, senderJid);
                if (!phoneJid) return await sock.sendMessage(jid, { text: "❌ Resolution failed." }, { quoted: msg });

                const group = await sock.groupCreate(args, [phoneJid]);
                await sock.sendMessage(jid, { text: `• Name: \`${args}\`\n• ID: \`${group.id}\`` }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 24. EXORCISE ALL TARGETS
    {
        name: 'kickall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;
            if (!isOwner && !isSudo) return;

            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants;

                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const botLid = sock.user.id.split(':')[0] + '@lid';
                const botParticipant = participants.find(p => p.id === botJid || p.id === botLid);
                const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

                if (!isBotAdmin) return await sock.sendMessage(jid, { text: "❌ I must be an administrator in this group first!" }, { quoted: msg });

                await sock.sendMessage(jid, { text: "🌪️ *Channelling Limitless Void... Exorcising all members from this domain.*" }, { quoted: msg });

                const targets = participants.filter(p => 
                    p.id !== botJid && p.id !== botLid && 
                    p.id.split('@')[0] !== settings.ownerNumber && 
                    !settings.devs.includes(p.id.split('@')[0]) &&
                    p.admin !== 'superadmin' && p.admin !== 'admin'
                ).map(p => p.id);

                if (targets.length === 0) return await sock.sendMessage(jid, { text: "❌ No non-admin targets found." }, { quoted: msg });

                global.kickallActive[jid] = true;

                for (const target of targets) {
                    if (!global.kickallActive[jid]) {
                        await sock.sendMessage(jid, { text: "🛑 *Exorcism sequence aborted by administrator.*" });
                        break;
                    }
                    try {
                        await sock.groupParticipantsUpdate(jid, [target], "remove");
                        await new Promise(r => setTimeout(r, 1000)); 
                    } catch (err) {}
                }

                delete global.kickallActive[jid];
                await sock.sendMessage(jid, { text: "✅ *Exorcism complete.*" });
            } catch (error) {}
        }
    },

    // 25. ABORT EXORCISM SEQUENCE
    {
        name: 'stopkickall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            if (global.kickallActive[jid]) {
                global.kickallActive[jid] = false;
                await sock.sendMessage(jid, { text: "🛑 *Stopping exorcism...*" }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: "❌ No active operation running." }, { quoted: msg });
            }
        }
    },

    // 26. TIMED KICK CONTROLLER
    {
        name: 'tkick',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'tkick');
            if (!isAuthorized) return;

            const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const targets = mentions.length > 0 ? mentions : [parseTargetUser(msg, args)];
            const cleanTargets = targets.filter(t => t && t.split('@')[0] !== settings.ownerNumber);

            const durationString = args.replace(/@[^ ]+/g, '').trim().split(' ')[0] || '';
            if (durationString.toLowerCase() === 'cancel' || durationString.toLowerCase() === 'stop') {
                return await commands[`${settings.prefix}tkick_cancel_all`](sock, msg, args, { isOwner });
            }

            if (cleanTargets.length === 0) {
                const activeKeys = Object.keys(global.tkickTimers).filter(k => k.startsWith(jid));
                if (activeKeys.length === 0) return await sock.sendMessage(jid, { text: "❌ No pending timed kicks found." }, { quoted: msg });

                let list = "⏳ *PENDING TIMED KICKS:*\n\n";
                activeKeys.forEach((key, idx) => {
                    const task = global.tkickTimers[key];
                    const remainingSec = Math.max(0, Math.floor((task.endTime - Date.now()) / 1000));
                    list += `${idx + 1}. @${task.targetJid.split('@')[0]} — Remaining: *${remainingSec}s*\n`;
                });
                return await sock.sendMessage(jid, { text: list, mentions: activeKeys.map(k => global.tkickTimers[k].targetJid) }, { quoted: msg });
            }

            const durationMs = parseDuration(durationString);
            if (!durationMs) return await sock.sendMessage(jid, { text: "❌ Invalid duration." }, { quoted: msg });

            for (const target of cleanTargets) {
                const timerKey = `${jid}_${target}`;
                if (global.tkickTimers[timerKey]) clearTimeout(global.tkickTimers[timerKey].timeoutId);

                const timeoutId = setTimeout(async () => {
                    try {
                        await sock.groupParticipantsUpdate(jid, [target], "remove");
                        await sock.sendMessage(jid, { text: `🌪️ *Timer Elapsed.* Exorcised: @${target.split('@')[0]}`, mentions: [target] });
                    } catch (err) {}
                    delete global.tkickTimers[timerKey];
                }, durationMs);

                global.tkickTimers[timerKey] = { timeoutId, targetJid: target, endTime: Date.now() + durationMs };
            }

            await sock.sendMessage(jid, { text: `⏳ Timed kick set for ${cleanTargets.length} member(s).`, mentions: cleanTargets }, { quoted: msg });
        }
    },

    // 27. CANCEL ALL TIMED KICKS IN GROUP
    {
        name: 'tkick_cancel_all',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'tkick_cancel_all');
            if (!isAuthorized) return;

            const activeKeys = Object.keys(global.tkickTimers).filter(k => k.startsWith(jid));
            if (activeKeys.length === 0) return await sock.sendMessage(jid, { text: "❌ No pending timed kicks found." }, { quoted: msg });

            activeKeys.forEach(key => {
                clearTimeout(global.tkickTimers[key].timeoutId);
                delete global.tkickTimers[key];
            });

            await sock.sendMessage(jid, { text: "✅ Cancelled all pending timed kicks in this group." }, { quoted: msg });
        }
    },

    // 28. FETCH GROUP JID
    {
        name: 'gcjid',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            await sock.sendMessage(jid, { text: `🆔 *Group JID:* \`${jid}\`` }, { quoted: msg });
        }
    },

    // 29. ANTISPAM CONTROLLER PANEL
    {
        name: 'antispam',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'antispam');
            if (!isAuthorized) return;

            if (!settings.antispam) settings.antispam = {};

            const action = args ? args.toLowerCase().trim() : '';

            if (action === 'on') {
                settings.antispam[jid] = settings.antispam[jid] || { status: 'on', rate: { count: 1, seconds: 2 } };
                settings.antispam[jid].status = 'on';
                saveSettings();
                saveState();
                return await sock.sendMessage(jid, { text: "🔒 *Antispam Activated.*" }, { quoted: msg });
            }

            if (action === 'off') {
                if (settings.antispam[jid]) settings.antispam[jid].status = 'off';
                saveSettings();
                saveState();
                return await sock.sendMessage(jid, { text: "🔓 *Antispam Deactivated.*" }, { quoted: msg });
            }

            if (action.startsWith('trig')) {
                const param = action.replace('trig', '').trim(); 
                const match = param.match(/^(\d+)\/(\d+)s$/);

                if (!match) return await sock.sendMessage(jid, { text: "❌ Format: .antispam trig 1/2s" }, { quoted: msg });

                const count = parseInt(match[1]);
                const seconds = parseInt(match[2]);

                settings.antispam[jid] = settings.antispam[jid] || { status: 'on' };
                settings.antispam[jid].rate = { count, seconds };
                settings.antispam[jid].status = 'on';
                saveSettings();
                saveState();

                return await sock.sendMessage(jid, { text: `✅ *Spam threshold modified:* \`${count} messages per ${seconds}s\`.` }, { quoted: msg });
            }

            const current = settings.antispam[jid]?.status || 'off';
            const rate = settings.antispam[jid]?.rate ? `${settings.antispam[jid].rate.count}/${settings.antispam[jid].rate.seconds}s` : '1/2s';
            const prompt = `🛡️ *Antispam Moderation Panel:* (Status: \`${current.toUpperCase()}\`)\nThreshold: \`${rate}\``;
            await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
        }
    },

    // 30. .silence MODULE
    {
        name: 'silence',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'silence');
            if (!isAuthorized) return;

            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const repliedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
            const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const targetJid = repliedJid || (mentions.length > 0 ? mentions[0] : '');

            if (!targetJid || targetJid === senderJid) return await sock.sendMessage(jid, { text: "❌ Specify a user to silence." }, { quoted: msg });

            const targetNum = targetJid.split('@')[0];
            const cleanArgs = args ? args.replace(/@[^ ]+/g, '').trim() : '';
            const parts = cleanArgs.split(' ');
            
            let mode = '';
            let timerStr = '1h'; 

            if (parts[0]) {
                if (['-s', '-m', 'all'].includes(parts[0])) {
                    mode = parts[0];
                    if (parts[1]) timerStr = parts[1];
                } else {
                    timerStr = parts[0];
                }
            }

            const durationMs = parseDuration(timerStr) || 3600000; 

            if (!mode) {
                const prompt = `⛓️ *Silence Detention Panel:* @${targetNum}\n\nSelect type:`;
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}silence_ans sticker ${targetNum} ${timerStr}`, buttonText: { displayText: 'Stickers Only' }, type: 1 },
                        { buttonId: `${settings.prefix}silence_ans message ${targetNum} ${timerStr}`, buttonText: { displayText: 'Messages' }, type: 1 },
                        { buttonId: `${settings.prefix}silence_ans all ${targetNum} ${timerStr}`, buttonText: { displayText: 'Silence All' }, type: 1 }
                    ],
                    headerType: 1,
                    mentions: [targetJid]
                };
                try { return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (e) { return await sock.sendMessage(jid, { text: prompt }, { quoted: msg }); }
            }

            let mappedType = 'all';
            if (mode === '-s') mappedType = 'sticker';
            if (mode === '-m') mappedType = 'message';

            global.silencedUsers[jid] = global.silencedUsers[jid] || {};
            global.silencedUsers[jid][targetJid] = { type: mappedType, endTime: Date.now() + durationMs };

            await sock.sendMessage(jid, { text: `⛓️ *Target @${targetNum} silenced:* \`${mappedType.toUpperCase()}\` for *${timerStr}*.`, mentions: [targetJid] }, { quoted: msg });
        }
    },

    // 31. .silence_ans DETENTION SECURE INTERACTOR BUTTON HANDLER
    {
        name: 'silence_ans',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!args) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'silence');
            if (!isAuthorized) return;

            const parts = args.split(' ');
            const type = parts[0]?.toLowerCase().trim(); 
            const targetNum = parts[1]?.trim();
            const timerStr = parts[2]?.trim() || '1h';

            if (!type || !targetNum) return;

            const targetJid = `${targetNum}@s.whatsapp.net`;
            const durationMs = parseDuration(timerStr) || 3600000;

            global.silencedUsers[jid] = global.silencedUsers[jid] || {};
            global.silencedUsers[jid][targetJid] = { type: type, endTime: Date.now() + durationMs };

            await sock.sendMessage(jid, { text: `⛓️ *Target @${targetNum} silenced:* \`${type.toUpperCase()}\` for *${timerStr}*.`, mentions: [targetJid] }, { quoted: msg });
        }
    },

    // 32. .unsilence COMMAND
    {
        name: 'unsilence',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'unsilence');
            if (!isAuthorized) return;

            const repliedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
            const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const targetJid = repliedJid || (mentions.length > 0 ? mentions[0] : '');

            if (!targetJid) return await sock.sendMessage(jid, { text: "❌ Specify target user." }, { quoted: msg });

            const targetNum = targetJid.split('@')[0];

            if (global.silencedUsers[jid] && global.silencedUsers[jid][targetJid]) {
                delete global.silencedUsers[jid][targetJid];
                await sock.sendMessage(jid, { text: `⛓️ *Target @${targetNum} unsilenced.*`, mentions: [targetJid] }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: `❌ Target @${targetNum} is not currently silenced.`, mentions: [targetJid] }, { quoted: msg });
            }
        }
    },

    // 33. GROUP ALERTS CONTROLLER (.gcalerts)
    {
        name: 'gcalerts',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return await sock.sendMessage(jid, { text: "❌ Group required." }, { quoted: msg });

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'gcalerts');
            if (!isAuthorized) return;

            if (!settings.gcalerts) {
                settings.gcalerts = { promote: {}, demote: {}, welcome: {}, goodbye: {} };
            }

            const parts = args ? args.toLowerCase().trim().split(' ') : [];
            const sub = parts[0] || ''; 
            const toggle = parts[1] || ''; 

            const validSubs = ['promote', 'demote', 'welcome', 'goodbye'];
            if (!validSubs.includes(sub)) {
                const promStatus = settings.gcalerts.promote?.[jid] || 'off';
                const demStatus = settings.gcalerts.demote?.[jid] || 'off';
                const welStatus = settings.gcalerts.welcome?.[jid] || 'off';
                const gbStatus = settings.gcalerts.goodbye?.[jid] || 'off';

                return await sock.sendMessage(jid, {
                    text: `🔔 *Group Alerts Dashboard (gcalerts)* 🔔\n` +
                          `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `• *Promote Alert:* \`${promStatus.toUpperCase()}\`\n` +
                          `• *Demote Alert:* \`${demStatus.toUpperCase()}\`\n` +
                          `• *Welcome Alert:* \`${welStatus.toUpperCase()}\`\n` +
                          `• *Goodbye Alert:* \`${gbStatus.toUpperCase()}\`\n\n` +
                          `👉 To toggle: \`${settings.prefix}gcalerts <promote/demote/welcome/goodbye> <on/off>\``
                }, { quoted: msg });
            }

            if (toggle !== 'on' && toggle !== 'off') return await sock.sendMessage(jid, { text: `❌ Use 'on' or 'off'.` }, { quoted: msg });

            settings.gcalerts[sub] = settings.gcalerts[sub] || {};
            settings.gcalerts[sub][jid] = toggle;
            
            if (sub === 'welcome') {
                settings.welcome = settings.welcome || {};
                settings.welcome[jid] = settings.welcome[jid] || {};
                settings.welcome[jid].active = (toggle === 'on');
            }
            if (sub === 'goodbye') {
                settings.goodbye = settings.goodbye || {};
                settings.goodbye[jid] = settings.goodbye[jid] || {};
                settings.goodbye[jid].active = (toggle === 'on');
            }

            saveSettings();
            saveState();

            await sock.sendMessage(jid, { text: `✅ *Alert updated:* ${sub.toUpperCase()} alert is now \`${toggle.toUpperCase()}\`` }, { quoted: msg });
        }
    },

    // 34. ANTI GCSTATUS PROTECTION PANEL (.antigcstatus)
    {
        name: 'antigcstatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'antigcstatus');
            if (!isAuthorized) return;

            if (!settings.antigcstatus) {
                settings.antigcstatus = 'off';
            }

            if (!args) {
                const current = settings.antigcstatus || 'off';
                const prompt = `🛡️ *Anti-Status Protection Panel (antigcstatus)* 🛡️\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                               `Status: \`${current.toUpperCase()}\`\n\n` +
                               `Select a moderate policy below:`;

                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}antigcstatus warn`, buttonText: { displayText: 'Warn ⚠️' }, type: 1 },
                        { buttonId: `${settings.prefix}antigcstatus delete`, buttonText: { displayText: 'Delete 🗑️' }, type: 1 },
                        { buttonId: `${settings.prefix}antigcstatus kick`, buttonText: { displayText: 'Kick 🛑' }, type: 1 }
                    ],
                    headerType: 1
                };

                try {
                    return await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (e) {
                    return await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }
            }

            const action = args.toLowerCase().trim();

            if (['warn', 'delete', 'kick', 'off'].includes(action)) {
                settings.antigcstatus = action;
                saveSettings();
                saveState();
                await sock.sendMessage(jid, { text: `🔒 *Anti-Status Protection updated:* \`${action.toUpperCase()}\`` }, { quoted: msg });
            }
        }
    },

    // 35. MULTI-TAG LOOPER SPAMMER (.spamtag)
    {
        name: 'spamtag',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            // Enforce administrative permissions
            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, 'spamtag');
            if (!isAuthorized) return;

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `❌ *Usage:* \`${settings.prefix}spamtag <number> <text>\` or reply directly to a message with \`${settings.prefix}spamtag <number>\`` 
                }, { quoted: msg });
            }

            const parts = args.trim().split(' ');
            const count = parseInt(parts[0]);
            if (isNaN(count) || count < 1) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a valid loop number." }, { quoted: msg });
            }

            // Cap the loop count to protect account standing
            const finalCount = Math.min(count, 30); 

            let textToSend = parts.slice(1).join(' ').trim();
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!textToSend && quoted) {
                const rawContent = getRawMessage(quoted);
                textToSend = rawContent?.conversation || rawContent?.extendedTextMessage?.text || rawContent?.imageMessage?.caption || '';
            }

            if (!textToSend) textToSend = "🔔 *Attention Everyone!*";

            const groupMetadata = await sock.groupMetadata(jid);
            const participants = groupMetadata.participants.map(p => p.id);

            for (let i = 0; i < finalCount; i++) {
                await sock.sendMessage(jid, { text: textToSend, mentions: participants });
                await new Promise(resolve => setTimeout(resolve, 1000)); // 1-second delay
            }
        }
    }
];

// Structural Aliases Configuration
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'antilink') aliases.push({ ...cmd, name: 'infinity' });
    if (cmd.name === 'link') {
        aliases.push({ ...cmd, name: 'invite' });
        aliases.push({ ...cmd, name: 'gclink' });
    }
    if (cmd.name === 'mute') {
        aliases.push({ ...cmd, name: 'unmute' });
        aliases.push({ ...cmd, name: 'open' });
        aliases.push({ ...cmd, name: 'close' });
        aliases.push({ ...cmd, name: 'lock' });
        aliases.push({ ...cmd, name: 'unlock' });
    }
});
module.exports.push(...aliases);