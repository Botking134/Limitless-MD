// helpers/Message.js
const { normalizeToJid } = require('../stateManager');

// ─── MESSAGE NORMALIZERS ──────────────────────────────────────────

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    if (message.groupStatusMessageV2?.message) return getRawMessage(message.groupStatusMessageV2.message);
    return message;
}

function cleanJid(jid) {
    if (!jid) return '';
    const raw = normalizeToJid(jid);
    return raw.split('@')[0].split(':')[0] + '@' + (raw.includes('@g.us') ? 'g.us' : (raw.includes('@lid') ? 'lid' : 's.whatsapp.net'));
}

// Message types that represent the sender genuinely posting content, even
// when there's no text/caption for extractBodyAndTrim to pick up (e.g. a
// bare sticker, a captionless photo, a voice note). Used so activity/rank
// tracking doesn't silently ignore anyone who mostly sends media instead of
// typing. Deliberately excludes reactionMessage (reacting isn't posting) and
// protocolMessage (edits/deletes/revokes aren't new content) and poll VOTES
// (pollUpdateMessage — a vote, not a poll being posted).
const TRACKABLE_MEDIA_KEYS = [
    'stickerMessage',
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'documentMessage',
    'contactMessage',
    'contactsArrayMessage',
    'locationMessage',
    'liveLocationMessage',
    'listMessage',
    'pollCreationMessage',
    'pollCreationMessageV2',
    'pollCreationMessageV3'
];

function hasTrackableMediaContent(rawMsg) {
    if (!rawMsg) return false;
    return TRACKABLE_MEDIA_KEYS.some(key => !!rawMsg[key]);
}

function extractBodyAndTrim(msg) {
    const rawMsg = getRawMessage(msg.message) || msg.message;
    let body = rawMsg?.conversation ||
               rawMsg?.extendedTextMessage?.text ||
               rawMsg?.imageMessage?.caption ||
               rawMsg?.videoMessage?.caption ||
               msg.message?.buttonsResponseMessage?.selectedButtonId ||
               msg.message?.templateButtonReplyMessage?.selectedId ||
               '';

    if (!body && msg.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
        try {
            const params = JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
            if (params && params.id) {
                body = params.id;
            }
        } catch (e) { /* ignore */ }
    }

    if (!body && rawMsg?.groupStatusMessageV2?.message) {
        const statusInner = getRawMessage(rawMsg.groupStatusMessageV2.message);
        body = statusInner?.conversation || 
               statusInner?.extendedTextMessage?.text || 
               statusInner?.imageMessage?.caption || 
               statusInner?.videoMessage?.caption || 
               '';
    }

    return {
        rawMsg,
        body,
        trimmedMessageBody: body.trim(),
        lowerMessage: body.trim().toLowerCase()
    };
}

module.exports = {
    getRawMessage,
    cleanJid,
    extractBodyAndTrim,
    hasTrackableMediaContent
};