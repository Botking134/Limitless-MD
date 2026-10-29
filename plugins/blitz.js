// plugins/Blitz.js   (TEMPORARY COMMAND - delete this file to remove it)
//
//   .blitz                 -> 20 tagged messages
//   .blitz 50              -> 50 tagged messages
//   .blitz 50 some text    -> 50 tagged messages with that text
//   .blitz some text       -> 20 tagged messages with that text
//   (or reply to a message: the replied text is what gets sent)
//   .blitz stop            -> stops a blitz that is running in this group
//
// Works exactly like spamtag (same permissions, same text, tags every member), only faster:
// one message every 0.5 seconds instead of one per second. Default 20, maximum 100.
// Like spamtag it says nothing when it finishes. It only speaks if it is stopped or WhatsApp starts refusing.

const config = require('../config');
const { normalizeToJid } = require('../stateManager');
const { getRawMessage } = require('../helpers/Message');

global.blitzRuns = global.blitzRuns || {};

// ─── SETTINGS ────────────────────────────────────────────────────
const DEFAULT_COUNT = 20;
const MAX_COUNT = 100;
const INTERVAL_MS = 500;        // one message every 0.5 seconds
const MAX_FAILS = 3;            // this many failed sends in a row ends the blitz
const DEFAULT_TEXT = '🔔 *Attention Everyone!*';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function cleanJid(jid) {
    if (!jid) return '';
    const raw = normalizeToJid(jid);
    return raw.split('@')[0].split(':')[0] + '@' + raw.split('@')[1];
}

// Same rules as spamtag: devs always; otherwise owner or sudo who is a group admin, with the bot an admin too.
async function checkAllowed(sock, msg, jid, groupMetadata, { isOwner, isSudo, isDev }) {
    if (isDev) return true;
    if (!(isOwner || isSudo)) return false;

    const participants = groupMetadata.participants;
    const botJid = sock.user?.id ? cleanJid(sock.user.id) : '';
    const botLid = sock.user?.lid ? cleanJid(sock.user.lid) : (config.botLid || '');
    const same = (p, id) => {
        const pId = cleanJid(p.id);
        const pLid = p.lid ? cleanJid(p.lid) : '';
        return id && (pId === id || pLid === id);
    };
    const bot = participants.find(p => same(p, botJid) || same(p, botLid));
    if (!(bot?.admin === 'admin' || bot?.admin === 'superadmin')) {
        await sock.sendMessage(jid, { text: '❌ I must be an administrator in this group first!' }, { quoted: msg });
        return false;
    }
    const senderJid = cleanJid(msg.key.participant || msg.key.remoteJid || '');
    const sender = participants.find(p => same(p, senderJid));
    if (!(sender?.admin === 'admin' || sender?.admin === 'superadmin')) {
        await sock.sendMessage(jid, { text: '❌ You must be an administrator in this group to run this command!' }, { quoted: msg });
        return false;
    }
    return true;
}

module.exports = [
    {
        name: 'blitz',
        isPrefixless: false,
        description: 'Temporary: faster spamtag, one tagged message every 0.5s. Use: blitz [count] [text] (default 20, max 100) | blitz stop',
        usage: 'blitz [count] [text] | blitz stop',
        execute: async (sock, msg, args, perms = {}) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const { isOwner, isSudo, isDev } = perms;
            if (!(isOwner || isSudo || isDev)) return;       // nobody else gets any reply, like spamtag

            const raw = (args || '').toString().trim();
            const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

            // ── stop ──
            if (raw.toLowerCase() === 'stop') {
                const run = global.blitzRuns[jid];
                if (!run) return reply('ℹ️ There is no blitz running in this group.');
                run.stop = true;
                return;                                       // the running blitz reports that it stopped
            }

            if (global.blitzRuns[jid]) {
                return reply(`⚠️ A blitz is already running here. Use \`${config.prefix}blitz stop\` to end it.`);
            }

            let groupMetadata;
            try { groupMetadata = await sock.groupMetadata(jid); } catch (e) { return reply('❌ Could not read the group members.'); }
            if (!(await checkAllowed(sock, msg, jid, groupMetadata, { isOwner, isSudo, isDev }))) return;

            // ── count and text ──
            let count = DEFAULT_COUNT;
            let textToSend = raw;
            const m = raw.match(/^(\d+)(?:\s+([\s\S]*))?$/);
            if (m) {
                count = parseInt(m[1], 10);
                textToSend = (m[2] || '').trim();
                if (count < 1) return reply('❌ Please provide a valid number of messages (1-' + MAX_COUNT + ').');
            }
            let note = '';
            if (count > MAX_COUNT) { count = MAX_COUNT; note = `ℹ️ The maximum is ${MAX_COUNT}, so I will send ${MAX_COUNT}.`; }

            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!textToSend && quoted) {
                const rawContent = getRawMessage(quoted);
                textToSend = rawContent?.conversation || rawContent?.extendedTextMessage?.text || rawContent?.imageMessage?.caption || '';
            }
            if (!textToSend) textToSend = DEFAULT_TEXT;

            const participants = groupMetadata.participants.map(p => p.id);
            if (note) await reply(note);

            // ── the blitz ──
            const run = { stop: false };
            global.blitzRuns[jid] = run;
            let sent = 0, fails = 0, failed = false;
            try {
                for (let i = 0; i < count; i++) {
                    if (run.stop) break;
                    const started = Date.now();
                    try {
                        await sock.sendMessage(jid, { text: textToSend, mentions: participants });
                        sent++; fails = 0;
                    } catch (e) {
                        fails++;
                        if (fails >= MAX_FAILS) { failed = true; break; }
                        await sleep(1500);                    // a short breather, then carry on
                        continue;
                    }
                    // one send every INTERVAL_MS: wait only for what is left of the interval (never bursts to catch up)
                    const left = INTERVAL_MS - (Date.now() - started);
                    if (left > 0 && i < count - 1) await sleep(left);
                }
            } finally {
                delete global.blitzRuns[jid];
            }

            if (run.stop) {
                await sock.sendMessage(jid, { text: `🛑 Blitz stopped after ${sent}/${count} messages.` }).catch(() => {});
            } else if (failed) {
                await sock.sendMessage(jid, { text: `⚠️ Blitz stopped after ${sent}/${count} messages: WhatsApp kept refusing the messages (probably a rate limit). Wait a few minutes before trying again.` }).catch(() => {});
            }
        }
    }
];
