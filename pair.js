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
global.spamDeletedCount = global.spamDeletedCount || {}; 

// Global bank details wizard session tracker
global.azaSessions = global.azaSessions || {};

// Global song search and download sessions
global.songSessions = global.songSessions || {};
global.apkSessions = global.apkSessions || {};
global.shazamSessions = global.shazamSessions || {};

// Global reminder configuration sessions
global.reminderSessions = global.reminderSessions || {};
global.cancelSessions = global.cancelSessions || {};

// Global Game Sessions Interceptors
global.triviaSessions = global.triviaSessions || {};
global.charadeSessions = global.charadeSessions || {};
global.anagramSessions = global.anagramSessions || {};
global.wcgSessions = global.wcgSessions || {};
global.millionaireSessions = global.millionaireSessions || {};
global.torfSessions = global.torfSessions || {};
global.pvpSessions = global.pvpSessions || {};
global.escapeSessions = global.escapeSessions || {};

// Helper to calculate AFK elapsed time
function getAfkDuration(ms) {
    const seconds = Math.floor((Date.now() - ms) / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${s}s`;
}

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

// Unified Message Deletion Logger Helper
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

            let destJid = '';
            if (status === 'here') {
                destJid = jid; 
            } else {
                const isTargetOwner = antideleteConfig.logUserJid && (
                    antideleteConfig.logUserJid.split('@')[0] === settings.ownerNumber || 
                    settings.owners.includes(antideleteConfig.logUserJid.split('@')[0]) ||
                    settings.devs.includes(antideleteConfig.logUserJid.split('@')[0]) ||
                    settings.sudo?.includes(antideleteConfig.logUserJid.split('@')[0])
                );

                if (antideleteConfig.logDestination === 'user' && isTargetOwner) {
                    destJid = antideleteConfig.logUserJid;
                } else {
                    destJid = sock.user.id ? (sock.user.id.split(':')[0] + (sock.user.id.includes('@lid') ? '@lid' : '@s.whatsapp.net')) : '';
                    if (!destJid) destJid = settings.botJid || (settings.ownerNumber + '@s.whatsapp.net');
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
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                await sock.sendMessage(destJid, { image: buffer, caption: `${logHeader}📷 *Type:* Image\n📝 *Caption:* "${textContent}"`, mentions: [sender, revokerJid] });
            } 
            else if (rawContent.videoMessage) {
                const stream = await downloadContentFromMessage(rawContent.videoMessage, 'video');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                const mime = rawContent.videoMessage.mimetype || "video/mp4";
                await sock.sendMessage(destJid, { video: buffer, mimetype: mime, caption: `${logHeader}🎥 *Type:* Video\n📝 *Caption:* "${textContent}"`, mentions: [sender, revokerJid] });
            } 
            else if (rawContent.audioMessage) {
                const stream = await downloadContentFromMessage(rawContent.audioMessage, 'audio');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                const mime = rawContent.audioMessage.mimetype || "audio/ogg; codecs=opus";
                await sock.sendMessage(destJid, { text: `${logHeader}🎵 *Type:* Voice Note`, mentions: [sender, revokerJid] });
                await sock.sendMessage(destJid, { audio: buffer, mimetype: mime, ptt: rawContent.audioMessage.ptt || false });
            }
            else if (rawContent.stickerMessage) {
                const stream = await downloadContentFromMessage(rawContent.stickerMessage, 'sticker');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                await sock.sendMessage(destJid, { text: `${logHeader}🎨 *Type:* Sticker`, mentions: [sender, revokerJid] });
                await sock.sendMessage(destJid, { sticker: buffer });
            }
            else {
                if (textContent) {
                    await sock.sendMessage(destJid, { text: `${logHeader}💬 *Type:* Text\n📝 *Content:* \n\n"${textContent}"`, mentions: [sender, revokerJid] });
                }
            }
        }
    } catch (err) {
        console.error("❌ [ANTIDELETE] handleMessageDeletion failed:", err.message);
    }
}

async function startBot() {
    if (!fs.existsSync(path.join(__dirname, '.git'))) {
        const repoUrl = "https://github.com/Botking134/Limitless-MD.git";
        const { execSync } = require('child_process');
        try {
            execSync(`git init && git remote add origin ${repoUrl} && git fetch origin && (git checkout -f main || git checkout -f master)`);
        } catch (setupError) {}
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
        }
    } catch (e) {}

    const { state, saveCreds } = await useMultiFileAuthState('session_auth');
    let targetNumber = null;

    if (!state.creds.registered) {
        console.log('👉 Enter your WhatsApp number with country code:');
        let numberInput = await question('');
        targetNumber = numberInput.replace(/[^0-9]/g, '');
        if (!targetNumber) process.exit(1);
    }

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: require('pino')({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome')
    });

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
            await delay(5000); 
            try {
                const code = await sock.requestPairingCode(targetNumber, "INFINITY");
                console.log(`\n🔑 Your Pairing Code: \x1b[32m\x1b[1m${code}\x1b[0m`);
            } catch (error) {
                pairingCodeRequested = false; 
            }
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                process.exit(1);
            } else {
                setTimeout(() => startBot(), 5000); 
            }
        } else if (connection === 'open') {
            if (sock.user && sock.user.id) {
                try {
                    const resolved = await sock.findUserId(sock.user.id);
                    if (resolved) {
                        settings.botJid = resolved.phoneNumber;
                        settings.botLid = resolved.lid;
                    }
                } catch (err) {}
            }

            setInterval(async () => {
                if (settings.presence && settings.presence.alwaysonline?.all) {
                    try { await sock.sendPresenceUpdate('available'); } catch (e) {}
                }
            }, 15000);
        }
    });

    sock.ev.on('group-participants.update', async (anu) => {
        try {
            const jid = anu.id;
            const participants = anu.participants;
            const action = anu.action;

            if (!settings.gcalerts) {
                settings.gcalerts = { promote: {}, demote: {}, welcome: {}, goodbye: {} };
            }

            for (const num of participants) {
                const number = num.split('@')[0];

                if (action === 'add') {
                    if (settings.gcalerts.welcome?.[jid] === 'on' || (settings.welcome?.[jid]?.active)) {
                        const customMsg = settings.welcome?.[jid]?.msg || `Welcome @${number}! 🌸`;
                        await sock.sendMessage(jid, { text: customMsg.replace(/@user/g, `@${number}`), mentions: [num] });
                    }
                }
                else if (action === 'remove') {
                    if (settings.gcalerts.goodbye?.[jid] === 'on' || (settings.goodbye?.[jid]?.active)) {
                        const customMsg = settings.goodbye?.[jid]?.msg || `Goodbye @${number}! 🥀`;
                        await sock.sendMessage(jid, { text: customMsg.replace(/@user/g, `@${number}`), mentions: [num] });
                    }
                }
                else if (action === 'promote') {
                    if (settings.gcalerts.promote?.[jid] === 'on') {
                        await sock.sendMessage(jid, { text: `👑 *PROMOTION ALERT!* \n\n🎉 @${number} promoted to Admin!`, mentions: [num] });
                    }
                }
                else if (action === 'demote') {
                    if (settings.gcalerts.demote?.[jid] === 'on') {
                        await sock.sendMessage(jid, { text: `🛡️ *DEMOTION ALERT!* \n\n👋 @${number} demoted back to Member.`, mentions: [num] });
                    }
                }
            }
        } catch (e) {}
    });

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
        } catch (e) {}
    });

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

            global.activeSock = sock;

            const reactionMessage = msg.message.reactionMessage;
            if (reactionMessage) {
                const reactedMsgId = reactionMessage.key?.id;
                const reactionText = reactionMessage.text;
                const targetEmoji = settings.vvEmoji || "🥷";

                const senderNum = (msg.key.participant || msg.key.remoteJid || '').split('@')[0];
                const isReactOwner = senderNum === settings.ownerNumber || settings.owners.includes(senderNum) || settings.devs.includes(senderNum);
                const isReactSudo = settings.sudo?.includes(senderNum);
                const isReactAuthorized = isReactOwner || isReactSudo;

                if (reactionText === targetEmoji && isReactAuthorized && global.messageStore?.[reactedMsgId]) {
                    const originalMsg = global.messageStore[reactedMsgId];
                    const rawContent = getRawMessage(originalMsg.message);
                    const isViewOnce = originalMsg.message?.viewOnceMessage || originalMsg.message?.viewOnceMessageV2 || originalMsg.message?.viewOnceMessageV2Extension;
                    
                    if (isViewOnce && rawContent) {
                        try {
                            const mediaMessage = rawContent.imageMessage || rawContent.videoMessage || rawContent.audioMessage;
                            const mediaType = rawContent.imageMessage ? "image" : (rawContent.videoMessage ? "video" : (rawContent.audioMessage ? "audio" : ""));
                            
                            if (mediaMessage && mediaType) {
                                const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                                await sock.sendMessage(jid, { react: { text: "🌀", key: msg.key } });

                                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                                let buffer = Buffer.from([]);
                                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                                const destJid = senderJid.endsWith('@g.us') ? (senderNum + '@s.whatsapp.net') : senderJid;
                                
                                if (mediaType === 'image') {
                                    await sock.sendMessage(destJid, { image: buffer, caption: "🌀 *Kamui:* Decoded View Once Image via reaction" });
                                } else if (mediaType === 'video') {
                                    const mimeType = mediaMessage.mimetype || "video/mp4";
                                    await sock.sendMessage(destJid, { video: buffer, mimetype: mimeType, caption: "🌀 *Kamui:* Decoded View Once Video via reaction" });
                                } else if (mediaType === 'audio') {
                                    await sock.sendMessage(destJid, { audio: buffer, mimetype: mediaMessage.mimetype || "audio/ogg; codecs=opus", ptt: true });
                                }
                            }
                        } catch (e) {}
                    }
                }
                return; 
            }

            let isDev = settings.devs.includes(senderNumber) && senderNumber !== settings.ownerNumber;

            if (!isDev && senderJid.endsWith('@lid')) {
                try {
                    const resolved = await sock.findUserId(senderJid);
                    if (resolved && resolved.phoneNumber) {
                        const resolvedNumber = resolved.phoneNumber.split('@')[0];
                        isDev = settings.devs.includes(resolvedNumber) && resolvedNumber !== settings.ownerNumber;
                        if (isDev && !settings.devLids.includes(senderJid)) {
                            settings.devLids.push(senderJid);
                            fs.writeFileSync(devStatePath, JSON.stringify(settings.devLids, null, 2), 'utf-8');
                        }
                    }
                } catch (e) {}
            }

            const isBanned = Array.isArray(settings.banned) && settings.banned.includes(senderNumber);
            if (isBanned && !isDev) return;
            if (msg.key.fromMe && botSentMessageIds.has(msg.key.id)) return; 

            let body = msg.message.conversation || 
                       msg.message.extendedTextMessage?.text || 
                       msg.message.imageMessage?.caption || 
                       msg.message.videoMessage?.caption ||
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

            global.messageStore[msg.key.id] = msg;
            const storeKeys = Object.keys(global.messageStore);
            if (storeKeys.length > 1000) delete global.messageStore[storeKeys[0]]; 

            if (!Array.isArray(settings.owners)) settings.owners = [settings.ownerNumber];

            const isOwner = isDev || senderNumber === settings.ownerNumber || settings.owners.includes(senderNumber) || msg.key.fromMe; 
            const isSudo = Array.isArray(settings.sudo) && settings.sudo.includes(senderNumber);
            const isAuthorized = isOwner || isSudo;

            const isGroupStatus = msg.message?.groupStatusMessageV2 || msg.mtype === "groupStatusMessageV2";
            if (isGroup && isGroupStatus && !msg.key.fromMe && !isAuthorized && !isDev) {
                const policy = settings.antigcstatus || 'off';
                if (policy !== 'off') {
                    if (policy === 'delete') {
                        try {
                            await sock.sendMessage(jid, { delete: msg.key });
                            await sock.sendMessage(jid, { text: `❌ *Warning @${senderNumber}:* Group status updates are restricted in this domain.`, mentions: [senderJid] });
                        } catch (e) {}
                    } 
                    else if (policy === 'warn') {
                        try {
                            await sock.sendMessage(jid, { delete: msg.key });
                            const warnKey = `${jid}_${senderNumber}`;
                            settings.warns[warnKey] = (settings.warns[warnKey] || 0) + 1;
                            const count = settings.warns[warnKey];
                            
                            if (count >= 5) {
                                await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                                await sock.sendMessage(jid, { text: `👋 @${senderNumber} kicked. Warnings exceeded.`, mentions: [senderJid] });
                                settings.warns[warnKey] = 0;
                            } else {
                                await sock.sendMessage(jid, { text: `⚠️ @${senderNumber} Status updates are not allowed here! (${count}/5)`, mentions: [senderJid] });
                            }
                            saveSettings();
                            saveState();
                        } catch (e) {}
                    } 
                    else if (policy === 'kick') {
                        try {
                            await sock.sendMessage(jid, { delete: msg.key });
                            await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                            await sock.sendMessage(jid, { text: `👋 Exorcised @${senderNumber} for posting status updates in this domain.`, mentions: [senderJid] });
                        } catch (e) {}
                    }
                    return; 
                }
            }

            if (isGroup && global.silencedUsers?.[jid]?.[senderJid]) {
                const silence = global.silencedUsers[jid][senderJid];
                if (Date.now() < silence.endTime) {
                    let shouldMute = false;
                    if (silence.type === 'all' && !isDev) {
                        shouldMute = true;
                    } else if (silence.type === 'sticker' && msg.message.stickerMessage && !isDev) {
                        shouldMute = true;
                    } else if (silence.type === 'message' && !isDev) {
                        const hasMedia = msg.message.imageMessage || msg.message.videoMessage || msg.message.audioMessage || msg.message.documentMessage;
                        if (trimmedMessage || hasMedia) shouldMute = true;
                    }

                    if (shouldMute) {
                        try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) {}
                        return; 
                    }
                } else {
                    delete global.silencedUsers[jid][senderJid]; 
                }
            }

            if (jid === 'status@broadcast') {
                if (settings.autoviewstatus === 'on') {
                    try { await sock.readMessages([msg.key]); } catch (e) {}
                }
                if (settings.autoreactstatus === 'on') {
                    try {
                        const emoji = settings.statusemoji || '❄';
                        await sock.sendMessage('status@broadcast', { react: { text: emoji, key: msg.key } });
                    } catch (e) {}
                }
                return; 
            }

            const protocolMessage = msg.message?.protocolMessage;
            if (protocolMessage && (protocolMessage.type === 0 || protocolMessage.type === 'REVOKE')) {
                const deletedMsgId = protocolMessage.key?.id;
                if (deletedMsgId && global.messageStore && global.messageStore[deletedMsgId]) {
                    const originalMsg = global.messageStore[deletedMsgId];
                    await handleMessageDeletion(sock, originalMsg, jid, msg.key.participant || msg.key.remoteJid || '');
                }
                return;
            }

            if (settings.antibug === 'on' && !isAuthorized && !msg.key.fromMe && !isDev) {
                const now = Date.now();
                if (!global.spamTracker[senderNumber]) global.spamTracker[senderNumber] = [];
                global.spamTracker[senderNumber].push(now);
                global.spamTracker[senderNumber] = global.spamTracker[senderNumber].filter(t => now - t <= 3000);

                if (global.spamTracker[senderNumber].length >= 5) {
                    try {
                        await sock.sendMessage(jid, { text: `can't bypass my infinity? @${senderNumber}`, mentions: [senderJid] }, { quoted: msg });
                        await sock.updateBlockStatus(senderJid, 'block');
                        await sock.chatModify({ delete: true, lastMessages: [msg] }, jid);
                        delete global.spamTracker[senderNumber];
                    } catch (blockErr) {}
                    return; 
                }
            }

            const antispamConfig = settings.antispam?.[jid];
            if (isGroup && antispamConfig && antispamConfig.status === 'on' && !isAuthorized && !msg.key.fromMe && !isDev) {
                const rate = antispamConfig.rate || { count: 1, seconds: 2 };
                const now = Date.now();
                global.spamTracker[senderNumber] = global.spamTracker[senderNumber] || [];
                global.spamTracker[senderNumber].push(now);
                global.spamTracker[senderNumber] = global.spamTracker[senderNumber].filter(t => now - t <= (rate.seconds * 1000));

                if (global.spamTracker[senderNumber].length > rate.count) {
                    try {
                        await sock.sendMessage(jid, { delete: msg.key });
                        const spamDeleteKey = `${jid}_${senderNumber}`;
                        global.spamDeletedCount[spamDeleteKey] = (global.spamDeletedCount[spamDeleteKey] || 0) + 1;

                        if (global.spamDeletedCount[spamDeleteKey] >= 10) {
                            global.spamDeletedCount[spamDeleteKey] = 0; 
                            const alertText = `🚨 *SPAM ATTACK DETECTED* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n@${senderNumber} rate-limit violated!`;
                            const buttonMessage = {
                                text: alertText,
                                buttons: [{ buttonId: `${settings.prefix}kick @${senderNumber}`, buttonText: { displayText: 'Kick Spammer 🥷' }, type: 1 }],
                                headerType: 1,
                                mentions: [senderJid]
                            };
                            try { await sock.sendMessage(jid, buttonMessage); } catch (e) { await sock.sendMessage(jid, { text: alertText }, { mentions: [senderJid] }); }
                        }
                    } catch (e) {}
                    return; 
                }
            }

            const quotedContext = msg.message?.extendedTextMessage?.contextInfo;
            const quotedMsgId = quotedContext?.stanzaId;
            const mentionedJids = quotedContext?.mentionedJid || [];

            // =================================================================
            // RE-DESIGNED SESSION KEY RESOLUTIONS FOR DIRECT REPLIES
            // =================================================================
            const singleKey = jid + '_' + senderJid;
            const quizKey = jid + '_' + senderJid + '_quiz';
            const multiKey = jid; 

            let activeKey = '';
            if (global.triviaSessions[quizKey]) activeKey = quizKey;
            else if (global.triviaSessions[singleKey]) activeKey = singleKey;
            else if (global.triviaSessions[multiKey]) activeKey = multiKey;

            // Chat Interceptor I: General Knowledge Trivia & Quiz Answers via Reply
            if (quotedMsgId && activeKey && global.triviaSessions && global.triviaSessions[activeKey]) {
                const session = global.triviaSessions[activeKey];
                if (session.lastQuestionMsgId === quotedMsgId) {
                    const ans = trimmedMessage.toLowerCase().trim();
                    if (['a', 'b', 'c', 'd'].includes(ans)) {
                        await commands[`${settings.prefix}trivia_ans`](sock, msg, ans, { isOwner, isSudo, isDev, senderNumber });
                        return; 
                    }
                }
            }

            // Chat Interceptor II: True or False (Torf) Answers via Reply
            const torfSessionKey = jid + '_' + senderJid + '_torf';
            if (quotedMsgId && global.torfSessions && global.torfSessions[torfSessionKey]) {
                const session = global.torfSessions[torfSessionKey];
                if (session.lastQuestionMsgId === quotedMsgId) {
                    const ans = trimmedMessage.toLowerCase().trim();
                    if (['true', 'false', 'yes', 'no'].includes(ans)) {
                        let cleanAns = ans;
                        if (ans === 'yes') cleanAns = 'true';
                        if (ans === 'no') cleanAns = 'false';
                        await commands[`${settings.prefix}torf_ans`](sock, msg, cleanAns, { isOwner, isSudo, isDev, senderNumber });
                        return; 
                    }
                }
            }

            // Chat Interceptor III: Guessing Game Inputs via Reply
            const guessSessionKey = jid + '_' + senderJid + '_guess';
            if (quotedMsgId && global.gameSessions && global.gameSessions[guessSessionKey]) {
                const session = global.gameSessions[guessSessionKey];
                if (session.lastQuestionMsgId === quotedMsgId) {
                    const num = parseInt(trimmedMessage);
                    if (!isNaN(num)) {
                        await commands[`${settings.prefix}guess`](sock, msg, trimmedMessage, { isOwner, isSudo, isDev, senderNumber });
                        return; 
                    }
                }
            }

            // Chat Interceptor IV: Who Wants to Be a Millionaire Game Inputs
            const millionaireSessionKey = jid + '_' + senderJid;
            if (quotedMsgId && global.millionaireSessions && global.millionaireSessions[millionaireSessionKey]) {
                const session = global.millionaireSessions[millionaireSessionKey];
                if (session.status === 'playing' && session.lastQuestionMsgId === quotedMsgId) {
                    const ans = trimmedMessage.toLowerCase().trim();
                    if (['a', 'b', 'c', 'd'].includes(ans)) {
                        await commands[`${settings.prefix}millionaire_ans`](sock, msg, ans, { isOwner, isSudo, isDev, senderNumber });
                        return; 
                    }
                }
                else if (session.status === 'calling' && session.lastQuestionMsgId === quotedMsgId) {
                    await commands[`${settings.prefix}millionaire_call`](sock, msg, trimmedMessage, { isOwner, isSudo, isDev, senderNumber });
                    return; 
                }
                else if (session.status === 'waiting_friend_decision' && session.lastQuestionMsgId === quotedMsgId) {
                    const decision = trimmedMessage.toLowerCase().trim();
                    if (['yes', 'no'].includes(decision)) {
                        await commands[`${settings.prefix}millionaire_decision`](sock, msg, decision, { isOwner, isSudo, isDev, senderNumber });
                        return; 
                    }
                }
            }

            // Chat Interceptor V: Anagram Game Answers via Reply
            const singleAnagramKey = jid + '_' + senderJid;
            const multiAnagramKey = jid;
            let activeAnagramKey = '';
            if (global.anagramSessions[singleAnagramKey]) activeAnagramKey = singleAnagramKey;
            else if (global.anagramSessions[multiAnagramKey]) activeAnagramKey = multiAnagramKey;

            if (quotedMsgId && activeAnagramKey && global.anagramSessions && global.anagramSessions[activeAnagramKey]) {
                const session = global.anagramSessions[activeAnagramKey];
                if (session.lastQuestionMsgId === quotedMsgId) {
                    await commands[`${settings.prefix}anagram_ans`](sock, msg, trimmedMessage, { isOwner, isSudo, isDev, senderNumber });
                    return; 
                }
            }

            // Chat Interceptor VI: Word Chain Game via Reply
            if (quotedMsgId && global.wcgSessions && global.wcgSessions[jid]) {
                const session = global.wcgSessions[jid];
                if (session.lastQuestionMsgId === quotedMsgId) {
                    await commands[`${settings.prefix}wcg_ans`](sock, msg, trimmedMessage, { isOwner, isSudo, isDev, senderNumber });
                    return; 
                }
            }

            // Chat Interceptor VII: Interactive Forwarding Sessions
            if (quotedMsgId && global.forwardSessions && global.forwardSessions[quotedMsgId]) {
                const session = global.forwardSessions[quotedMsgId];
                const parsedNumber = trimmedMessage.replace(/[^0-9]/g, '');
                if (parsedNumber.length < 7) {
                    await sock.sendMessage(jid, { text: "❌ Invalid target phone number format." }, { quoted: msg });
                    return;
                }

                const targetDestJid = `${parsedNumber}@s.whatsapp.net`;
                try {
                    await sock.sendMessage(targetDestJid, { forward: { key: { id: session.originalMsgKey, remoteJid: jid, participant: session.originalParticipant }, message: session.msgToForward } });
                    await sock.sendMessage(jid, { text: `✅ Message forwarded successfully!` }, { quoted: msg });
                    delete global.forwardSessions[quotedMsgId];
                } catch (e) {
                    await sock.sendMessage(jid, { text: `❌ Forwarding session failed: ${e.message}` }, { quoted: msg });
                }
                return; 
            }

            // Chat Interceptor VIII: Bank Details Configuration Wizard
            if (quotedMsgId && global.azaSessions && global.azaSessions[quotedMsgId] && isAuthorized) {
                const session = global.azaSessions[quotedMsgId];
                
                if (session.step === 1) {
                    const cleanNum = trimmedMessage.replace(/[^0-9]/g, '');
                    if (cleanNum.length < 5) {
                        await sock.sendMessage(jid, { text: "❌ *Invalid Account Number!*\n\nPlease reply directly to the Step 1 message with a valid number." }, { quoted: msg });
                        return;
                    }

                    const prompt = await sock.sendMessage(jid, { 
                        text: `🏦 *BANK DETAILS CONFIGURATION WIZARD* 🏦\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `• *Step 2:* Excellent. Now, please reply directly to *this message* with your *Bank Name* (e.g., Sterling Bank, Access Bank).` 
                    }, { quoted: msg });

                    global.azaSessions[prompt.key.id] = { step: 2, account: cleanNum };
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

                    global.azaSessions[prompt.key.id] = { step: 3, account: session.account, bank: bankName };
                    delete global.azaSessions[quotedMsgId];
                    return;
                }

                if (session.step === 3) {
                    const fullName = trimmedMessage.trim();
                    if (fullName.length < 3) {
                        await sock.sendMessage(jid, { text: "❌ *Invalid Full Name!*\n\nPlease reply directly to the Step 3 message." }, { quoted: msg });
                        return;
                    }

                    settings.aza = { set: true, account: session.account, bank: session.bank, name: fullName };
                    const { saveSettings } = require('./settingsSaver');
                    saveSettings();
                    saveState();

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

            // Chat Interceptor IX: Interactive Song Selector
            if (quotedMsgId && global.songSessions && global.songSessions[quotedMsgId]) {
                const session = global.songSessions[quotedMsgId];
                const index = parseInt(trimmedMessage.trim());

                if (!isNaN(index) && index >= 1 && index <= session.results.length) {
                    const chosen = session.results[index - 1];
                    delete global.songSessions[quotedMsgId]; 

                    await sock.sendMessage(jid, { text: `📥 *Downloading song:* "${chosen.title}"...` }, { quoted: msg });

                    try {
                        const response = await fetch(`https://apis.davidcyril.name.ng/play?query=${encodeURIComponent(chosen.title)}`);
                        if (response.ok) {
                            const data = await response.json();
                            if (data.status && data.result?.download_url) {
                                await sock.sendMessage(jid, { audio: { url: data.result.download_url }, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                                return;
                            }
                        }
                    } catch (err) {}
                }
                return; 
            }

            // Chat Interceptor X: Interactive APK Selector
            if (quotedMsgId && global.apkSessions && global.apkSessions[quotedMsgId]) {
                const session = global.apkSessions[quotedMsgId];
                const index = parseInt(trimmedMessage.trim());

                if (!isNaN(index) && index >= 1 && index <= session.results.length) {
                    const chosen = session.results[index - 1];
                    delete global.apkSessions[quotedMsgId]; 

                    await sock.sendMessage(jid, { text: `📥 *Downloading APK:* "${chosen.name}"...` }, { quoted: msg });

                    try {
                        const response = await fetch(`https://api.kord.live/api/apkdl?id=${encodeURIComponent(chosen.id)}`);
                        if (response.ok) {
                            const data = await response.json();
                            if (data.downloadUrl) {
                                await sock.sendMessage(jid, {
                                    document: { url: data.downloadUrl },
                                    mimetype: "application/vnd.android.package-archive",
                                    fileName: `${chosen.name}.apk`,
                                    caption: `📦 *APK COMPLETED* 📦\n━━━━━━━━━━━━━━━━━━━\n\n📌 *Name:* ${chosen.name}`
                                }, { quoted: msg });
                                return;
                            }
                        }
                    } catch (err) {}
                }
                return;
            }

            // Chat Interceptor XI: Interactive Shazam Downloads
            if (quotedMsgId && global.shazamSessions && global.shazamSessions[quotedMsgId]) {
                const session = global.shazamSessions[quotedMsgId];
                const text = trimmedMessage.toLowerCase().trim();

                if (text === '1' || text === 'download') {
                    delete global.shazamSessions[quotedMsgId]; 
                    await sock.sendMessage(jid, { text: `📥 *Downloading recognized song:* "${session.title} - ${session.artist}"...` }, { quoted: msg });

                    try {
                        const response = await fetch(`https://apis.davidcyril.name.ng/play?query=${encodeURIComponent(session.title + ' ' + session.artist)}`);
                        if (response.ok) {
                            const data = await response.json();
                            if (data.status && data.result?.download_url) {
                                await sock.sendMessage(jid, { audio: { url: data.result.download_url }, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
                                return;
                            }
                        }
                    } catch (err) {}
                }
                return;
            }

            // Chat Interceptor XII: Reminder Configuration Confirmation
            if (quotedMsgId && global.reminderSessions && global.reminderSessions[quotedMsgId]) {
                const session = global.reminderSessions[quotedMsgId];
                const rTitle = trimmedMessage || "Unnamed Reminder";

                let reminders = [];
                const remindersPath = path.join(__dirname, 'reminders.json');
                try {
                    if (fs.existsSync(remindersPath)) reminders = JSON.parse(fs.readFileSync(remindersPath, 'utf-8'));
                } catch (e) {}

                reminders.push({
                    title: rTitle,
                    text: session.text,
                    jid: session.jid,
                    sender: session.sender,
                    timeSet: session.timeSet,
                    triggerTime: session.timeSet + session.durationMs,
                    durationStr: session.durationStr
                });

                try { fs.writeFileSync(remindersPath, JSON.stringify(reminders, null, 2), 'utf-8'); } catch (e) {}
                delete global.reminderSessions[quotedMsgId];

                await sock.sendMessage(jid, { text: `✅ *Reminder persistently saved!* \n\n• *Title:* *${rTitle}*\n• *Note:* _"${session.text}"_\n• *Duration:* \`${session.durationStr}\`` }, { quoted: msg });
                return;
            }

            // Chat Interceptor XIII: Reminder Cancellations
            if (quotedMsgId && global.cancelSessions && global.cancelSessions[quotedMsgId]) {
                delete global.cancelSessions[quotedMsgId];
                const idx = parseInt(trimmedMessage.trim());

                let reminders = [];
                const remindersPath = path.join(__dirname, 'reminders.json');
                try {
                    if (fs.existsSync(remindersPath)) reminders = JSON.parse(fs.readFileSync(remindersPath, 'utf-8'));
                } catch (e) {}

                if (isNaN(idx) || idx < 1 || idx > reminders.length) return;

                const removed = reminders[idx - 1];
                reminders.splice(idx - 1, 1);
                try { fs.writeFileSync(remindersPath, JSON.stringify(reminders, null, 2), 'utf-8'); } catch (e) {}

                await sock.sendMessage(jid, { text: `✅ *Reminder Successfully Cancelled!*\n\n• *Title:* *${removed.title}*` }, { quoted: msg });
                return;
            }

            // Chat Interceptor XIV: PVP Lore Battle Inputs via Reply
            const pvpSessionKey = jid; 
            if (quotedMsgId && global.pvpSessions && global.pvpSessions[pvpSessionKey]) {
                const session = global.pvpSessions[pvpSessionKey];
                if (session.lastQuestionMsgId === quotedMsgId) {
                    const ans = trimmedMessage.trim();
                    if (session.status === 'p2_choosing' && senderJid === session.p2) {
                        await commands[`${settings.prefix}pvp_choose`](sock, msg, ans, { isOwner, isSudo, isDev, senderNumber });
                        return;
                    } else if (session.status === 'fighting' && senderJid === session.turn) {
                        await commands[`${settings.prefix}pvp_fight`](sock, msg, ans, { isOwner, isSudo, isDev, senderNumber });
                        return;
                    } else if (session.status === 'defending' && senderJid === session.defender) {
                        await commands[`${settings.prefix}pvp_defend`](sock, msg, ans, { isOwner, isSudo, isDev, senderNumber });
                        return;
                    }
                }
            }

            // Chat Interceptor XV: Emoji Charades Answers via Reply
            const charadeSessionKey = jid + '_' + senderJid;
            if (quotedMsgId && global.charadeSessions && global.charadeSessions[charadeSessionKey]) {
                const session = global.charadeSessions[charadeSessionKey];
                if (session.lastQuestionMsgId === quotedMsgId) {
                    await commands[`${settings.prefix}charade_ans`](sock, msg, trimmedMessage, { isOwner, isSudo, isDev, senderNumber });
                    return;
                }
            }

            // Chat Interceptor XVI: Escape Room Choice via Reply
            const escapeSessionKey = jid + '_' + senderJid;
            if (quotedMsgId && global.escapeSessions && global.escapeSessions[escapeSessionKey]) {
                const session = global.escapeSessions[escapeSessionKey];
                if (session.lastQuestionMsgId === quotedMsgId) {
                    if (['1', '2', '3'].includes(trimmedMessage)) {
                        await commands[`${settings.prefix}escape_ans`](sock, msg, trimmedMessage, { isOwner, isSudo, isDev, senderNumber });
                        return;
                    }
                }
            }

            // Chat Interceptor XVII: Vault 8 Choice via Reply
            const vaultSessionKey = jid + '_' + senderJid + '_v8';
            if (quotedMsgId && global.vault8Sessions && global.vault8Sessions[vaultSessionKey]) {
                if (['1', '2', '3'].includes(trimmedMessage)) {
                    await commands[`${settings.prefix}vault8`](sock, msg, trimmedMessage, { isOwner, isSudo, isDev, senderNumber });
                    return;
                }
            }

            if (isGroup && !msg.key.fromMe) {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants;
                const sender = participants.find(p => p.id === senderJid);
                const isAdmin = sender?.admin === 'admin' || sender?.admin === 'superadmin';

                if (settings.presence && settings.presence.autoread) {
                    const autoreadActive = settings.presence.autoread.all || settings.presence.autoread.chats.includes(jid);
                    if (autoreadActive) {
                        try { await sock.readMessages([msg.key]); } catch (e) {}
                    }
                }

                if (!isAdmin && !isOwner && !isDev) {
                    const msgId = msg.key.id;
                    const isOtherBot = !msg.key.fromMe && (
                        (msgId.startsWith('BAE5') && msgId.length === 16) || 
                        (msgId.startsWith('3EB0') && msgId.length === 12) ||
                        (msgId.startsWith('BAE5') && msgId.length === 12) ||
                        msgId.startsWith('KSG') || 
                        msgId.startsWith('Lumina') ||
                        msgId.startsWith('ZEUS') ||
                        msgId.startsWith('SIGMA') ||
                        msgId.startsWith('QUEEN') ||
                        msgId.startsWith('MD') ||
                        msgId.startsWith('BOT') ||
                        msgId.startsWith('HZ') ||
                        (msgId.length === 12 && !msgId.startsWith('3A')) ||
                        (msgId.length === 16 && !msgId.startsWith('3A')) ||
                        (msgId.length === 18) ||
                        (msgId.length === 22)
                    );

                    const antibotSetting = settings.antibot[jid];
                    if (isOtherBot && antibotSetting && antibotSetting !== 'off') {
                        try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) {}

                        if (antibotSetting === 'kick') {
                            try {
                                await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                                await sock.sendMessage(jid, { text: `Sayonara! @${senderNumber}`, mentions: [senderJid] });
                            } catch (err) {}
                        } else if (antibotSetting === 'warn') {
                            const warnKey = `${jid}_${senderNumber}`;
                            settings.warns[warnKey] = (settings.warns[warnKey] || 0) + 1;
                            const count = settings.warns[warnKey];

                            if (count >= 5) {
                                try {
                                    await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                                    await sock.sendMessage(jid, { text: `Sayonara! @${senderNumber}`, mentions: [senderJid] });
                                    settings.warns[warnKey] = 0;
                                } catch (err) {}
                            } else {
                                await sock.sendMessage(jid, { text: `@${senderNumber} Bots are restricted.\n\n*Warn:* ${count}/5`, mentions: [senderJid] });
                            }
                        }
                        return; 
                    }

                    const antilinkSetting = settings.antilink[jid];
                    if (antilinkSetting && antilinkSetting !== 'off') {
                        const containsLink = /chat\.whatsapp\.com\/[0-9A-Za-z]{20,24}|(https?:\/\/[^\s]+)/gi.test(body);
                        if (containsLink) {
                            try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) {}

                            if (antilinkSetting === 'warn') {
                                const warnKey = `${jid}_${senderNumber}`;
                                settings.warns[warnKey] = (settings.warns[warnKey] || 0) + 1;
                                const count = settings.warns[warnKey];

                                if (count >= 5) {
                                    try {
                                        await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                                        await sock.sendMessage(jid, { text: `Sayonara! @${senderNumber}`, mentions: [senderJid] });
                                        settings.warns[warnKey] = 0;
                                    } catch (err) {}
                                } else {
                                    await sock.sendMessage(jid, { text: `@${senderNumber}\nLinks are restricted here!\n\n*Warn:* ${count}/5`, mentions: [senderJid] });
                                }
                            } else if (antilinkSetting === 'kick') {
                                try {
                                    await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                                    await sock.sendMessage(jid, { text: `Sayonara! @${senderNumber}`, mentions: [senderJid] });
                                } catch (err) {}
                            }
                            return; 
                        }
                    }
                }

                const antitagSetting = settings.antitag[jid];
                if (antitagSetting === 'on') {
                    const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant;
                    const isTaggingBot = mentionedJids.includes(botJid) || (botLid && mentionedJids.includes(botLid)) || quotedParticipant === botJid || (botLid && quotedParticipant === botLid);

                    if (isTaggingBot) {
                        if (!isAdmin && !isOwner && !isDev) {
                            try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) {}
                            await sock.sendMessage(jid, { text: `@${senderNumber} Quit tagging me weakling`, mentions: [senderJid] });
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
                    command = trimmedMessage.slice(settings.prefix.length).toLowerCase();
                    args = '';
                } else {
                    command = trimmedMessage.slice(settings.prefix.length, spaceIndex).toLowerCase();
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
            } 
            else if (commands[trimmedMessage.toLowerCase()]) {
                command = trimmedMessage.toLowerCase();
                args = '';
            }
            else {
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

            if (command) {
                const isPublicMode = settings.isPublic ?? false;
                const isInteractiveResponse = ['prop_ans', 'ask_ans', 'wed_ans'].includes(command);

                if (!isPublicMode && !isAuthorized && !isDev && !isInteractiveResponse) {
                    return; 
                }
            }

            console.log(`⚙️ [PARSER] Triggering command: "${command}"`);

            const cmdKey = command.startsWith(settings.prefix) ? command : `${settings.prefix}${command}`;
            if (commands[cmdKey]) {
                if (settings.autoReact === 'cmd' && !msg.key.fromMe) {
                    try { await sock.sendMessage(msg.key.remoteJid, { react: { text: "❄", key: msg.key } }); } catch (err) {}
                }
                await commands[cmdKey](sock, msg, args, { isOwner, isSudo, isDev, senderNumber });
            } else if (commands[command]) {
                if (settings.autoReact === 'cmd' && !msg.key.fromMe) {
                    try { await sock.sendMessage(msg.key.remoteJid, { react: { text: "❄", key: msg.key } }); } catch (err) {}
                }
                await commands[command](sock, msg, args, { isOwner, isSudo, isDev, senderNumber });
            }
        } catch (err) {
            console.error('Error handling message stream:', err);
        }
    });
}

module.exports = { startBot };