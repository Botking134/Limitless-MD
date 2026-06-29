// plugins/user.js
const config = require('../../config');
const { normalizeToJid } = require('../../stateManager');

// ─── HELPERS ──────────────────────────────────────────────────────

function cleanJid(jid) {
    if (!jid) return '';
    const raw = normalizeToJid(jid);
    return raw.split('@')[0].split(':')[0] + '@' + raw.split('@')[1];
}

async function getBaileys() {
    try {
        return require('@whiskeysockets/baileys');
    } catch (e) {
        try {
            return require('@itsliaaa/baileys');
        } catch (err) {
            try {
                return await import('@whiskeysockets/baileys');
            } catch (importErr) {
                return await import('@itsliaaa/baileys');
            }
        }
    }
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
                // Correct multi-contact array payload with a single card entry
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

    // 3. DEV (Native Flow Button Message)
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
            } catch (err) { /* fallback to 'Ghost' if blocked */ }

            // 2. Fetch Developer's profile photo url safely
            let pfpUrl = null;
            try {
                pfpUrl = await sock.profilePictureUrl(devJid, 'image');
            } catch (pfpErr) { /* fallback to null if private */ }

            const captionText = `/// ${devName} ///`;

            try {
                const b = await getBaileys();
                
                // Build a modern, universally supported WhatsApp Native Flow Button Message
                let messageContent = {};

                if (pfpUrl) {
                    const preparedMedia = await b.prepareWAMessageMedia({ image: { url: pfpUrl } }, { upload: sock.waUploadToServer });
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
                                                    url: `https://wa.me/${devPhoneNum}`,
                                                    merchant_url: `https://wa.me/${devPhoneNum}`
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
                                                    url: `https://wa.me/${devPhoneNum}`,
                                                    merchant_url: `https://wa.me/${devPhoneNum}`
                                                })
                                            }
                                        ]
                                    }
                                }
                            }
                        }
                    };
                }

                // Compile and relay the interactive payload directly
                const generated = b.generateWAMessageFromContent(
                    jid,
                    b.proto.Message.fromObject(messageContent),
                    { userJid: sock.user.id }
                );

                await sock.relayMessage(jid, generated.message, { messageId: generated.key.id });

            } catch (err) {
                console.error("[DEV COMMAND ERROR]", err.message);
                // Hard fallback to standard link text if everything fails
                await sock.sendMessage(jid, { text: `/// ${devName} ///\n\n💬 Message: https://wa.me/${devPhoneNum}` }, { quoted: msg });
            }
        }
    }
];