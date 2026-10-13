// plugins/testdel.js
// Diagnostic for "the delete request is sent but the group status stays".
//
//   .testdel           reply to the message -> tries delete forms 1-3 one after another
//   .testdel wrapped   experimental form 4 (see below) - only when you ask for it
//
// Before each attempt it posts a short note, so you can see which attempt made the
// message disappear. Owner / dev only, groups only. Safe to delete this file afterwards.
//
// 1  plain revoke with the key exactly as received (what the guard does today)
// 2  same, but the participant converted from a LID to the phone-number JID
// 3  same as 1, but sent with the sender-revoke flag (edit=7) instead of admin-revoke (edit=8)
// 4  the revoke wrapped inside groupStatusMessageV2 (experimental: if WhatsApp doesn't
//    understand it, members may briefly see an "unsupported message" bubble)

const { unwrap } = require('../helpers/TagHelper');
const { getPhoneJid } = require('../stateManager');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function getReplyContext(msg) {
    const raw = unwrap(msg.message);
    if (!raw) return null;
    for (const v of Object.values(raw)) {
        if (v && typeof v === 'object' && v.contextInfo?.stanzaId) return v.contextInfo;
    }
    return null;
}

module.exports = [
    {
        name: 'testdel',
        isPrefixless: false,
        category: 'tools',
        description: 'Diagnostic: tries different delete forms on a replied-to message',
        execute: async (sock, msg, args, ctx) => {
            const jid = msg.key.remoteJid;
            const { isOwner, isDev } = ctx || {};
            if (!(isOwner || isDev) || !jid.endsWith('@g.us')) return;

            const reply = getReplyContext(msg);
            if (!reply) {
                return await sock.sendMessage(jid, { text: "❌ Reply to the message you want to test deleting." }, { quoted: msg });
            }

            const key = { remoteJid: jid, id: reply.stanzaId, fromMe: false, participant: reply.participant };
            const note = (text) => sock.sendMessage(jid, { text });
            const wantsWrapped = /wrapped/i.test(args || '');

            try {
                if (!wantsWrapped) {
                    await note('🧪 Attempt 1: plain revoke (as received)');
                    await sock.sendMessage(jid, { delete: key });
                    await wait(5000);

                    let phone = '';
                    if (key.participant?.endsWith('@lid')) {
                        try { phone = await getPhoneJid(sock, key.participant, jid); } catch (e) {}
                    }
                    if (phone && phone !== key.participant) {
                        await note('🧪 Attempt 2: revoke with phone-number participant');
                        await sock.sendMessage(jid, { delete: { ...key, participant: phone } });
                    } else {
                        await note('🧪 Attempt 2 skipped (no phone JID for this participant)');
                    }
                    await wait(5000);

                    await note('🧪 Attempt 3: revoke with sender-revoke flag (edit=7)');
                    await sock.relayMessage(
                        jid,
                        { protocolMessage: { key, type: 0 } },
                        { additionalAttributes: { edit: '7' } }
                    );
                    await wait(3000);
                    await note('🧪 Done. If the message vanished, note which attempt it was and tell me.');
                } else {
                    await note('🧪 Attempt 4 (experimental): revoke wrapped in groupStatusMessageV2');
                    await sock.relayMessage(
                        jid,
                        { groupStatusMessageV2: { message: { protocolMessage: { key, type: 0 } } } },
                        { additionalAttributes: { edit: '8' } }
                    );
                    await wait(3000);
                    await note('🧪 Done.');
                }
            } catch (err) {
                console.error('[TESTDEL] error:', err?.message || err);
                await sock.sendMessage(jid, { text: `❌ Test stopped: ${err?.message || err}` }, { quoted: msg });
            }
        }
    }
];
