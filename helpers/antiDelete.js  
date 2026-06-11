// helpers/antiDelete.js
const settings = require('../settings');

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

module.exports = { handleMessageDeletion, getRawMessage };