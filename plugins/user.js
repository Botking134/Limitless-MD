// plugins/user/user.js
const config = require('../config');
const { getPhoneJid, normalizeToJid } = require('../stateManager');

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
    // 1. USER (Dynamic Profile Card with LID Mention & wa.me Button)
    {
        name: 'user',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const targetJid = parseTargetUser(msg, args) || cleanJid(msg.key.participant || msg.key.remoteJid || '');

            // 1. Resolve LID (for clickable @user mention)
            let targetLid = targetJid;
            try {
                if (sock.findUserId && targetJid.endsWith('@s.whatsapp.net')) {
                    const resolved = await sock.findUserId(targetJid);
                    if (resolved && resolved.lid) {
                        targetLid = cleanJid(resolved.lid);
                    }
                }
            } catch (e) { /* ignore */ }

            // 2. Resolve Standard Phone Number (for wa.me button link)
            let phoneNum = '';
            if (targetJid.endsWith('@s.whatsapp.net')) {
                phoneNum = targetJid.split('@')[0];
            } else {
                try {
                    if (getPhoneJid) {
                        const resolvedPhone = await getPhoneJid(sock, targetJid);
                        if (resolvedPhone) {
                            phoneNum = resolvedPhone.split('@')[0];
                        }
                    }
                } catch (e) { /* ignore */ }
            }

            // Fallback to JID prefix if reverse lookup fails
            if (!phoneNum) {
                phoneNum = targetJid.split('@')[0];
            }

            // 3. Fetch target's profile photo url safely
            let pfpUrl = null;
            try {
                pfpUrl = await sock.profilePictureUrl(targetJid, 'image');
            } catch (pfpErr) { /* fallback to null if private */ }

            // Mention string targeting their LID for direct clickability
            const lidNumber = targetLid.split('@')[0];
            const captionText = `@${lidNumber}`;

            try {
                const b = await getBaileys();
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
                                                    url: `https://wa.me/${phoneNum}`,
                                                    merchant_url: `https://wa.me/${phoneNum}`
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
                                                    url: `https://wa.me/${phoneNum}`,
                                                    merchant_url: `https://wa.me/${phoneNum}`
                                                })
                                            }
                                        ]
                                    }
                                }
                            }
                        }
                    };
                }

                // Compile and relay the interactive payload with mentions mapping
                const generated = b.generateWAMessageFromContent(
                    jid,
                    b.proto.Message.fromObject(messageContent),
                    { userJid: sock.user.id }
                );

                generated.message.viewOnceMessage.message.interactiveMessage.contextInfo = {
                    mentionedJid: [targetLid]
                };

                await sock.relayMessage(jid, generated.message, { messageId: generated.key.id });

            } catch (err) {
                console.error("[USER COMMAND ERROR]", err.message);
                // Hard fallback to standard text and link if everything fails
                await sock.sendMessage(jid, { 
                    text: `@${lidNumber}\n\n💬 Message: https://wa.me/${phoneNum}`, 
                    mentions: [targetLid] 
                }, { quoted: msg });
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

    // 3. DEV (Native Flow Button Message with exact Developer @mention)
    {
        name: 'dev',
        isPrefixless: false,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;
            const devJid = '2347040401291@s.whatsapp.net';
            const devPhoneNum = '2347040401291';

            // Fetch Developer's profile photo url safely
            let pfpUrl = null;
            try {
                pfpUrl = await sock.profilePictureUrl(devJid, 'image');
            } catch (pfpErr) { /* fallback to null if private */ }

            const captionText = `@${devPhoneNum}`;

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

                // Compile and relay the interactive payload directly with the mentions context mapping
                const generated = b.generateWAMessageFromContent(
                    jid,
                    b.proto.Message.fromObject(messageContent),
                    { userJid: sock.user.id }
                );

                // Inject mentions into the interactive message context info
                generated.message.viewOnceMessage.message.interactiveMessage.contextInfo = {
                    mentionedJid: [devJid]
                };

                await sock.relayMessage(jid, generated.message, { messageId: generated.key.id });

            } catch (err) {
                console.error("[DEV COMMAND ERROR]", err.message);
                // Hard fallback to standard mention text if everything fails
                await sock.sendMessage(jid, { text: `@${devPhoneNum}\n\n💬 Message: https://wa.me/${devPhoneNum}`, mentions: [devJid] }, { quoted: msg });
            }
        }
    }
];