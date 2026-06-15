// helpers/antiViewOnce.js
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

// Unified Automated View-Once Interception Helper
async function handleAntiViewOnce(sock, msg) {
    try {
        const config = settings.antiviewonce || { status: 'off', logDestination: 'bot' };
        const status = config.status;
        const jid = msg.key.remoteJid;

        // Bypass self-messages to prevent loopbacks
        if (msg.key.fromMe) return;

        let shouldDecrypt = false;
        if (status === 'all') {
            shouldDecrypt = jid.endsWith('@g.us'); // Decrypts in all groups
        } else if (status === 'here') {
            shouldDecrypt = (config.hereJid === jid); // Decrypts strictly in this chat
        }

        if (!shouldDecrypt) return;

        // Locate and verify the existence of a View-Once wrapper in the message payload
        const rawContent = getRawMessage(msg.message);
        const isViewOnce = msg.message?.viewOnceMessage || 
                           msg.message?.viewOnceMessageV2 || 
                           msg.message?.viewOnceMessageV2Extension;

        if (!isViewOnce) return;

        const viewOnceMedia = rawContent?.imageMessage || rawContent?.videoMessage || rawContent?.audioMessage;
        if (!viewOnceMedia) return;

        // Implement deduplication lock to completely prevent double-logging bugs
        if (!global.processedViewOnces) global.processedViewOnces = new Set();
        const voKey = `${jid}_${msg.key.id}`;
        if (global.processedViewOnces.has(voKey)) return;
        global.processedViewOnces.add(voKey);
        setTimeout(() => global.processedViewOnces.delete(voKey), 10 * 60 * 1000); // 10-minute cache hold

        let destJid = '';
        const botJid = sock.user.id ? normalizeToJid(sock.user.id) : '';

        // Route logs privately based on configuration
        if (config.logDestination === 'user' && config.logUserJid && isOwnerOrDev(config.logUserJid)) {
            destJid = normalizeToJid(config.logUserJid);
        } else {
            destJid = botJid;
        }

        // Secure fallback to owner's destination if empty
        if (!destJid) {
            destJid = settings.ownerLid || settings.ownerJid || (settings.ownerNumber + '@s.whatsapp.net');
        }

        const sender = msg.key.participant || msg.key.remoteJid || '';
        const logHeader = `🚨 *ANTI-VIEWONCE INTERCEPT LOG:* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `👥 *Group/Chat:* @${jid.split('@')[0]}\n` +
                          `👤 *Sender:* @${sender.split('@')[0]}\n`;

        const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
        const mediaType = rawContent.imageMessage ? 'image' : (rawContent.videoMessage ? 'video' : 'audio');

        const stream = await downloadContentFromMessage(viewOnceMedia, mediaType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        const textContent = viewOnceMedia.caption || '';

        if (mediaType === 'image') {
            await sock.sendMessage(destJid, { image: buffer, caption: `${logHeader}📷 *Type:* Image\n📝 *Caption:* "${textContent}"`, mentions: [sender] });
        } else if (mediaType === 'video') {
            const mime = viewOnceMedia.mimetype || "video/mp4";
            await sock.sendMessage(destJid, { video: buffer, mimetype: mime, caption: `${logHeader}🎥 *Type:* Video\n📝 *Caption:* "${textContent}"`, mentions: [sender] });
        } else if (mediaType === 'audio') {
            const mime = viewOnceMedia.mimetype || "audio/ogg; codecs=opus";
            await sock.sendMessage(destJid, { text: `${logHeader}🎵 *Type:* Voice Note`, mentions: [sender] });
            await sock.sendMessage(destJid, { audio: buffer, mimetype: mime, ptt: viewOnceMedia.ptt || false });
        }
    } catch (err) {
        console.error("❌ [ANTI-VIEWONCE] handleAntiViewOnce failed:", err.message);
    }
}

module.exports = { handleAntiViewOnce };