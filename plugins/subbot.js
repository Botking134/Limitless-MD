// plugins/subbot.js
const config = require('../config');
const SubBotManager = require('../helpers/SubBotManager');

function withTimeout(promise, ms, message) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
    ]);
}

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

            const statusMsg = await sock.sendMessage(jid, {
                text: `⏳ Spinning up a session for \`${phoneNumber}\`... this can take up to 20 seconds.`
            }, { quoted: msg });

            try {
                const codePromise = new Promise((resolve, reject) => {
                    SubBotManager.createSubBot(phoneNumber, requesterJid, (code, qrBuffer) => {
                        resolve({ code, qrBuffer });
                    }).catch(reject);
                });

                const { code, qrBuffer } = await withTimeout(
                    codePromise,
                    25000,
                    'Timed out waiting for WhatsApp to issue a pairing code. Try again in a minute.'
                );

                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) {}

                const instructions =
                    `🔗 *BOT PAIRING — ${phoneNumber}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `1️⃣ Open *WhatsApp* on the phone for this number.\n` +
                    `2️⃣ Go to *Settings → Linked Devices → Link a Device*.\n` +
                    `3️⃣ Tap *"Link with phone number instead"*.\n` +
                    `4️⃣ Enter the *8-character code* sent in the next message.\n\n` +
                    `⏱️ The code expires in a couple of minutes — enter it quickly.`;

                // Instructions go out first, as a caption on the QR image...
                if (qrBuffer) {
                    await sock.sendMessage(jid, { image: qrBuffer, caption: instructions });
                } else {
                    await sock.sendMessage(jid, { text: instructions });
                }

                // ...then the pairing code follows as its own separate message.
                await sock.sendMessage(jid, { text: ${code} });

            } catch (err) {
                try { await sock.sendMessage(jid, { delete: statusMsg.key }); } catch (e) {}
                await sock.sendMessage(jid, { text: `❌ Couldn't create a session: ${err.message}` }, { quoted: msg });
            }
        }
    },

    // 2. DELBOT — tear down a sub-bot session
    {
        name: 'delbot',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const requesterJid = msg.key.participant || msg.key.remoteJid;
            const phoneNumber = (args || '').replace(/[^0-9]/g, '');

            if (!phoneNumber) {
                return await sock.sendMessage(jid, { text: `❌ *Usage:* \`${config.prefix}delbot <number>\`` }, { quoted: msg });
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

            await sock.sendMessage(jid, { text: layout }, { quoted: msg });
        }
    }
];
