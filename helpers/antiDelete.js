// helpers/antiDelete.js
const settings = require('../settings');

// Safely normalizes JIDs by stripping colons and device identifiers
function normalizeToJid(input) {
    if (!input) return '';
    const clean = input.replace(/:[\d]+@/, '@');
    if (clean.endsWith('@s.whatsapp.net')) return clean;
    if (clean.endsWith('@lid')) return clean;
    const raw = clean.split('@')[0].replace(/[^0-9]/g, '');
    return raw ? `${raw}@s.whatsapp.net` : '';
}

// Comprehensive owner/developer identity verification supporting LIDs and JIDs
function isOwnerOrDev(jid) {
    if (!jid) return false;
    const normalized = normalizeToJid(jid);
    
    // Check direct owner JID/LID configurations
    if (normalized === normalizeToJid(settings.ownerJid)) return true;
    if (settings.ownerLid && normalized === normalizeToJid(settings.ownerLid)) return true;
    
    // Helper to search within arrays of identifiers
    const checkArray = (arr) => Array.isArray(arr) && arr.map(x => normalizeToJid(x)).includes(normalized);
    if (checkArray(settings.ownerLids)) return true;
    if (checkArray(settings.owners)) return true;
    if (checkArray(settings.devs)) return true;
    if (checkArray(settings.devLids)) return true;
    if (checkArray(settings.sudo)) return true;

    // Direct raw phone number comparison fallback
    const rawNumber = jid.split('@')[0];
    if (rawNumber === settings.ownerNumber) return true;
    
    return false;
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
        // Retrieve and handle antidelete setting type (handles string, boolean, or object configurations safely)
        let status = 'off';
        let logDestination = 'bot';
        let logUserJid = '';

        if (settings.antidelete) {
            if (typeof settings.antidelete === 'object') {
                status = settings.antidelete.status || 'off';
                logDestination = settings.antidelete.logDestination || 'bot';
                logUserJid = settings.antidelete.logUserJid || '';
            } else if (typeof settings.antidelete === 'string') {
                status = settings.antidelete.toLowerCase().trim();
            } else if (typeof settings.antidelete === 'boolean') {
                status = settings.antidelete ? 'on' : 'off';
            }
        }

        let shouldLog = false;
        if (status === 'on') {
            shouldLog = true;
        } else if (status === 'here') {
            const targetHere = (typeof settings.antidelete === 'object' && settings.antidelete.hereJid) || jid;
            shouldLog = (targetHere === jid);
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
                const isGroup = jid.endsWith('@g.us');
                const botJid = sock.user.id ? normalizeToJid(sock.user.id) : '';
                const isBotSelfDm = (normalizeToJid(jid) === botJid);
                const isUserDm = !isGroup && !isBotSelfDm;

                // If deleted in a regular user's private DM, send log directly to the command user's (owner's) LID DM
                if (isUserDm) {
                    destJid = settings.ownerLid || (settings.ownerLids && settings.ownerLids[0]) || settings.ownerJid || '';
                } else {
                    const isTargetOwner = logUserJid && isOwnerOrDev(logUserJid);

                    if (logDestination === 'user' && isTargetOwner) {
                        destJid = normalizeToJid(logUserJid);
                    } else {
                        // Default to the bot's own self LID/JID DM
                        destJid = botJid;
                    }
                }
            }

            // Secure safe fallback for destJid to prevent runtime exceptions
            if (!destJid) {
                destJid = settings.ownerLid || settings.ownerJid || (settings.ownerNumber + '@s.whatsapp.net');
            }

            const logHeader = `🚨 *ANTIDELETE LOG INTEL:* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `👥 *Group/Chat:* @${jid.split('@')[0]}\n` +
                              `👤 *Sender:* @${sender.split('@')[0]}\n` +
                              `🗑️ *Deleted by:* @${revokerJid.split('@')[0]}\n`;

            const { downloadContentFromMessage } = await import('@itsliaaa/baileys');

            if (rawContent.imageMessage) {
                if (!rawContent.imageMessage.url && !rawContent.imageMessage.directPath) {
                    console.error("Image message download parameters are missing");
                    return;
                }
                const stream = await downloadContentFromMessage(rawContent.imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                await sock.sendMessage(destJid, { image: buffer, caption: `${logHeader}📷 *Type:* Image\n📝 *Caption:* "${textContent}"`, mentions: [sender, revokerJid] });
            } 
            else if (rawContent.videoMessage) {
                if (!rawContent.videoMessage.url && !rawContent.videoMessage.directPath) {
                    console.error("Video message download parameters are missing");
                    return;
                }
                const stream = await downloadContentFromMessage(rawContent.videoMessage, 'video');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                const mime = rawContent.videoMessage.mimetype || "video/mp4";
                await sock.sendMessage(destJid, { video: buffer, mimetype: mime, caption: `${logHeader}🎥 *Type:* Video\n📝 *Caption:* "${textContent}"`, mentions: [sender, revokerJid] });
            } 
            else if (rawContent.audioMessage) {
                if (!rawContent.audioMessage.url && !rawContent.audioMessage.directPath) {
                    console.error("Audio message download parameters are missing");
                    return;
                }
                const stream = await downloadContentFromMessage(rawContent.audioMessage, 'audio');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                const mime = rawContent.audioMessage.mimetype || "audio/ogg; codecs=opus";
                await sock.sendMessage(destJid, { text: `${logHeader}🎵 *Type:* Voice Note`, mentions: [sender, revokerJid] });
                await sock.sendMessage(destJid, { audio: buffer, mimetype: mime, ptt: rawContent.audioMessage.ptt || false });
            }
            else if (rawContent.stickerMessage) {
                if (!rawContent.stickerMessage.url && !rawContent.stickerMessage.directPath) {
                    console.error("Sticker message download parameters are missing");
                    return;
                }
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
        console.error(err.stack);
    }
}

module.exports = { handleMessageDeletion, getRawMessage };