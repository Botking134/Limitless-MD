// plugins/subbot.js
const config = require('../config');
const SubBotManager = require('../helpers/SubBotManager');

let DEV_LIDS = [], DEV_JIDS = [], DEV_PHONE_JIDS = [];
try { ({ DEV_LIDS = [], DEV_JIDS = [], DEV_PHONE_JIDS = [] } = require('./devs')); } catch (e) {}

let baileysPromise = null;
const getBaileys = () => baileysPromise || (baileysPromise = import('@itsliaaa/baileys'));

function withTimeout(promise, ms, message) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
    ]);
}

// ─── HELPERS ───────────────────────────────────────────────────
const digitsOf = (s) => String(s || '').split('@')[0].split(':')[0];

function isPrivileged(sender) {
    const list = [
        config.ownerJid, config.ownerLid,
        ...(config.ownerLids || []), ...(config.secondaryOwners || []), ...(config.sudos || []),
        ...DEV_LIDS, ...DEV_JIDS, ...DEV_PHONE_JIDS
    ].filter(Boolean).map(digitsOf);
    return list.includes(digitsOf(sender));
}

async function safeSend(sock, jid, content, options) {
    try { return await sock.sendMessage(jid, content, options); } catch (e) { return null; }
}

// ─── THE ONE PAIRING MESSAGE ───────────────────────────────────
function buildPairingText(phoneNumber, code) {
    const pretty = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
    return (
        `╭━━━━━━━━━━━━━━━━━━━━╮\n` +
        `      🔗 *BOT PAIRING*\n` +
        `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `📱 *Number :* ${phoneNumber}\n` +
        `🔑 *Code :* \`${pretty}\`\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `1️⃣ Open *WhatsApp* on that phone\n` +
        `2️⃣ *Settings → Linked Devices → Link a Device*\n` +
        `3️⃣ Tap *"Link with phone number instead"*\n` +
        `4️⃣ Enter the code above\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⏱️ _Code expires in about 60 seconds_`
    );
}

/** Creates the session and sends ONE message: details + code + 3 buttons. */
async function startPairing(sock, jid, phoneNumber, requesterJid, quoted) {
    const statusMsg = await safeSend(sock, jid, {
        text: `⏳ Spinning up a session for \`${phoneNumber}\`... this can take up to 20 seconds.`
    }, quoted ? { quoted } : undefined);

    const dropStatus = async () => {
        try { if (statusMsg?.key) await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) {}
    };

    try {
        const codePromise = new Promise((resolve, reject) => {
            SubBotManager.createSubBot(
                phoneNumber,
                requesterJid,
                (code) => resolve(code),
                reject
            ).catch(reject);
        });

        const code = await withTimeout(
            codePromise,
            25000,
            'Timed out waiting for WhatsApp to issue a pairing code. Try again in a minute.'
        );

        await dropStatus();

        const text = buildPairingText(phoneNumber, code);
        const b = await getBaileys();

        // ── MATCH SHARINGAN.JS PROTOBUF STRUCTURE ──
        const content = {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        header: { hasMediaAttachment: false },
                        body: { text: text },
                        footer: { text: 'Tap a button below' },
                        nativeFlowMessage: {
                            buttons: [
                                {
                                    name: 'cta_copy',
                                    buttonParamsJson: JSON.stringify({
                                        display_text: '📋 Copy Pair Code',
                                        id: `sb_copy:${phoneNumber}`,
                                        copy_code: code
                                    })
                                },
                                {
                                    name: 'quick_reply',
                                    buttonParamsJson: JSON.stringify({
                                        display_text: '🗑️ Delete Session',
                                        id: `sb_del:${phoneNumber}`
                                    })
                                },
                                {
                                    name: 'quick_reply',
                                    buttonParamsJson: JSON.stringify({
                                        display_text: '🔄 New Code',
                                        id: `sb_new:${phoneNumber}`
                                    })
                                }
                            ]
                        }
                    }
                }
            }
        };

        const generated = b.generateWAMessageFromContent(
            jid,
            b.proto.Message.fromObject(content),
            { userJid: sock.user.id }
        );

        await sock.relayMessage(jid, generated.message, { messageId: generated.key.id });

    } catch (err) {
        if (err.message.startsWith('Timed out')) await SubBotManager.removeSubBot(phoneNumber).catch(() => {});
        await dropStatus();
        await safeSend(sock, jid, { text: `❌ Couldn't create a session: ${err.message}` }, quoted ? { quoted } : undefined);
    }
}

// ─── BUTTON TAP HANDLER ────────────────────────────────────────
const armedSockets = new WeakSet();
const handledTaps = new Set();

function unwrap(message) {
    let c = message;
    for (let i = 0; i < 4 && c; i++) {
        if (c.ephemeralMessage) c = c.ephemeralMessage.message;
        else if (c.viewOnceMessage) c = c.viewOnceMessage.message;
        else if (c.documentWithCaptionMessage) c = c.documentWithCaptionMessage.message;
        else break;
    }
    return c || {};
}

function getButtonId(m) {
    const c = unwrap(m.message);
    const params = c.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
    if (params) {
        try { return JSON.parse(params).id || ''; } catch (e) { return ''; }
    }
    return c.buttonsResponseMessage?.selectedButtonId || c.templateButtonReplyMessage?.selectedId || '';
}

function armButtons(sock) {
    if (armedSockets.has(sock)) return;
    armedSockets.add(sock);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const m of messages || []) {
            try {
                if (!m?.message || m.key.fromMe) continue;
                const id = getButtonId(m);
                const match = /^sb_(del|new):(\d+)$/.exec(id);
                if (!match) continue;

                if (handledTaps.has(m.key.id)) continue;
                handledTaps.add(m.key.id);
                if (handledTaps.size > 200) handledTaps.delete(handledTaps.values().next().value);

                const [, action, phoneNumber] = match;
                const chat = m.key.remoteJid;
                const sender = m.key.participant || m.key.remoteJid;

                const active = SubBotManager.listActive().find(b => b.number === phoneNumber);
                const isRequester = active && digitsOf(active.ownerJid) === digitsOf(sender);

                if (!isRequester && !isPrivileged(sender)) {
                    await safeSend(sock, chat, { text: '❌ Only the person who paired this bot (or a bot owner/sudo) can use these buttons.' }, { quoted: m });
                    continue;
                }

                if (action === 'del') {
                    const removed = await SubBotManager.removeSubBot(phoneNumber);
                    await safeSend(sock, chat, {
                        text: removed ? `✅ Session for \`${phoneNumber}\` deleted.` : `❌ No active session found for \`${phoneNumber}\`.`
                    }, { quoted: m });
                } else if (action === 'new') {
                    if (SubBotManager.isActive(phoneNumber)) {
                        await safeSend(sock, chat, { text: `⚠️ \`${phoneNumber}\` is already connected. Delete the session first if you want to re-pair.` }, { quoted: m });
                        continue;
                    }
                    const ownerJid = active?.ownerJid || sender;
                    await SubBotManager.removeSubBot(phoneNumber).catch(() => {});
                    await startPairing(sock, chat, phoneNumber, ownerJid, m);
                }
            } catch (e) {
                console.error('⚠️ [SUBBOT BUTTON] Handler error:', e.message);
            }
        }
    });
}

// ─── COMMANDS ──────────────────────────────────────────────────
module.exports = [
    // 1. ADDBOT — pair THIS host to someone else's WhatsApp number
    {
        name: 'addbot',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const requesterJid = msg.key.participant || msg.key.remoteJid;

            const phoneNumber = (args || '').replace(/[^0-9]/g, '');
            if (!phoneNumber || phoneNumber.length < 7 || phoneNumber.length > 15) {
                return await sock.sendMessage(jid, {
                    text: `❌ *Usage:* \`${config.prefix}addbot <number with country code>\`\n*Example:* \`${config.prefix}addbot 2347059092107\`\n\nNo spaces, no +, no leading 0 after the country code.`
                }, { quoted: msg });
            }

            armButtons(sock);
            await startPairing(sock, jid, phoneNumber, requesterJid, msg);
        }
    },

    // 2. DELBOT — tear down a sub-bot session
    {
        name: 'delbot',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const requesterJid = msg.key.participant || msg.key.remoteJid;
            let phoneNumber = (args || '').replace(/[^0-9]/g, '');

            if (!phoneNumber) {
                return await sock.sendMessage(jid, { text: `❌ *Usage:* \`${config.prefix}delbot <number>\`\n_Use the number from \`${config.prefix}listbots\` (e.g. \`${config.prefix}delbot 1\`) or the bot's phone number._` }, { quoted: msg });
            }

            // A short number (up to 3 digits) is a position in .listbots, not a phone number.
            if (phoneNumber.length <= 3) {
                const position = parseInt(phoneNumber, 10);
                const all = SubBotManager.listActive();
                if (position < 1 || position > all.length) {
                    return await sock.sendMessage(jid, { text: `❌ There is no bot #${position}. Use \`${config.prefix}listbots\` to see the list.` }, { quoted: msg });
                }
                phoneNumber = all[position - 1].number;
            }

            const active = SubBotManager.listActive().find(b => b.number === phoneNumber);
            const isRequesterOwnerOfBot = active && active.ownerJid === requesterJid;

            if (!isOwner && !isSudo && !isDev && !isRequesterOwnerOfBot) {
                return await sock.sendMessage(jid, { text: "❌ You can only remove a sub-bot you paired yourself (or be a bot owner/sudo)." }, { quoted: msg });
            }

            const removed = await SubBotManager.removeSubBot(phoneNumber);
            await sock.sendMessage(jid, {
                text: removed ? `✅ Sub-bot for \`${phoneNumber}\` removed.` : `❌ No active sub-bot found for \`${phoneNumber}\`.`
            }, { quoted: msg });
        }
    },

    // 3. LISTBOTS — owner/dev only, shows all active sub-bot sessions
    {
        name: 'listbots',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) return;

            const active = SubBotManager.listActive();
            if (active.length === 0) {
                return await sock.sendMessage(jid, { text: "📭 No sub-bot sessions are currently active." }, { quoted: msg });
            }

            let layout = `🤖 *ACTIVE SUB-BOTS (${active.length})*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            active.forEach((b, i) => {
                layout += `${i + 1}. \`${b.number}\` — ${b.status}\n`;
            });
            layout += `\n👉 Remove one with \`${config.prefix}delbot <number>\` (e.g. \`${config.prefix}delbot 1\`)`;

            await sock.sendMessage(jid, { text: layout }, { quoted: msg });
        }
    }
];