// plugins/user.js
const config = require('../config');
const { normalizeToJid } = require('../stateManager');

// ─── HELPERS ──────────────────────────────────────────────────────

function cleanJid(jid) {
    if (!jid) return '';
    try {
        const raw = normalizeToJid(jid);
        if (!raw || !raw.includes('@')) return raw || '';
        const parts = raw.split('@');
        const userPart = parts[0].split(':')[0];
        return `${userPart}@${parts[1]}`;
    } catch (err) {
        return '';
    }
}

async function getBaileys() {
    let baileys;
    try {
        baileys = require('@whiskeysockets/baileys');
    } catch (e) {
        try {
            baileys = require('@itsliaaa/baileys');
        } catch (err) {
            try {
                baileys = await import('@whiskeysockets/baileys');
            } catch (importErr) {
                baileys = await import('@itsliaaa/baileys');
            }
        }
    }
    return baileys?.default || baileys;
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

/**
 * Attempts to extract the display name of a JID using available metadata and store resources.
 */
async function resolveUsername(sock, jid, msg) {
    if (!jid) return 'WhatsApp User';

    const senderJid = cleanJid(msg.key.participant || msg.key.remoteJid || '');
    if (jid === senderJid && msg.pushName) {
        return msg.pushName;
    }

    // Try reading from store if available
    if (sock.store?.contacts?.[jid]) {
        const contact = sock.store.contacts[jid];
        if (contact.name) return contact.name;
        if (contact.notify) return contact.notify;
    }

    // Try custom/socket getName helper
    if (typeof sock.getName === 'function') {
        try {
            const name = sock.getName(jid);
            if (name) return name;
        } catch (e) { /* ignore fallback */ }
    }

    // Try business profile check
    if (typeof sock.getBusinessProfile === 'function') {
        try {
            const profile = await sock.getBusinessProfile(jid);
            if (profile && profile.title) return profile.title;
        } catch (e) { /* ignore fallback */ }
    }

    // Fallback directly to formatted phone number rather than standard static text
    const num = jid.split('@')[0];
    return `+${num}`;
}

/**
 * Safely fetches profile picture URL
 */
async function getProfilePic(sock, jid) {
    try {
        return await sock.profilePictureUrl(jid, 'image');
    } catch (err) {
        return null;
    }
}

/**
 * Sends a native flow template containing user metadata, image, and CTA message button
 */
async function sendInteractiveProfile(sock, jid, targetJid, displayName, pfpUrl, quotedMsg) {
    const b = await getBaileys();
    const targetNum = targetJid.split('@')[0];
    const captionText = `/// ${displayName} ///`;

    let messageContent = {};

    if (pfpUrl) {
        const preparedMedia = await b.prepareWAMessageMedia(
            { image: { url: pfpUrl } },
            { upload: sock.waUploadToServer }
        );
        messageContent = {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        header: {
                            hasMediaAttachment: true,
                            imageMessage: preparedMedia.imageMessage
                        },
                        body: {
                            text: captionText
                        },
                        nativeFlowMessage: {
                            buttons: [
                                {
                                    name: "cta_url",
                                    buttonParamsJson: JSON.stringify({
                                        display_text: "Message 💬",
                                        url: `https://wa.me/${targetNum}`,
                                        merchant_url: `https://wa.me/${targetNum}`
                                    })
                                }
                            ]
                        }
                    }
                }
            }
        };
    } else {
        messageContent = {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        header: {
                            hasMediaAttachment: false
                        },
                        body: {
                            text: captionText
                        },
                        nativeFlowMessage: {
                            buttons: [
                                {
                                    name: "cta_url",
                                    buttonParamsJson: JSON.stringify({
                                        display_text: "Message 💬",
                                        url: `https://wa.me/${targetNum}`,
                                        merchant_url: `https://wa.me/${targetNum}`
                                    })
                                }
                            ]
                        }
                    }
                }
            }
        };
    }

    const generated = b.generateWAMessageFromContent(
        jid,
        b.proto.Message.fromObject(messageContent),
        { userJid: sock.user.id, quoted: quotedMsg }
    );

    await sock.relayMessage(jid, generated.message, { messageId: generated.key.id });
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 1. USER (Dynamic Username, Pfp & Message Button Layout)
    {
        name: 'user',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const targetJid = parseTargetUser(msg, args) || cleanJid(msg.key.participant || msg.key.remoteJid || '');
            const targetNum = targetJid.split('@')[0];

            try {
                const displayName = await resolveUsername(sock, targetJid, msg);
                const pfpUrl = await getProfilePic(sock, targetJid);

                await sendInteractiveProfile(sock, jid, targetJid, displayName, pfpUrl, msg);
            } catch (err) {
                console.error("[USER COMMAND ERROR]", err.message);
                // Standard fallback text link if native interactive fails
                await sock.sendMessage(jid, { text: `/// Contact ///\n\n💬 Message: https://wa.me/${targetNum}` }, { quoted: msg });
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

            let lidJid = 'N/A';
            try {
                if (sock.findUserId) {
                    const resolved = await sock.findUserId(targetJid);
                    if (resolved && resolved.lid) {
                        lidJid = cleanJid(resolved.lid);
                    }
                }
            } catch (lidErr) { /* ignore fallback */ }

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

    // 3. DEV (Native Flow Button Message)
    {
        name: 'dev',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const devJid = '2347040401291@s.whatsapp.net';
            const devPhoneNum = '2347040401291';

            try {
                const displayName = await resolveUsername(sock, devJid, msg);
                const pfpUrl = await getProfilePic(sock, devJid);

                await sendInteractiveProfile(sock, jid, devJid, displayName, pfpUrl, msg);
            } catch (err) {
                console.error("[DEV COMMAND ERROR]", err.message);
                // Hard fallback to standard text link if message relay fails
                await sock.sendMessage(jid, { text: `/// Dev Contact ///\n\n💬 Message: https://wa.me/${devPhoneNum}` }, { quoted: msg });
            }
        }
    }
];