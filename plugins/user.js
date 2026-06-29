// plugins/user/user.js
const config = require('../../config');
const { normalizeToJid } = require('../../stateManager');

// ─── HELPERS ──────────────────────────────────────────────────────

function cleanJid(jid) {
    if (!jid) return '';
    const raw = normalizeToJid(jid);
    return raw.split('@')[0].split(':')[0] + '@' + raw.split('@')[1];
}

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

function parseTargetUser(msg, args) {
    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo ||
                        rawMsg?.extendedTextMessage?.contextInfo ||
                        rawMsg?.imageMessage?.contextInfo ||
                        rawMsg?.videoMessage?.contextInfo ||
                        rawMsg?.stickerMessage?.contextInfo ||
                        rawMsg?.audioMessage?.contextInfo ||
                        rawMsg?.documentMessage?.contextInfo;

    const mentions = contextInfo?.mentionedJid || [];

    if (mentions.length > 0) {
        return cleanJid(mentions[0]);
    }

    if (contextInfo?.participant) {
        return cleanJid(contextInfo.participant);
    }

    if (args) {
        const cleanDigits = args.replace(/[^0-9]/g, '');
        if (cleanDigits.length >= 7) {
            return `${cleanDigits}@s.whatsapp.net`;
        }
    }

    return '';
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 1. USER (Dynamic Contact Card with Exact Name)
    {
        name: 'user',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const targetJid = parseTargetUser(msg, args) || cleanJid(msg.key.participant || msg.key.remoteJid || '');
            const targetNum = targetJid.split('@')[0];

            // Dynamically resolve their exact profile/LID name
            let username = 'WhatsApp User';
            try {
                if (sock.getName) {
                    username = sock.getName(targetJid) || 'WhatsApp User';
                } else if (targetJid === cleanJid(msg.key.participant || msg.key.remoteJid || '')) {
                    username = msg.pushName || 'WhatsApp User';
                }
            } catch (e) { /* fallback to default */ }

            const vcard = 'BEGIN:VCARD\n' +
                          'VERSION:3.0\n' +
                          `FN: /// ${username} ///\n` +
                          'ORG:Business Account;\n' +
                          `TEL;type=CELL;type=VOICE;waid=${targetNum}:+${targetNum}\n` +
                          'END:VCARD';

            try {
                // Highly compatible single-contact card payload structure
                await sock.sendMessage(jid, {
                    contact: {
                        displayName: `/// ${username} ///`,
                        vcard: vcard
                    }
                }, { quoted: msg });
            } catch (err) {
                console.error("[USER COMMAND ERROR]", err.message);
            }
        }
    },

    // 2. ID (Identifier Resolver Dossier)
    {
        name: 'id',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const targetJid = parseTargetUser(msg, args) || cleanJid(msg.key.participant || msg.key.remoteJid || '');
            const targetNum = targetJid.split('@')[0];

            let lidJid = 'N/A';
            try {
                if (sock.findUserId) {
                    const resolved = await sock.findUserId(targetJid);
                    if (resolved && resolved.lid) {
                        lidJid = cleanJid(resolved.lid);
                    }
                }
            } catch (lidErr) { /* ignore and use N/A fallback */ }

            let layout = `🧬 *Domain ID Resolver*\n` +
                         `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                         `• *User JID:* \`${targetJid}\`\n` +
                         `• *User LID:* \`${lidJid}\`\n`;

            if (jid.endsWith('@g.us')) {
                layout += `• *Group JID:* \`${jid}\`\n`;
            }

            layout += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `👉 _Identifiers resolved directly from WhatsApp servers._`;

            try {
                await sock.sendMessage(jid, { text: layout, mentions: [targetJid] }, { quoted: msg });
            } catch (err) {
                console.error("[ID COMMAND ERROR]", err.message);
            }
        }
    },

    // 3. DEV (Overhauled Template-Button Layout)
    {
        name: 'dev',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const devJid = '2347040401291@s.whatsapp.net';
            const devPhoneNum = '2347040401291';

            // 1. Dynamically extract the exact registered LID/Business Username
            let devName = 'Ghost';
            try {
                if (sock.getBusinessProfile) {
                    const business = await sock.getBusinessProfile(devJid);
                    if (business && business.title) {
                        devName = business.title;
                    } else if (sock.getName) {
                        devName = sock.getName(devJid) || 'Ghost';
                    }
                } else if (sock.getName) {
                    devName = sock.getName(devJid) || 'Ghost';
                }
            } catch (err) { /* fallback to 'Ghost' if privacy settings or network block queries */ }

            // 2. Fetch Developer's profile photo url safely
            let pfpUrl = null;
            try {
                pfpUrl = await sock.profilePictureUrl(devJid, 'image');
            } catch (pfpErr) { /* fallback to null if profile picture is private */ }

            // 3. Construct URL Button template
            const templateButtons = [
                { index: 1, urlButton: { displayText: 'Message 💬', url: `https://wa.me/${devPhoneNum}` } }
            ];

            const captionText = `/// ${devName} ///`;

            try {
                if (pfpUrl) {
                    await sock.sendMessage(jid, {
                        image: { url: pfpUrl },
                        caption: captionText,
                        templateButtons: templateButtons
                    }, { quoted: msg });
                } else {
                    // Fallback to text message with buttons if developer profile pic is completely hidden
                    await sock.sendMessage(jid, {
                        text: captionText,
                        templateButtons: templateButtons
                    }, { quoted: msg });
                }
            } catch (err) {
                console.error("[DEV COMMAND ERROR]", err.message);
            }
        }
    }
];