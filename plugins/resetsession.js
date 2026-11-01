// plugins/resetsession.js
//   .resetsession <number>     (or reply to / @mention the person, or run it in their private chat)
//
// Deletes the saved encryption (Signal) session with ONE contact, then asks WhatsApp for a fresh
// one. Use it when that person can't see your reactions / messages and the console shows
// "Bad MAC" or "closed session" errors. Your login is not touched, no re-pairing needed.
// Owner, sudo and developers only.

const config = require('../config');
const { normalizeToJid } = require('../stateManager');

const digits = (s) => String(s || '').replace(/\D/g, '');

module.exports = [
    {
        name: 'resetsession',
        isPrefixless: false,
        category: 'tools',
        description: 'Reset the encryption session with one contact. Use: resetsession <number> (or reply / @mention)',
        usage: 'resetsession <number>',
        execute: async (sock, msg, args, { isOwner, isSudo, isDev } = {}) => {
            const jid = msg.key.remoteJid;
            const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });
            if (!(isOwner || isSudo || isDev)) return;

            // who: a number in the command, else the replied-to / mentioned person, else this private chat
            const raw = Array.isArray(args) ? args.join(' ') : String(args || '');
            const ctxInfo = msg.message?.extendedTextMessage?.contextInfo || {};
            let target = digits(raw) ? (raw.includes('@lid') ? digits(raw) + '@lid' : digits(raw) + '@s.whatsapp.net')
                : (ctxInfo.mentionedJid?.[0] || ctxInfo.participant || (jid.endsWith('@g.us') ? '' : jid));
            if (!target) return reply('❌ Give a number, reply to the person, or run this in their private chat.\nExample: `' + config.prefix + 'resetsession 2348012345678`');
            target = normalizeToJid(target);

            // every identity this person can have: phone jid and lid
            const ids = new Set([target]);
            const user = target.split('@')[0];
            try {
                if (target.endsWith('@lid')) {
                    for (const [lid, pn] of Object.entries(global.lidCache || {})) if (lid.split('@')[0] === user && pn) ids.add(normalizeToJid(pn));
                } else {
                    for (const [lid, pn] of Object.entries(global.lidCache || {})) if (pn && String(pn).split('@')[0] === user) ids.add(lid.includes('@') ? lid : lid + '@lid');
                }
            } catch (e) { /* best effort */ }

            const jids = [...ids];
            const done = [];

            // 1) the library's own session delete (when this version has it)
            try {
                if (typeof sock.signalRepository?.deleteSession === 'function') {
                    await sock.signalRepository.deleteSession(jids);
                    done.push('deleteSession');
                }
            } catch (e) { console.error('⚠️ [RESETSESSION] deleteSession failed:', e?.message || e); }

            // 2) clear the stored session keys directly (device 0, phone and lid address forms)
            try {
                const wipe = {};
                for (const j of jids) {
                    const u = j.split('@')[0];
                    wipe[j.endsWith('@lid') ? `${u}_1.0` : `${u}.0`] = null;
                }
                await sock.authState.keys.set({ session: wipe });
                done.push('keys');
            } catch (e) { console.error('⚠️ [RESETSESSION] key wipe failed:', e?.message || e); }

            // 3) fetch a fresh session right away
            try {
                if (typeof sock.assertSessions === 'function') {
                    await sock.assertSessions(jids, true);
                    done.push('fresh session');
                }
            } catch (e) { console.error('⚠️ [RESETSESSION] assertSessions failed:', e?.message || e); }

            console.log(`🔐 [RESETSESSION] ${jids.join(', ')} -> ${done.join(', ') || 'nothing worked'}`);
            if (!done.length) return reply('❌ Could not reset that session, check the console.');
            return reply(`✅ Session reset for *${user}*.\nPost a status or send them a message, then check if the reaction shows now.`);
        }
    }
];
