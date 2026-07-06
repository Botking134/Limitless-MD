// Extracts text or captions, supporting both raw Baileys structures and pre-parsed envelopes
function getMessageText(msg) {
    if (!msg) return '';
    if (typeof msg === 'string') return msg;
    
    // Fallback to common pre-parsed properties used by bot handlers
    if (msg.body) return msg.body;
    if (msg.text) return msg.text;

    const raw = getRawMessage(msg.message);
    if (!raw) return '';

    return (
        raw.conversation ||
        raw.extendedTextMessage?.text ||
        raw.imageMessage?.caption ||
        raw.videoMessage?.caption ||
        raw.documentMessage?.caption ||
        ''
    );
}

// Determines if Delta was addressed (via private chat, reply, mention, or name trigger)
function isAddressed(sock, msg) {
    const jid = msg.key.remoteJid;

    // Private chats are always processed
    if (jid.endsWith('@s.whatsapp.net') && !jid.includes('g.us')) return true;

    const raw = getRawMessage(msg.message);
    const contextInfo = raw?.extendedTextMessage?.contextInfo ||
                        raw?.imageMessage?.contextInfo ||
                        raw?.videoMessage?.contextInfo ||
                        raw?.contextInfo ||
                        msg.message?.contextInfo ||
                        msg.contextInfo;

    // Support both .id and .jid properties on the active connection user
    const botJid = sock.user?.id 
        ? normalizeToJid(sock.user.id) 
        : (sock.user?.jid ? normalizeToJid(sock.user.jid) : '');

    // 1. Check if replying directly to the bot
    let quotedParticipant = '';
    if (msg.quoted?.sender) quotedParticipant = normalizeToJid(msg.quoted.sender);
    else if (msg.quoted?.participant) quotedParticipant = normalizeToJid(msg.quoted.participant);
    else if (contextInfo?.participant) quotedParticipant = normalizeToJid(contextInfo.participant);

    if (quotedParticipant && botJid && quotedParticipant === botJid) {
        return true;
    }

    // 2. Check if the bot was explicitly mentioned in the group
    const mentions = contextInfo?.mentionedJid || msg.mentionedJid || [];
    if (botJid && mentions.some(m => normalizeToJid(m) === botJid)) {
        return true;
    }

    // 3. Check if the name "delta" is anywhere in the message text
    const text = getMessageText(msg);
    if (text.toLowerCase().includes('delta')) {
        return true;
    }
    if (botJid && text.includes(`@${botJid.split('@')[0]}`)) {
        return true;
    }

    return false;
}