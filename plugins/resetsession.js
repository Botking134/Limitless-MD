// plugins/resetsession.js
//   .resetsession <number>     (or reply to / @mention the person, or run it in their private chat)
//
// Deletes the saved encryption (Signal) session with ONE contact, then asks WhatsApp for a fresh
// one. Use it when that person can't see your reactions / messages and the console shows
// "Bad MAC" or "closed session" errors. Your login is not touched, no re-pairing needed.
//
// It fixes the contact on the MAIN BOT and on EVERY SUB-BOT in one go (each bot keeps its own
// sessions, so each one is reset on its own), and reports one line per bot.
// Owner, sudo and developers only.

const config = require('../config');
const { normalizeToJid } = require('../stateManager');

const digits = (s) => String(s || '').replace(/\D/g, '');
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);

// the main bot's socket plus every sub-bot socket that exists right now (no duplicates)
function allBots(currentSock) {
    const bots = [];
    const seen = new Set();
    const add = (label, s) => { if (s && !seen.has(s)) { seen.add(s); bots.push({ label, sock: s }); } };

    let main = null;
    try { main = require('../pair').getActiveSocket(); } catch (e) { /* not available */ }
    if (!main && currentSock && (!currentSock.__botId || currentSock.__botId === 'main')) main = currentSock;
    add('Main bot', main);

    try {
        for (const [number, entry] of (global.subBotSockets?.entries() || [])) {
            if (entry?.sock && entry.status !== 'pairing') add(`Sub-bot ${number}`, entry.sock);
        }
    } catch (e) { /* best effort */ }

    add('This bot', currentSock);   // safety net: the bot that received the command is always included
    return bots;
}

// reset the sessions with `jids` on ONE socket; returns what worked
async function resetOn(sock, jids) {
    const done = [];

    // 1) the library's own session delete (when this version has it)
    try {
        if (typeof sock.signalRepository?.deleteSession === 'function') {
            await withTimeout(sock.signalRepository.deleteSession(jids), 15000);
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
        await withTimeout(sock.authState.keys.set({ session: wipe }), 15000);
        done.push('keys');
    } catch (e) { console.error('⚠️ [RESETSESSION] key wipe failed:', e?.message || e); }

    // 3) fetch a fresh session right away
    try {
        if (typeof sock.assertSessions === 'function') {
            await withTimeout(sock.assertSessions(jids, true), 20000);
            done.push('fresh session');
        }
    } catch (e) { console.error('⚠️ [RESETSESSION] assertSessions failed:', e?.message || e); }

    return done;
}

module.exports = [
    {
        name: 'resetsession',
        isPrefixless: false,
        category: 'tools',
        description: 'Reset the encryption session with one contact on the main bot AND all sub-bots. Use: resetsession <number> (or reply / @mention)',
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

            // every bot, all at the same time
            const bots = allBots(sock);
            const results = await Promise.all(bots.map(async (b) => {
                try { return { ...b, done: await resetOn(b.sock, jids) }; }
                catch (e) { return { ...b, done: [], error: e?.message || String(e) }; }
            }));

            const lines = results.map(r => `${r.done.length ? '✅' : '❌'} ${r.label}${r.done.length ? '' : ' — failed'}`);
            const okCount = results.filter(r => r.done.length).length;
            console.log(`🔐 [RESETSESSION] ${jids.join(', ')} -> ` + results.map(r => `${r.label}: ${r.done.join('+') || 'nothing worked'}`).join(' | '));
            if (!okCount) return reply('❌ Could not reset that session on any bot, check the console.');
            return reply(
                `🔐 *Session reset for ${user}*\n\n${lines.join('\n')}\n\n` +
                `_Post a status or send them a message, then check if the reaction shows now._`
            );
        }
    }
];
