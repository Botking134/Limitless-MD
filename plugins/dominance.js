// plugins/dominance.js
//
//   .dominance          -> shows the current setting with buttons
//   .dominance on       -> every message from a NON-ADMIN is deleted, silently
//   .dominance all      -> every message from EVERYONE is deleted, admins too
//   .dominance off      -> back to normal
//
// Like silence, but for a whole group at once. Nothing is announced when a message is deleted.
//   - Developers are never touched, in any mode.
//   - In "on" mode group admins are left alone. In "all" mode nobody is, except developers.
//   - The bot has to be an admin of the group to delete other people's messages.
//   - The command itself still works for the owner and sudos, even in "all" mode, so the switch is
//     never locked away from you.
//   - "on" and "off" can be used by group admins, owners and sudos. "all" only by owners and sudos.
// The setting is saved per group and survives restarts.

const axios = require('axios');
const config = require('../config');
const { saveState, normalizeToJid } = require('../stateManager');

config.dominance = (config.dominance && typeof config.dominance === 'object') ? config.dominance : {};

// ─── THE GIFS ────────────────────────────────────────────────────
// A Tenor link works here; a direct .mp4 or .gif link works too.
const ON_GIF = 'https://tenor.com/bMnXA.gif';
const ALL_GIF = 'https://tenor.com/bqado.gif';

const ON_TEXT =
    '🌌 *DOMINANCE — ON*\n\n' +
    '_Spiritual pressure fills the room._\n' +
    'Only admins may speak here. Everyone else\'s messages are deleted without a word.';
const ALL_TEXT =
    '🌑 *DOMINANCE — ALL*\n\n' +
    '_The pressure crushes everyone._\n' +
    'No one may speak, admins included. Only the developers are untouched.';
const OFF_TEXT = '🕊️ *DOMINANCE — OFF*\nThe pressure lifts. Everyone may speak again.';

// ─── HELPERS ─────────────────────────────────────────────────────
function cleanJid(jid) {
    if (!jid) return '';
    const raw = normalizeToJid(jid);
    return raw.split('@')[0].split(':')[0] + '@' + raw.split('@')[1];
}

const gifCache = new Map();   // link -> mp4 buffer

// Turns the link into a gif-playback video buffer. If the link is a Tenor page instead of a file,
// the real media link is pulled out of the page.
async function loadGif(url) {
    if (gifCache.has(url)) return gifCache.get(url);
    const MenuDomains = require('../helpers/MenuDomains');
    let video = null;
    try {
        video = await MenuDomains.getVideo(url);
    } catch (e) {
        try {
            const res = await axios.get(url, { responseType: 'text', timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const html = String(res.data || '');
            const found = html.match(/https:\\?\/\\?\/media[0-9]*\.tenor\.com[^"'\s<>]+?\.(?:mp4|gif)/i);
            if (found) video = await MenuDomains.getVideo(found[0].replace(/\\u002F|\\\//g, '/'));
        } catch (e2) {
            console.error('❌ [DOMINANCE] could not load the gif:', e2.message || e2);
        }
    }
    if (video) gifCache.set(url, video);
    return video;
}

async function sendGif(sock, jid, msg, url, caption) {
    let video = null;
    try { video = await loadGif(url); } catch (e) { /* text only */ }
    if (video) {
        try {
            return await sock.sendMessage(jid, { video, gifPlayback: true, mimetype: 'video/mp4', caption }, { quoted: msg });
        } catch (e) {
            console.error('❌ [DOMINANCE] gif send failed, using text:', e.message || e);
        }
    }
    return sock.sendMessage(jid, { text: caption }, { quoted: msg });
}

async function botIsAdmin(sock, jid) {
    try {
        const meta = await sock.groupMetadata(jid);
        const botJid = sock.user?.id ? cleanJid(sock.user.id) : '';
        const botLid = sock.user?.lid ? cleanJid(sock.user.lid) : (config.botLid || '');
        const me = (meta.participants || []).find(p => {
            const id = cleanJid(p.id), lid = p.lid ? cleanJid(p.lid) : '';
            return (botJid && (id === botJid || lid === botJid)) || (botLid && (id === botLid || lid === botLid));
        });
        return me?.admin === 'admin' || me?.admin === 'superadmin';
    } catch (e) { return null; }
}

// is this sender one of our own bots (main bot or a sub-bot)? Their messages are never deleted.
function isOurBot(senderJid) {
    const s = cleanJid(senderJid);
    if (!s) return false;
    if (s === cleanJid(config.botJid) || s === cleanJid(config.botLid)) return true;
    try {
        for (const entry of (global.subBotSockets?.values() || [])) {
            const u = entry?.sock?.user || entry?.socket?.user;
            if (u && (cleanJid(u.id) === s || (u.lid && cleanJid(u.lid) === s))) return true;
        }
    } catch (e) { /* best effort */ }
    return false;
}

// ─── THE INTERCEPTOR (called by helpers/Infinity.js for every group message) ───
const deleteFailedUntil = {};      // group -> time; stops hammering when the bot is not an admin

// Returns true when the message was deleted (the caller then drops it).
async function handleDominance(sock, msg, ctx) {
    const { jid, isDev, isOwner, isSudo, isAdmin, senderJid, body, prefix } = ctx;
    const mode = config.dominance?.[jid];
    if (mode !== 'on' && mode !== 'all') return false;
    if (isDev) return false;

    // only real messages: not reactions, edits, deletions, key exchanges or group notices
    const m = msg.message;
    if (!m || msg.messageStubType) return false;
    if (m.protocolMessage || m.reactionMessage || m.senderKeyDistributionMessage || m.pollUpdateMessage || m.keepInChatMessage) return false;

    if (mode === 'on' && isAdmin) return false;
    if (isOurBot(senderJid)) return false;

    // the owner and sudos can always reach the dominance command, or "all" could never be switched off
    if ((isOwner || isSudo) && typeof body === 'string') {
        const p = String(prefix || config.prefix || '.');
        if (body.trim().toLowerCase().startsWith(p + 'dominance')) return false;
    }

    if (deleteFailedUntil[jid] && Date.now() < deleteFailedUntil[jid]) return true;   // cannot delete here right now

    try {
        await sock.sendMessage(jid, {
            delete: {
                remoteJid: jid,
                id: msg.key.id,
                fromMe: !!msg.key.fromMe,
                participant: msg.key.participant || msg.participant || undefined
            }
        });
        // keep the antidelete log quiet: it only reacts to messages still in the store
        if (global.messageStore) delete global.messageStore[msg.key.id];
    } catch (e) {
        deleteFailedUntil[jid] = Date.now() + 60 * 1000;
        console.error('❌ [DOMINANCE] delete failed (is the bot an admin there?):', e?.message || e);
    }
    return true;
}

// ─── THE COMMAND ─────────────────────────────────────────────────
const commands = [
    {
        name: 'dominance',
        isPrefixless: false,
        description: 'Delete every message from non-admins (on) or from everyone but developers (all). Use: dominance on | all | off',
        usage: 'dominance on | all | off',
        category: 'group',
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin } = {}) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });
            const privileged = !!(isDev || isOwner || isSudo);
            if (!privileged && !isAdmin) return reply('❌ You must be an administrator in this group to run this command!');

            const action = (args || '').toString().trim().toLowerCase();
            const current = config.dominance[jid] || 'off';

            if (!action) {
                const prompt = `🌌 *Dominance:* (Current: \`${current}\`)\n\n• *on* — non-admins are deleted\n• *all* — everyone but developers is deleted\n• *off* — normal`;
                const buttons = [
                    { buttonId: `${config.prefix}dominance on`, buttonText: { displayText: 'On' }, type: 1 },
                    { buttonId: `${config.prefix}dominance all`, buttonText: { displayText: 'All' }, type: 1 },
                    { buttonId: `${config.prefix}dominance off`, buttonText: { displayText: 'Off' }, type: 1 }
                ];
                try { return await sock.sendMessage(jid, { text: prompt, buttons, headerType: 1 }, { quoted: msg }); }
                catch (e) { return reply(prompt); }
            }

            if (!['on', 'all', 'off'].includes(action)) return reply('❌ Use: `dominance on`, `dominance all` or `dominance off`.');
            if (action === 'all' && !privileged) return reply('❌ Only the owner or a sudo can use `dominance all`.');

            if (action === 'off') {
                delete config.dominance[jid];
                saveState();
                return reply(OFF_TEXT);
            }

            config.dominance[jid] = action;
            saveState();
            const note = (await botIsAdmin(sock, jid)) === false
                ? '\n\n⚠️ _I am not an admin in this group, so I cannot delete anything until I am promoted._'
                : '';
            return sendGif(sock, jid, msg, action === 'all' ? ALL_GIF : ON_GIF, (action === 'all' ? ALL_TEXT : ON_TEXT) + note);
        }
    }
];

commands.handleDominance = handleDominance;
module.exports = commands;
