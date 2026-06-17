// helpers/log.js
const config = require('../config');
const { DEV_JIDS, DEV_LIDS } = require('../devs');
const { normalizeToJid } = require('../stateManager');

// ─── MESSAGE UNWRAPPER ──────────────────────────────────────────
/**
 * Recursively unwraps nested message structures (ephemeral, view-once, etc.)
 */
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

/**
 * Called when a message is deleted (via messages.update event).
 * Checks config.antidelete.mode and forwards the deleted content to Bot DM if applicable.
 */
async function handleDeletion(sock, originalMsg, jid, revokerJid) {
    try {
        const mode = config.antidelete?.mode || 'off';
        if (mode === 'off') return;

        const isGroup = jid.endsWith('@g.us');

        // ─── Scope Filtering ────────────────────────────────────
        if (mode === 'group' && !isGroup) return;
        if (mode === 'pm' && (isGroup || jid === 'status@broadcast')) return;

        // ─── Skip self-deletions by the bot ────────────────────
        if (originalMsg.key.fromMe) return;

        const rawContent = getRawMessage(originalMsg.message);
        if (!rawContent) return;

        // ─── Build Log Header ──────────────────────────────────
        const sender = originalMsg.key.participant || originalMsg.key.remoteJid || '';
        const senderJid = normalizeToJid(sender);
        const revokerJidNorm = normalizeToJid(revokerJid);

        const logHeader = 
            `🚨 *ANTIDELETE LOG* 🚨\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📂 *Chat:* @${jid.split('@')[0]}\n` +
            `✍️ *Author:* @${senderJid.split('@')[0]}\n` +
            `🗑️ *Deleted by:* @${revokerJidNorm.split('@')[0]}\n`;

        // ─── Destination: Bot DM only ──────────────────────────
        const destJid = config.botJid || config.botLid || sock.user.id;
        if (!destJid) return;

        const { downloadContentFromMessage } = await import('@itsliaaa/baileys');

        // ─── Extract text content ──────────────────────────────
        const textContent = 
            rawContent.conversation ||
            rawContent.extendedTextMessage?.text ||
            rawContent.imageMessage?.caption ||
            rawContent.videoMessage?.caption ||
            '';

        // ─── Handle Media ──────────────────────────────────────
        if (rawContent.imageMessage) {
            const stream = await downloadContentFromMessage(rawContent.imageMessage, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await sock.sendMessage(destJid, {
                image: buffer,
                caption: `${logHeader}📷 *Type:* Image\n📝 *Caption:* "${textContent}"`,
                mentions: [senderJid, revokerJidNorm]
            });
        } 
        else if (rawContent.videoMessage) {
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
        } 
        else if (rawContent.audioMessage) {
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
        } 
        else if (rawContent.stickerMessage) {
            const stream = await downloadContentFromMessage(rawContent.stickerMessage, 'sticker');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await sock.sendMessage(destJid, {
                text: `${logHeader}🎨 *Type:* Sticker`,
                mentions: [senderJid, revokerJidNorm]
            });
            await sock.sendMessage(destJid, { sticker: buffer });
        } 
        else {
            // ─── Text-only deletion ────────────────────────────
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

// ─── HANDLE VIEWONCE MEDIA ────────────────────────────────────

/**
 * Called when a ViewOnce message is detected (via messages.upsert).
 * Checks config.antiviewonce.mode and forwards the decrypted media to Bot DM if applicable.
 */
async function handleViewOnce(sock, msg) {
    try {
        const mode = config.antiviewonce?.mode || 'off';
        if (mode === 'off') return;

        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');

        // ─── Scope Filtering ────────────────────────────────────
        if (mode === 'group' && !isGroup) return;
        if (mode === 'pm' && (isGroup || jid === 'status@broadcast')) return;

        // ─── Skip self-messages ────────────────────────────────
        if (msg.key.fromMe) return;

        const rawContent = getRawMessage(msg.message);
        const isViewOnce = msg.message?.viewOnceMessage ||
                           msg.message?.viewOnceMessageV2 ||
                           msg.message?.viewOnceMessageV2Extension;

        if (!isViewOnce) return;

        const viewOnceMedia = rawContent?.imageMessage ||
                              rawContent?.videoMessage ||
                              rawContent?.audioMessage;

        if (!viewOnceMedia) return;

        // ─── Deduplication Lock ────────────────────────────────
        if (!global.processedViewOnces) global.processedViewOnces = new Set();
        const voKey = `${jid}_${msg.key.id}`;
        if (global.processedViewOnces.has(voKey)) return;
        global.processedViewOnces.add(voKey);
        setTimeout(() => global.processedViewOnces.delete(voKey), 10 * 60 * 1000);

        // ─── Build Log Header ──────────────────────────────────
        const sender = msg.key.participant || msg.key.remoteJid || '';
        const senderJid = normalizeToJid(sender);

        const logHeader =
            `🚨 *ANTIVIEWONCE LOG* 🚨\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📂 *Chat:* @${jid.split('@')[0]}\n` +
            `✍️ *Sender:* @${senderJid.split('@')[0]}\n`;

        // ─── Destination: Bot DM only ──────────────────────────
        const destJid = config.botJid || config.botLid || sock.user.id;
        if (!destJid) return;

        const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
        const mediaType = rawContent.imageMessage ? 'image' :
                          (rawContent.videoMessage ? 'video' : 'audio');

        const stream = await downloadContentFromMessage(viewOnceMedia, mediaType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        const caption = viewOnceMedia.caption || '';

        // ─── Send Media ──────────────────────────────────────────
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

        // ─── Optional: React to confirm capture ────────────────
        try {
            await sock.sendMessage(jid, { react: { text: '👁️', key: msg.key } });
        } catch (e) { /* ignore */ }

    } catch (err) {
        console.error('❌ [ANTIVIEWONCE] handleViewOnce failed:', err.message);
    }
}

// ─── EXPORTS ─────────────────────────────────────────────────────

module.exports = {
    handleDeletion,
    handleViewOnce,
    getRawMessage
};