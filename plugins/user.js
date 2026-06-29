// plugins/user/user.js
const config = require('../config');
const { normalizeToJid } = require('../stateManager');
const { DEV_LIDS } = require('./devs');

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
    // 1. USER (Sends Target's Contact Card)
    {
        name: 'user',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const targetJid = parseTargetUser(msg, args) || cleanJid(msg.key.participant || msg.key.remoteJid || '');
            const targetNum = targetJid.split('@')[0];

            let username = 'User';
            if (cleanJid(targetJid) === cleanJid(msg.key.participant || msg.key.remoteJid || '')) {
                username = msg.pushName || 'User';
            } else {
                username = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ? 'Ghost Entity' : 'User';
            }

            // Construct standard vCard payload
            const vcard = 'BEGIN:VCARD\n' +
                          'VERSION:3.0\n' +
                          `FN: /// ${username} ///\n` +
                          'ORG:Business Account;\n' +
                          `TEL;type=CELL;type=VOICE;waid=${targetNum}:+${targetNum}\n` +
                          'END:VCARD';

            try {
                await sock.sendMessage(jid, {
                    contacts: {
                        displayName: `/// ${username} ///`,
                        contacts: [{ vcard }]
                    }
                }, { quoted: msg });
            } catch (err) {
                console.error("[USER COMMAND ERROR]", err.message);
            }
        }
    },

    // 2. INFO (Fetches Target's Metadata & Status)
    {
        name: 'info',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const targetJid = parseTargetUser(msg, args) || cleanJid(msg.key.participant || msg.key.remoteJid || '');
            const targetNum = targetJid.split('@')[0];

            let username = 'User';
            if (cleanJid(targetJid) === cleanJid(msg.key.participant || msg.key.remoteJid || '')) {
                username = msg.pushName || 'User';
            } else {
                username = 'User';
            }

            // Fetch profile picture safely ( privacy boundaries can block this )
            let pfpUrl = null;
            try {
                pfpUrl = await sock.profilePictureUrl(targetJid, 'image');
            } catch (pfpErr) {
                // Profile photo remains null if blocked or not found
            }

            // Fetch about status text safely ( privacy boundaries can block this )
            let statusText = "No bio status available.";
            let lastUpdated = "N/A";
            try {
                const status = await sock.fetchStatus(targetJid);
                if (status && status.status) {
                    statusText = status.status;
                    if (status.setAt) {
                        lastUpdated = new Date(status.setAt).toLocaleString();
                    }
                }
            } catch (statusErr) {
                // Status remains at fallback if blocked
            }

            const caption = `👤 *Domain Profile Dossier*\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                            `• *Name:* \`${username}\`\n` +
                            `• *Number:* \`+${targetNum}\`\n` +
                            `• *JID:* \`${targetJid}\`\n` +
                            `• *Status/About:* _"${statusText}"_\n` +
                            `• *Last Updated:* \`${lastUpdated}\`\n\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                            `👉 _Dossier fetched directly from WhatsApp secure servers._`;

            try {
                if (pfpUrl) {
                    await sock.sendMessage(jid, { 
                        image: { url: pfpUrl }, 
                        caption: caption, 
                        mentions: [targetJid] 
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { 
                        text: caption, 
                        mentions: [targetJid] 
                    }, { quoted: msg });
                }
            } catch (err) {
                console.error("[INFO COMMAND ERROR]", err.message);
            }
        }
    },

    // 3. DEV (Randomized Developer vCard)
    {
        name: 'dev',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const devNumbers = ['2347040401291', '27713655070'];
            
            // Random selection of developer number
            const randomNum = devNumbers[Math.floor(Math.random() * devNumbers.length)];
            const devName = randomNum === '2347040401291' ? 'Ghost (Dev 1)' : 'Gojo (Dev 2)';

            const vcard = 'BEGIN:VCARD\n' +
                          'VERSION:3.0\n' +
                          `FN: /// ${devName} ///\n` +
                          'ORG:Business Account;\n' +
                          `TEL;type=CELL;type=VOICE;waid=${randomNum}:+${randomNum}\n` +
                          'END:VCARD';

            try {
                await sock.sendMessage(jid, {
                    contacts: {
                        displayName: `/// ${devName} ///`,
                        contacts: [{ vcard }]
                    }
                }, { quoted: msg });
            } catch (err) {
                console.error("[DEV COMMAND ERROR]", err.message);
            }
        }
    }
];