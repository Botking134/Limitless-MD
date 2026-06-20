// helpers/log.js
const config = require('../config');
const { normalizeToJid } = require('../stateManager');

// ─── MESSAGE UNWRAPPER ──────────────────────────────────────────
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

// ─── HANDLE DELETED MESSAGES ──────────────────────────────────

async function handleDeletion(sock, originalMsg, jid, revokerJid) {
    try {
        const mode = config.antidelete?.mode || 'off';
        if (mode === 'off') return;

        const isGroup = jid.endsWith('@g.us');

        if (mode === 'group' && !isGroup) return;
        if (mode === 'pm' && (isGroup || jid === 'status@broadcast')) return;

        if (originalMsg.key.fromMe) return;

        const rawContent = getRawMessage(originalMsg.message);
        if (!rawContent) return;

        const sender = originalMsg.key.participant || originalMsg.key.remoteJid || '';
        const senderJid = normalizeToJid(sender);
        const revokerJidNorm = normalizeToJid(revokerJid);

        const logHeader =
            `🚨 *ANTIDELETE LOG* 🚨\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📂 *Chat:* @${jid.split('@')[0]}\n` +
            `✍️ *Author:* @${senderJid.split('@')[0]}\n` +
            `🗑️ *Deleted by:* @${revokerJidNorm.split('@')[0]}\n`;

        const destJid = config.botJid || config.botLid || sock.user.id;
        if (!destJid) return;

        const { downloadContentFromMessage } = await import('@itsliaaa/baileys');

        const textContent =
            rawContent.conversation ||
            rawContent.extendedTextMessage?.text ||
            rawContent.imageMessage?.caption ||
            rawContent.videoMessage?.caption ||
            '';

        if (rawContent.imageMessage) {
            const stream = await downloadContentFromMessage(rawContent.imageMessage, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await sock.sendMessage(destJid, {
                image: buffer,
                caption: `${logHeader}📷 *Type:* Image\n📝 *Caption:* "${textContent}"`,
                mentions: [senderJid, revokerJidNorm]
            });
        } else if (rawContent.videoMessage) {
            const stream = await downloadContentFromMessage(rawContent.videoMessage, 'video');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            const mime = rawContent.videoMessage.mimetype || "video/mp4";
            await sock.sendMessage(destJid, {
                video: buffer,
                mimetype: mime,
                caption: `${logHeader}🎥 *Type:* Video\n📝 *Caption:* "${textContent}"`,
                mentions: [senderJid, revokerJidNorm]
            });
        } else if (rawContent.audioMessage) {
            const stream = await downloadContentFromMessage(rawContent.audioMessage, 'audio');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            const mime = rawContent.audioMessage.mimetype || "audio/ogg; codecs=opus";
            await sock.sendMessage(destJid, {
                text: `${logHeader}🎵 *Type:* Voice Note`,
                mentions: [senderJid, revokerJidNorm]
            });
            await sock.sendMessage(destJid, {
                audio: buffer,
                mimetype: mime,
                ptt: rawContent.audioMessage.ptt || false
            });
        } else if (rawContent.stickerMessage) {
            const stream = await downloadContentFromMessage(rawContent.stickerMessage, 'sticker');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await sock.sendMessage(destJid, {
                text: `${logHeader}🎨 *Type:* Sticker`,
                mentions: [senderJid, revokerJidNorm]
            });
            await sock.sendMessage(destJid, { sticker: buffer });
        } else {
            if (textContent) {
                await sock.sendMessage(destJid, {
                    text: `${logHeader}💬 *Type:* Text\n📝 *Content:*\n\n"${textContent}"`,
                    mentions: [senderJid, revokerJidNorm]
                });
            }
        }
    } catch (err) {
        console.error('❌ [ANTIDELETE] handleDeletion failed:', err.message);
        console.error(err.stack);
    }
}

// ─── HANDLE VIEWONCE AND VVS REPLIES ──────────────────────────

async function handleViewOnce(sock, msg) {
    try {
        const rawMsg = getRawMessage(msg.message);
        if (!rawMsg) return;

        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');

        // ─── 1. Check if the incoming message itself is a ViewOnce ───
        const isViewOnce = msg.message?.viewOnceMessage ||
                           msg.message?.viewOnceMessageV2 ||
                           msg.message?.viewOnceMessageV2Extension;

        if (isViewOnce) {
            const mode = config.antiviewonce?.mode || 'off';
            if (mode === 'off') return;
            if (mode === 'group' && !isGroup) return;
            if (mode === 'pm' && (isGroup || jid === 'status@broadcast')) return;
            if (msg.key.fromMe) return;

            const viewOnceMedia = rawMsg?.imageMessage ||
                                  rawMsg?.videoMessage ||
                                  rawMsg?.audioMessage;
            if (!viewOnceMedia) return;

            // Deduplication
            if (!global.processedViewOnces) global.processedViewOnces = new Set();
            const voKey = `${jid}_${msg.key.id}`;
            if (global.processedViewOnces.has(voKey)) return;
            global.processedViewOnces.add(voKey);
            setTimeout(() => global.processedViewOnces.delete(voKey), 10 * 60 * 1000);

            const sender = msg.key.participant || msg.key.remoteJid || '';
            const senderJid = normalizeToJid(sender);

            const logHeader =
                `🚨 *ANTIVIEWONCE LOG* 🚨\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `📂 *Chat:* @${jid.split('@')[0]}\n` +
                `✍️ *Sender:* @${senderJid.split('@')[0]}\n`;

            const destJid = config.botJid || config.botLid || sock.user.id;
            if (!destJid) return;

            const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
            const mediaType = rawMsg.imageMessage ? 'image' :
                              (rawMsg.videoMessage ? 'video' : 'audio');

            const stream = await downloadContentFromMessage(viewOnceMedia, mediaType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            const caption = viewOnceMedia.caption || '';

            if (mediaType === 'image') {
                await sock.sendMessage(destJid, {
                    image: buffer,
                    caption: `${logHeader}📷 *Type:* Image\n📝 *Caption:* "${caption}"`,
                    mentions: [senderJid]
                });
            } else if (mediaType === 'video') {
                const mime = viewOnceMedia.mimetype || "video/mp4";
                await sock.sendMessage(destJid, {
                    video: buffer,
                    mimetype: mime,
                    caption: `${logHeader}🎥 *Type:* Video\n📝 *Caption:* "${caption}"`,
                    mentions: [senderJid]
                });
            } else if (mediaType === 'audio') {
                const mime = viewOnceMedia.mimetype || "audio/ogg; codecs=opus";
                await sock.sendMessage(destJid, {
                    text: `${logHeader}🎵 *Type:* Voice Note`,
                    mentions: [senderJid]
                });
                await sock.sendMessage(destJid, {
                    audio: buffer,
                    mimetype: mime,
                    ptt: viewOnceMedia.ptt || false
                });
            }

            // React to confirm capture
            try {
                await sock.sendMessage(jid, { react: { text: '👁️', key: msg.key } });
            } catch (e) { /* ignore */ }
            return;
        }

        // ─── 2. Check if this is a reply to a ViewOnce (VVS feature) ───
        const contextInfo = rawMsg?.contextInfo ||
                            rawMsg?.extendedTextMessage?.contextInfo ||
                            rawMsg?.imageMessage?.contextInfo ||
                            rawMsg?.videoMessage?.contextInfo;
        if (!contextInfo) return;

        const quotedMsg = contextInfo.quotedMessage;
        if (!quotedMsg) return;

        // Unwrap quoted message to see if it's view-once
        const rawQuoted = getRawMessage(quotedMsg);
        const quotedViewOnce = rawQuoted?.viewOnceMessageV2?.message ||
                               rawQuoted?.viewOnceMessage?.message ||
                               rawQuoted?.viewOnceMessageV2Extension?.message;
        if (!quotedViewOnce) return;

        const viewOnceMediaQuoted = quotedViewOnce.imageMessage ||
                                    quotedViewOnce.videoMessage ||
                                    quotedViewOnce.audioMessage;
        if (!viewOnceMediaQuoted) return;

        // Get the reply text (the VVS trigger)
        const replyText = rawMsg.conversation || rawMsg.extendedTextMessage?.text || '';
        const vvsTrigger = config.vvs || 'wow';

        // Compare case‑insensitive and trimmed
        if (replyText.trim().toLowerCase() !== vvsTrigger.toLowerCase()) return;

        // ─── VVS matched – decrypt and send to owner's DM ──────────
        const ownerJid = config.ownerJid || config.ownerLid;
        if (!ownerJid) {
            console.warn('⚠️ VVS: Owner JID not set, cannot forward.');
            return;
        }

        const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
        const mediaType = quotedViewOnce.imageMessage ? 'image' :
                          (quotedViewOnce.videoMessage ? 'video' : 'audio');

        const stream = await downloadContentFromMessage(viewOnceMediaQuoted, mediaType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        const caption = viewOnceMediaQuoted.caption || '🔮 *ViewOnce Decrypted*';

        // Send to owner's DM
        await sock.sendMessage(ownerJid, {
            [mediaType]: buffer,
            mimetype: viewOnceMediaQuoted.mimetype || 'application/octet-stream',
            caption: caption
        });

        // Optionally delete the VVS trigger message to keep it silent
        try {
            await sock.sendMessage(jid, { delete: msg.key });
        } catch (e) { /* ignore */ }

        console.log(`🔮 VVS: Decrypted ViewOnce from ${msg.key.participant || msg.key.remoteJid} and sent to owner.`);

    } catch (err) {
        console.error('❌ [VIEWONCE] handleViewOnce failed:', err.message);
    }
}

// ─── EXPORTS ─────────────────────────────────────────────────────

module.exports = {
    handleDeletion,
    handleViewOnce,
    getRawMessage
};