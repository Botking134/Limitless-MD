// helpers/TagHelper.js
// Shared logic for tag / tagall / ghost / summon / summon-all.
// Fixes the old behaviour where replying to a captioned picture with a tag
// command only re-sent the caption text and dropped the image itself.

const MEDIA_NODES = {
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio',
    stickerMessage: 'sticker',
    documentMessage: 'document'
};

function unwrap(message) {
    if (!message) return message;
    if (message.ephemeralMessage?.message) return unwrap(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return unwrap(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return unwrap(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return unwrap(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return unwrap(message.documentWithCaptionMessage.message);
    return message;
}

// Plain text of the incoming command message (used to tell ".summon" from "summon")
function getBody(msg) {
    const raw = unwrap(msg.message) || {};
    return raw.conversation
        || raw.extendedTextMessage?.text
        || raw.imageMessage?.caption
        || raw.videoMessage?.caption
        || '';
}

// Returns { text, media: { type, node } | null } for the message being replied to, or null.
function getQuoted(msg) {
    const raw = unwrap(msg.message);
    if (!raw) return null;

    let ctx = null;
    for (const value of Object.values(raw)) {
        if (value && typeof value === 'object' && value.contextInfo?.quotedMessage) {
            ctx = value.contextInfo;
            break;
        }
    }
    if (!ctx) return null;

    const q = unwrap(ctx.quotedMessage);
    if (!q) return null;

    const text = q.conversation
        || q.extendedTextMessage?.text
        || q.imageMessage?.caption
        || q.videoMessage?.caption
        || q.documentMessage?.caption
        || '';

    let media = null;
    for (const [nodeName, type] of Object.entries(MEDIA_NODES)) {
        if (q[nodeName]) {
            media = { type, node: q[nodeName] };
            break;
        }
    }

    return { text, media };
}

async function downloadBuffer(node, type) {
    const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
    const stream = await downloadContentFromMessage(node, type);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

// Re-sends the replied-to media with `caption` and hidden mentions for everyone.
// `extraText` (optional) is sent afterwards as its own mentioned message
// (used by tagall for the member list, and for media types with no caption).
// Returns true when the media went out, false so the caller can fall back to text.
async function sendWithQuotedMedia(sock, jid, quoted, caption, mentions, extraText = '') {
    if (!quoted?.media) return false;
    const { type, node } = quoted.media;

    try {
        const buffer = await downloadBuffer(node, type);
        let captioned = true;
        let payload;

        if (type === 'image') {
            payload = { image: buffer, caption: caption || '', mentions };
        } else if (type === 'video') {
            payload = { video: buffer, caption: caption || '', mentions, gifPlayback: !!node.gifPlayback };
        } else if (type === 'document') {
            payload = {
                document: buffer,
                mimetype: node.mimetype || 'application/octet-stream',
                fileName: node.fileName || 'file',
                caption: caption || '',
                mentions
            };
        } else if (type === 'audio') {
            captioned = false;
            payload = { audio: buffer, mimetype: node.mimetype || 'audio/mpeg', ptt: !!node.ptt, mentions };
        } else {
            captioned = false;
            payload = { sticker: buffer, mentions };
        }

        await sock.sendMessage(jid, payload);

        // Audio / stickers can't carry a caption, so the text follows separately.
        const followUp = [captioned ? '' : caption, extraText].filter(Boolean).join('\n\n');
        if (followUp) await sock.sendMessage(jid, { text: followUp, mentions });

        return true;
    } catch (err) {
        console.error('[TagHelper] Failed to forward quoted media:', err.message);
        return false;
    }
}

// JID of whoever sent the command. `participantIds` is the group's list of JIDs,
// used to pick the right form (phone JID vs LID) when the bot itself is the sender.
function getSenderJid(sock, msg, participantIds = []) {
    const strip = (j) => (j || '').replace(/:\d+@/, '@');
    if (msg.key.fromMe) {
        const own = [strip(sock.user?.id), strip(sock.user?.lid)].filter(Boolean);
        return own.find(j => participantIds.includes(j)) || own[0] || null;
    }
    return msg.key.participant || msg.participant || null;
}

module.exports = { unwrap, getBody, getQuoted, sendWithQuotedMedia, getSenderJid };
