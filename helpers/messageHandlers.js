// helpers/messageHandlers.js
const commands = require('../commands');
const settings = require('../settings');
const { getRawMessage } = require('./antiDelete');
const fs = require('fs');
const path = require('path');

const ownerCommands = [
    'diagnose', 'update', 'mode', 'setsudo', 'delsudo', 
    'addowner', 'delowner', 'restart', 'shutdown', 'ban', 
    'unban', 'adddev', 'deldev', 'afk', 'setvar', 'settings', 
    'upgrade', 'antipm', 'reminder', 'remind', 'games_closeall', 'owner'
];
const devOnlyCommands = ['upgrade', 'adddev', 'deldev'];

global.lidCache = global.lidCache || {};

// Enhanced JID Resolver supporting fast in-memory group metadata scans
async function getPhoneJid(sock, jid, groupJid = null) {
    if (!jid) return '';
    let clean = jid.split(':')[0].split('@')[0];
    
    if (jid.endsWith('@lid')) {
        if (global.lidCache[jid]) return global.lidCache[jid];
        
        // Quick Scan: Try to resolve instantly using the group participants cache
        if (groupJid) {
            try {
                const metadata = await sock.groupMetadata(groupJid);
                const participant = metadata?.participants?.find(
                    p => p.lid === jid || p.id.split(':')[0] === jid.split(':')[0]
                );
                if (participant && participant.id.endsWith('@s.whatsapp.net')) {
                    const resolvedJid = participant.id.split(':')[0] + '@s.whatsapp.net';
                    global.lidCache[jid] = resolvedJid;
                    return resolvedJid;
                }
            } catch (e) {}
        }

        // Fallback: Query the network
        try {
            const resolved = await sock.findUserId(jid);
            if (resolved && resolved.phoneNumber) {
                const phoneJid = `${resolved.phoneNumber}@s.whatsapp.net`;
                global.lidCache[jid] = phoneJid;
                return phoneJid;
            }
        } catch (e) {}
    }
    return `${clean}@s.whatsapp.net`;
}

// Unified Security Policy Enforcer
async function applySecurityPolicy(sock, msg, policy, senderJid, senderNumber, jid, violationReason) {
    if (!policy || policy === 'off') return;

    if (policy === 'delete') {
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            await sock.sendMessage(jid, { text: `❌ *Message Deleted:* @${senderNumber} violated ${violationReason} rules.`, mentions: [senderJid] });
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
                await sock.sendMessage(jid, { text: `👋 @${senderNumber} kicked. Warnings exceeded for violating ${violationReason} rules.`, mentions: [senderJid] });
                settings.warns[warnKey] = 0;
            } else {
                await sock.sendMessage(jid, { text: `⚠️ @${senderNumber} ${violationReason} is not allowed here! (${count}/5)`, mentions: [senderJid] });
            }
            const { saveSettings } = require('./settingsSaver');
            const { saveState } = require('../stateManager');
            saveSettings();
            saveState();
        } catch (e) {}
    } 
    else if (policy === 'kick') {
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
            await sock.sendMessage(jid, { text: `👋 Exorcised @${senderNumber} for violating ${violationReason} rules.`, mentions: [senderJid] });
        } catch (e) {}
    }
}

async function handleIncomingMessage(sock, chatUpdate, botSentMessageIds) {
    try {
        if (!chatUpdate.messages || chatUpdate.messages.length === 0) return;
        const msg = chatUpdate.messages[0];
        if (!msg || !msg.message) return; 

        const jid = msg.key.remoteJid;
        
        // Resolve raw sender string to native JID
        const rawSender = msg.key.participant || msg.key.remoteJid || '';
        const senderJid = rawSender.split(':')[0] + (rawSender.includes('@lid') ? '@lid' : '@s.whatsapp.net');
        const senderNumber = senderJid.split('@')[0]; 
        const isGroup = jid.endsWith('@g.us');
        
        // Resolve phone JID if the sender is using an LID
        let senderPhoneJid = '';
        if (senderJid.endsWith('@lid')) {
            senderPhoneJid = await getPhoneJid(sock, senderJid, jid);
        }

        // Establish the bot's identity using fully-qualified JIDs
        const botJid = settings.botJid || (sock.user?.id ? `${sock.user.id.split(':')[0]}@s.whatsapp.net` : '');
        const botLid = settings.botLid || '';

        global.activeSock = sock;

        // Emoji Reaction Handler
        const reactionMessage = msg.message.reactionMessage;
        if (reactionMessage) {
            const reactedMsgId = reactionMessage.key?.id;
            const reactionText = reactionMessage.text;
            const targetEmoji = settings.vvEmoji || "🥷";

            const isReactOwner = senderJid === settings.ownerJid || 
                                 (senderPhoneJid && senderPhoneJid === settings.ownerJid) ||
                                 settings.owners.includes(senderJid) || 
                                 (senderPhoneJid && settings.owners.includes(senderPhoneJid)) ||
                                 settings.devs.includes(senderJid) ||
                                 (senderPhoneJid && settings.devs.includes(senderPhoneJid));

            const isReactSudo = (Array.isArray(settings.sudo) && settings.sudo.includes(senderJid)) || 
                                (senderPhoneJid && Array.isArray(settings.sudo) && settings.sudo.includes(senderPhoneJid));

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

                            const destJid = senderJid;
                            
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

        // Banned status checks using both standard and phone formats
        const isBanned = (Array.isArray(settings.banned) && settings.banned.includes(senderJid)) || 
                         (senderPhoneJid && Array.isArray(settings.banned) && settings.banned.includes(senderPhoneJid));
        if (isBanned) return;
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

        // Resilient identification checks matching against standard or phone JIDs
        const isDev = settings.devs.includes(senderJid) || (senderPhoneJid && settings.devs.includes(senderPhoneJid));
        const isOwner = isDev || 
                        senderJid === settings.ownerJid || 
                        (senderPhoneJid && senderPhoneJid === settings.ownerJid) || 
                        settings.owners.includes(senderJid) || 
                        (senderPhoneJid && settings.owners.includes(senderPhoneJid)) || 
                        msg.key.fromMe; 
        
        const isSudo = (Array.isArray(settings.sudo) && settings.sudo.includes(senderJid)) || 
                       (senderPhoneJid && Array.isArray(settings.sudo) && settings.sudo.includes(senderPhoneJid));
        
        const isAuthorized = isOwner || isSudo;

        const rawMsg = getRawMessage(msg.message);
        const contextInfo = rawMsg?.contextInfo || msg.message?.extendedTextMessage?.contextInfo;
        const quotedMsgId = contextInfo?.stanzaId;
        const mentionedJids = contextInfo?.mentionedJid || [];

        // ============================================================================
        // GROUP SECURITY INTERCEPTORS (Antilink, Antibot, Antitag, Antigm)
        // ============================================================================
        if (isGroup && !isAuthorized && !isDev && !msg.key.fromMe) {
            
            // 1. Antilink Protection
            const antilinkPolicy = settings.antilink?.[jid] || 'off';
            const hasLink = /(https?:\/\/)?(www\.)?(chat\.whatsapp\.com\/[a-zA-Z0-9]+|wa\.me\/[0-9]+)/i.test(body) || /https?:\/\/[^\s]+/i.test(body);
            if (hasLink && antilinkPolicy !== 'off') {
                await applySecurityPolicy(sock, msg, antilinkPolicy, senderJid, senderNumber, jid, "Antilink");
                return; 
            }

            // 2. Antibot Protection
            const antibotPolicy = settings.antibot?.[jid] || 'off';
            const isBotSender = msg.key.id.startsWith('BAE5') || msg.key.id.startsWith('3EB0') || msg.key.id.length === 12;
            if (isBotSender && antibotPolicy !== 'off') {
                await applySecurityPolicy(sock, msg, antibotPolicy, senderJid, senderNumber, jid, "Antibot");
                return;
            }

            // 3. Antitag Protection
            const antitagPolicy = settings.antitag?.[jid] || 'off';
            const isTaggingLarge = mentionedJids.length >= 5;
            const isTaggingEveryone = body.includes('@everyone') || body.includes('@here') || isTaggingLarge;
            if (isTaggingEveryone && antitagPolicy === 'on') {
                await applySecurityPolicy(sock, msg, 'delete', senderJid, senderNumber, jid, "Antitag");
                return;
            }

            // 4. Anti-Group-Mention Protection (antigm)
            const antigmPolicy = settings.antigm?.[jid] || 'off';
            const isGroupMention = mentionedJids.includes(jid);
            if (isGroupMention && antigmPolicy !== 'off') {
                await applySecurityPolicy(sock, msg, antigmPolicy, senderJid, senderNumber, jid, "Anti-Group-Mention");
                return;
            }
        }

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
                        const { saveSettings } = require('./settingsSaver');
                        const { saveState } = require('../stateManager');
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
                const { handleMessageDeletion } = require('./antiDelete');
                await handleMessageDeletion(sock, originalMsg, jid, msg.key.participant || msg.key.remoteJid || '');
            }
            return;
        }

        if (settings.antibug === 'on' && !isAuthorized && !msg.key.fromMe && !isDev) {
            const now = Date.now();
            if (!global.spamTracker[senderJid]) global.spamTracker[senderJid] = [];
            global.spamTracker[senderJid].push(now);
            global.spamTracker[senderJid] = global.spamTracker[senderJid].filter(t => now - t <= 3000);

            if (global.spamTracker[senderJid].length >= 5) {
                try {
                    await sock.sendMessage(jid, { text: `can't bypass my infinity? @${senderNumber}`, mentions: [senderJid] }, { quoted: msg });
                    await sock.updateBlockStatus(senderJid, 'block');
                    await sock.chatModify({ delete: true, lastMessages: [msg] }, jid);
                    delete global.spamTracker[senderJid];
                } catch (blockErr) {}
                return; 
            }
        }

        const antispamConfig = settings.antispam?.[jid];
        if (isGroup && antispamConfig && antispamConfig.status === 'on' && !isAuthorized && !msg.key.fromMe && !isDev) {
            const rate = antispamConfig.rate || { count: 1, seconds: 2 };
            const now = Date.now();
            global.spamTracker[senderJid] = global.spamTracker[senderJid] || [];
            global.spamTracker[senderJid].push(now);
            global.spamTracker[senderJid] = global.spamTracker[senderJid].filter(t => now - t <= (rate.seconds * 1000));

            if (global.spamTracker[senderJid].length > rate.count) {
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

        // Dev Mention Auto-Reaction Interceptor
        const devJids = new Set([...(settings.devs || [])]);
        const isDevMentioned = mentionedJids.some(mention => devJids.has(mention) && mention !== senderJid);
        
        if (isDevMentioned && !msg.key.fromMe) {
            (async () => {
                const reactionSequence = ["❄", "🥷", "🪽", "⚽", "💀"];
                for (const emoji of reactionSequence) {
                    try {
                        await sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
                    } catch (reactErr) {
                        break; 
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            })().catch(err => console.error("❌ [REACTION] Dev mention animation failed:", err.message));
        }

        const quotedParticipant = contextInfo?.participant;
        const isReplyingToBot = quotedParticipant === botJid || (botLid && quotedParticipant === botLid) || (!isGroup && !msg.key.fromMe && quotedMsgId);
        const isMentioningBot = mentionedJids.includes(botJid) || (botLid && mentionedJids.includes(botLid));

        const singleKey = jid + '_' + senderJid;
        const quizKey = jid + '_' + senderJid + '_quiz';
        const multiKey = jid; 

        let activeKey = '';
        if (global.triviaSessions[quizKey]) activeKey = quizKey;
        else if (global.triviaSessions[singleKey]) activeKey = singleKey;
        else if (global.triviaSessions[multiKey]) activeKey = multiKey;

        // Decryption of View Once media by reaction
        const targetEmoji = settings.vvEmoji || "🥷";
        if (quotedMsgId && trimmedMessage === targetEmoji && isAuthorized) {
            if (global.messageStore?.[quotedMsgId]) {
                const originalMsg = global.messageStore[quotedMsgId];
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

                            const destJid = senderJid;

                            if (mediaType === 'image') {
                                await sock.sendMessage(destJid, { image: buffer, caption: "🌀 *Kamui:* Decoded View Once Image via reply" });
                            } else if (mediaType === 'video') {
                                const mimeType = mediaMessage.mimetype || "video/mp4";
                                await sock.sendMessage(destJid, { video: buffer, mimetype: mimeType, caption: "🌀 *Kamui:* Decoded View Once Video via reply" });
                            } else if (mediaType === 'audio') {
                                await sock.sendMessage(destJid, { audio: buffer, mimetype: mediaMessage.mimetype || "audio/ogg; codecs=opus", ptt: true });
                            }
                            return; 
                        }
                    } catch (e) {}
                }
            }
        }

        // Chat Interceptors Execution Flow...
        if (quotedMsgId && activeKey && global.triviaSessions && global.triviaSessions[activeKey]) {
            const session = global.triviaSessions[activeKey];
            
            // 1. Route replies to category selection prompts
            if (session.status === 'awaiting_category' && session.lastQuestionMsgId === quotedMsgId) {
                await commands[`${settings.prefix}quiz_cat`](sock, msg, trimmedMessage, { isOwner, isSudo, isDev, senderNumber });
                return;
            }
            
            // 2. Route answers to active trivia questions
            if (session.status === 'playing' && session.lastQuestionMsgId === quotedMsgId) {
                const ans = trimmedMessage.toLowerCase().trim();
                if (['a', 'b', 'c', 'd'].includes(ans)) {
                    await commands[`${settings.prefix}quiz_ans`](sock, msg, ans, { isOwner, isSudo, isDev, senderNumber });
                    return; 
                }
            }
        }

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

        if (quotedMsgId && global.wcgSessions && global.wcgSessions[jid]) {
            const session = global.wcgSessions[jid];
            if (session.lastQuestionMsgId === quotedMsgId) {
                await commands[`${settings.prefix}wcg_ans`](sock, msg, trimmedMessage, { isOwner, isSudo, isDev, senderNumber });
                return; 
            }
        }

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
                const { saveState } = require('../stateManager');
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

        if (quotedMsgId && global.apkSessions && global.apkSessions[quotedMsgId]) {
            const session = global.apkSessions[quotedMsgId];
            const index = parseInt(trimmedMessage.trim());

            if (!isNaN(index) && index >= 1 && index <= session.results.length) {
                const chosen = session.results[index - 1];
                delete global.apkSessions[quotedMsgId]; 

                await sock.sendMessage(jid, { text: `📥 *Downloading APK:* "${chosen.name}"...` }, { quoted: msg });

                try {
                    const response = await fetch("https://api.kord.live/api/apkdl?id=" + encodeURIComponent(chosen.id));
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

        if (quotedMsgId && global.reminderSessions && global.reminderSessions[quotedMsgId]) {
            const session = global.reminderSessions[quotedMsgId];
            const rTitle = trimmedMessage || "Unnamed Reminder";

            let reminders = [];
            const remindersPath = path.join(__dirname, '../reminders.json');
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

        if (quotedMsgId && global.cancelSessions && global.cancelSessions[quotedMsgId]) {
            delete global.cancelSessions[quotedMsgId];
            const idx = parseInt(trimmedMessage.trim());

            let reminders = [];
            const remindersPath = path.join(__dirname, '../reminders.json');
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

        const charadeSessionKey = jid + '_' + senderJid;
        if (quotedMsgId && global.charadeSessions && global.charadeSessions[charadeSessionKey]) {
            const session = global.charadeSessions[charadeSessionKey];
            if (session.lastQuestionMsgId === quotedMsgId) {
                await commands[`${settings.prefix}charade_ans`](sock, msg, trimmedMessage, { isOwner, isSudo, isDev, senderNumber });
                return;
            }
        }

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

        const vaultSessionKey = jid + '_' + senderJid + '_v8';
        if (quotedMsgId && global.vault8Sessions && global.vault8Sessions[vaultSessionKey]) {
            const session = global.vault8Sessions[vaultSessionKey];
            if (session.lastQuestionMsgId === quotedMsgId) {
                if (['1', '2', '3'].includes(trimmedMessage)) {
                    await commands[`${settings.prefix}vault8`](sock, msg, trimmedMessage, { isOwner, isSudo, isDev, senderNumber });
                    return;
                }
            }
        }

        let command;
        let args;
        let identifiedAgent = null;

        const isGojoCalled = /\bgojo\b/i.test(lowerMessage);
        const isLizzyCalled = /\blizzy\b/i.test(lowerMessage);
        const isJarvisCalled = /\bjarvis\b|\bchatbot\b/i.test(lowerMessage);
        const isFridayCalled = /\bfriday\b/i.test(lowerMessage);

        if (isReplyingToBot && quotedMsgId && global.botMessageAgents[quotedMsgId]) {
            identifiedAgent = global.botMessageAgents[quotedMsgId];
        } 
        else if (isMentioningBot || isReplyingToBot) {
            if (isFridayCalled) identifiedAgent = 'friday';
            else if (isGojoCalled) identifiedAgent = 'gojo';
            else if (isLizzyCalled) identifiedAgent = 'lizzy';
            else if (isJarvisCalled) identifiedAgent = 'jarvis';
            else {
                if (Array.isArray(settings.lizzyChats) && settings.lizzyChats.includes(jid)) identifiedAgent = 'lizzy';
                else if (Array.isArray(settings.chatbotChats) && settings.chatbotChats.includes(jid)) identifiedAgent = 'jarvis';
                else identifiedAgent = 'gojo';
            }
        } 
        else {
            if (isFridayCalled) identifiedAgent = 'friday';
            else if (isGojoCalled) identifiedAgent = 'gojo';
            else if (isLizzyCalled) identifiedAgent = 'lizzy';
            else if (isJarvisCalled) identifiedAgent = 'jarvis';
        }

        if (identifiedAgent === 'gojo') {
            const isAsleep = settings.gojoGlobalSleep;
            if (isAsleep && !trimmedMessage.startsWith(settings.prefix)) identifiedAgent = null;
        }

        if (identifiedAgent && !trimmedMessage.startsWith(settings.prefix)) {
            if (identifiedAgent === 'gojo') {
                command = 'gojo';
                args = trimmedMessage;
            } else if (identifiedAgent === 'lizzy') {
                command = 'lizzy_chat';
                args = trimmedMessage;
            } else if (identifiedAgent === 'jarvis') {
                command = 'chatbot_chat';
                args = trimmedMessage;
            } else if (identifiedAgent === 'friday') {
                command = 'friday_chat';
                args = trimmedMessage;
            }
        }

        if (!command) {
            if (trimmedMessage.startsWith(settings.prefix)) {
                const spaceIndex = trimmedMessage.indexOf(' ');
                if (spaceIndex === -1) {
                    command = trimmedMessage.slice(settings.prefix.length).toLowerCase();
                    args = '';
                } else {
                    command = trimmedMessage.slice(settings.prefix.length, spaceIndex).toLowerCase();
                    args = trimmedMessage.slice(spaceIndex + 1);
                }
            } else if (commands[trimmedMessage.toLowerCase()]) {
                command = trimmedMessage.toLowerCase();
                args = '';
            }
        }

        if (!command) return;

        if (command) {
            if (command === 'gojo') global.activeAgentContext = 'gojo';
            else if (command === 'lizzy_chat') global.activeAgentContext = 'lizzy';
            else if (command === 'chatbot_chat') global.activeAgentContext = 'jarvis';
            else if (command === 'friday_chat') global.activeAgentContext = 'friday';
            else global.activeAgentContext = null;

            const isPublicMode = settings.isPublic ?? false;
            const isInteractiveResponse = ['prop_ans', 'ask_ans', 'wed_ans', 'v8_btn'].includes(command);

            if (!isPublicMode && !isAuthorized && !isDev && !isInteractiveResponse) {
                return; 
            }
        }

        const cleanCmd = command.startsWith(settings.prefix) ? command.slice(settings.prefix.length) : command;
        const isOwnerCmd = ownerCommands.includes(cleanCmd);
        const isDevOnlyCmd = devOnlyCommands.includes(cleanCmd);

        if (isOwnerCmd && isSudo && !isOwner && !isDev) {
            return;
        }

        const isPrimaryOwner = senderJid === settings.ownerJid || (senderPhoneJid && senderPhoneJid === settings.ownerJid);
        if (isDevOnlyCmd && !isDev && !isPrimaryOwner) {
            return;
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
}

module.exports = { handleIncomingMessage, getPhoneJid };