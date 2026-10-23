// plugins/mirror.js
const config = require('../config');

// Store active mirror sessions: Map<jid, { timer: Timeout, expiresAt: number }>
const activeMirrors = new Map();

// Helper to extract plain text from incoming messages
function getMessageText(message) {
    if (!message) return '';
    return message.conversation ||
           message.extendedTextMessage?.text ||
           message.imageMessage?.caption ||
           message.videoMessage?.caption ||
           '';
}

module.exports = [
    // ── 1. COMMAND: .m <text> — Send Exact Message ─────────────────
    {
        name: 'm',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const textToSend = (args || '').trim();

            if (!textToSend) {
                return await sock.sendMessage(jid, {
                    text: `❌ *Usage:* \`${config.prefix}m <text>\`\n*Example:* \`${config.prefix}m hi\``
                }, { quoted: msg });
            }

            // Check if the user replied to another message
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            const hasQuoted = contextInfo?.quotedMessage;

            if (hasQuoted) {
                // If replying to someone, deliver the message as a reply to them
                const targetMsg = {
                    key: {
                        remoteJid: jid,
                        id: contextInfo.stanzaId,
                        participant: contextInfo.participant
                    },
                    message: contextInfo.quotedMessage
                };
                await sock.sendMessage(jid, { text: textToSend }, { quoted: targetMsg });
            } else {
                // Otherwise, send directly to the chat
                await sock.sendMessage(jid, { text: textToSend });
            }
        }
    },

    // ── 2. COMMAND: .mirror on / off ──────────────────────────────
    {
        name: 'mirror',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const action = (args || '').trim().toLowerCase();

            // ── TURN ON ──
            if (action === 'on') {
                // Clear existing timer if already active
                if (activeMirrors.has(jid)) {
                    clearTimeout(activeMirrors.get(jid).timer);
                    activeMirrors.delete(jid);
                }

                // Set 10-minute auto-disable timer (600,000 ms)
                const timer = setTimeout(async () => {
                    activeMirrors.delete(jid);
                    try {
                        await sock.sendMessage(jid, {
                            text: '⏳ *Mirror mode has expired (10 minutes).* It has been automatically turned off.'
                        });
                    } catch (e) {
                        console.error('⚠️ [MIRROR] Expiry notification failed:', e.message);
                    }
                }, 10 * 60 * 1000);

                activeMirrors.set(jid, {
                    timer,
                    expiresAt: Date.now() + (10 * 60 * 1000)
                });

                return await sock.sendMessage(jid, {
                    text: '🪞 *Mirror mode is now ON!*\n\nReply to any of my messages with text, and I will send it right back word-for-word.\n\n_Auto-disables in 10 minutes._'
                }, { quoted: msg });
            }

            // ── TURN OFF ──
            if (action === 'off') {
                if (!activeMirrors.has(jid)) {
                    return await sock.sendMessage(jid, {
                        text: 'ℹ️ *Mirror mode is already OFF.*'
                    }, { quoted: msg });
                }

                clearTimeout(activeMirrors.get(jid).timer);
                activeMirrors.delete(jid);

                return await sock.sendMessage(jid, {
                    text: '🪞 *Mirror mode has been turned OFF.*'
                }, { quoted: msg });
            }

            // ── INVALID SYNTAX / STATUS ──
            const isActive = activeMirrors.has(jid);
            return await sock.sendMessage(jid, {
                text: `❌ *Usage:* \`${config.prefix}mirror on\` or \`${config.prefix}mirror off\`\n• *Current Status:* ${isActive ? '✅ ON' : '❌ OFF'}`
            }, { quoted: msg });
        }
    },

    // ── 3. LISTENER: Echo Replied Text When Mirror is Active ──────
    {
        name: 'mirror_listener',
        isPrefixless: true,
        execute: async (sock, msg) => {
            const jid = msg.key.remoteJid;

            // Only proceed if mirror mode is enabled for this chat
            if (!activeMirrors.has(jid)) return;

            // Ignore messages sent by the bot itself
            if (msg.key.fromMe) return;

            const text = getMessageText(msg.message);
            if (!text || !text.trim()) return;

            // Do not echo commands (allows the user to type .mirror off or .m)
            const prefix = config.prefix || '.';
            if (text.startsWith(prefix)) return;

            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            const quotedMessage = contextInfo?.quotedMessage;

            // Must be replying to a message
            if (!quotedMessage) return;

            // Verify that the quoted message was sent by the bot
            const botNumber = sock.user?.id ? sock.user.id.split(':')[0] : '';
            const quotedParticipant = contextInfo?.participant || '';

            const isQuotingBot =
                quotedParticipant.includes(botNumber) || // Group chat reply to bot
                (!quotedParticipant && !jid.endsWith('@g.us')); // Direct message reply to bot

            if (!isQuotingBot) return;

            // Echo text back exactly word-for-word
            try {
                await sock.sendMessage(jid, { text: text.trim() }, { quoted: msg });
            } catch (err) {
                console.error('❌ [MIRROR] Failed to echo:', err.message);
            }
        }
    }
];

// ─── COMMAND ALIASES ──────────────────────────────────────────────
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'm') aliases.push({ ...cmd, name: 'say' });
});
module.exports.push(...aliases);