// plugins/dominance.js
//
//   .dominance               -> shows the current setting with buttons
//   .dominance on  [time]    -> every message from a NON-ADMIN is deleted, silently
//   .dominance all [time]    -> every message from EVERYONE is deleted, admins too
//   .dominance off           -> back to normal
//
//   [time] is optional. Examples: 30s, 2m, 1h, 1h30m, 1d (a bare number means minutes).
//   Min 10s, max 7d. When the time runs out, dominance switches itself off.
//   Without [time] it stays on until switched off.
//
// Like silence, but for a whole group at once. Nothing is announced when a message is deleted.
//   - Developers are never touched, in any mode.
//   - In "on" mode group admins are left alone. In "all" mode nobody is, except developers.
//   - The bot has to be an admin of the group to delete other people's messages.
//   - The command itself still works for the owner and sudos, even in "all" mode, so the switch is
//     never locked away from you.
//   - "on" and "off" can be used by group admins, owners and sudos. "all" only by owners and sudos.
// The setting (and its timer) is saved per group and survives restarts.

const axios = require('axios');
const config = require('../config');
const { saveState, normalizeToJid } = require('../stateManager');

config.dominance = (config.dominance && typeof config.dominance === 'object') ? config.dominance : {};
config.dominanceUntil = (config.dominanceUntil && typeof config.dominanceUntil === 'object') ? config.dominanceUntil : {};

// ─── THE GIFS ────────────────────────────────────────────────────
// A Tenor link works here; a direct .mp4 or .gif link works too.
const ON_GIF = 'https://tenor.com/bMnXA.gif';
const ALL_GIF = 'https://tenor.com/bqado.gif';

const ON_TEXT = '🌌 *DOMINANCE — ON*\n\n_A heavy spiritual pressure fills the room..._\n_Those with weak spiritual pressure are erased. Only admins can still stand._';
const ALL_TEXT = '🌑 *DOMINANCE — ALL*\n\n_The pressure becomes absolute._\n_No one can stand beneath it. Every voice is erased._';
const OFF_TEXT = '🕊️ *DOMINANCE — OFF*\n\n_The pressure lifts. The weak may breathe again._';
const EXPIRED_TEXT = '🕊️ *DOMINANCE — OFF*\n\n_The pressure fades with time. The weak may breathe again._';

const MIN_MS = 10 * 1000;
const MAX_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TIMEOUT = 2 ** 31 - 1;

// ─── HELPERS ─────────────────────────────────────────────────────
function cleanJid(jid) {
    if (!jid) return '';
    const raw = normalizeToJid(jid);
    return raw.split('@')[0].split(':')[0] + '@' + raw.split('@')[1];
}

// "2m" / "30s" / "1h30m" / "1d" / "5" (minutes) -> milliseconds, or null if it is not a valid time
function parseDuration(str) {
    if (!str) return null;
    const s = String(str).trim().toLowerCase().replace(/^<|>$/g, '');
    if (/^\d+$/.test(s)) return parseInt(s, 10) * 60 * 1000;
    if (!/^(\d+[smhd])+$/.test(s)) return null;
    const unit = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
    let total = 0;
    for (const [, n, u] of s.matchAll(/(\d+)([smhd])/g)) total += parseInt(n, 10) * unit[u];
    return total;
}

function formatMs(ms) {
    let s = Math.max(1, Math.round(ms / 1000));
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60); s %= 60;
    const out = [];
    if (d) out.push(d + 'd');
    if (h) out.push(h + 'h');
    if (m) out.push(m + 'm');
    if (s && !d && !h) out.push(s + 's');
    return out.join(' ') || '0s';
}

// ─── THE TIMER ───────────────────────────────────────────────────
const timers = {};   // group -> setTimeout handle

function clearTimer(jid) {
    if (timers[jid]) { clearTimeout(timers[jid]); delete timers[jid]; }
    delete config.dominanceUntil[jid];
}

async function expire(sock, jid) {
    if (timers[jid]) { clearTimeout(timers[jid]); delete timers[jid]; }
    delete config.dominance[jid];
    delete config.dominanceUntil[jid];
    saveState();
    try { await sock.sendMessage(jid, { text: EXPIRED_TEXT }); } catch (e) { /* best effort */ }
}

function scheduleExpiry(sock, jid) {
    if (timers[jid]) { clearTimeout(timers[jid]); delete timers[jid]; }
    const until = config.dominanceUntil[jid];
    if (!until) return;
    const left = until - Date.now();
    if (left <= 0) { expire(sock, jid); return; }
    timers[jid] = setTimeout(() => {
        delete timers[jid];
        if (Date.now() >= (config.dominanceUntil[jid] || 0)) expire(sock, jid);
        else scheduleExpiry(sock, jid);   // the delay was capped, keep waiting
    }, Math.min(left, MAX_TIMEOUT));
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

    // timer: expired while the bot was off or the timeout was lost -> switch off and let this message through
    const until = config.dominanceUntil?.[jid];
    if (until) {
        if (Date.now() >= until) { await expire(sock, jid); return false; }
        if (!timers[jid]) scheduleExpiry(sock, jid);   // after a restart the timer has to be set again
    }

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
        description: 'Delete every message from non-admins (on) or from everyone but developers (all). Optional timer. Use: dominance on | all | off [2m]',
        usage: 'dominance on | all | off [time, e.g. 2m]',
        category: 'group',
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin } = {}) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });
            const privileged = !!(isDev || isOwner || isSudo);
            if (!privileged && !isAdmin) return reply('❌ Only admins can command the pressure here.');

            const raw = Array.isArray(args) ? args.join(' ') : (args || '').toString();
            const parts = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
            const action = parts[0] || '';
            const timeArg = parts[1];
            const current = config.dominance[jid] || 'off';

            if (!action) {
                const until = config.dominanceUntil[jid];
                const left = (current !== 'off' && until) ? `\n⏳ Fades in *${formatMs(until - Date.now())}*` : '';
                const prompt = `🌌 *DOMINANCE* — pressure: \`${current}\`${left}\n\n• *on* — the weak are erased\n• *all* — everyone is crushed\n• *off* — the pressure lifts\n\n_Add a time and it fades on its own, e.g._ \`${config.prefix}dominance on 2m\``;
                const buttons = [
                    { buttonId: `${config.prefix}dominance on`, buttonText: { displayText: 'On' }, type: 1 },
                    { buttonId: `${config.prefix}dominance all`, buttonText: { displayText: 'All' }, type: 1 },
                    { buttonId: `${config.prefix}dominance off`, buttonText: { displayText: 'Off' }, type: 1 }
                ];
                try { return await sock.sendMessage(jid, { text: prompt, buttons, headerType: 1 }, { quoted: msg }); }
                catch (e) { return reply(prompt); }
            }

            if (!['on', 'all', 'off'].includes(action)) return reply('❌ Use: `dominance on`, `dominance all` or `dominance off`. Add a time if you like, e.g. `dominance on 2m`.');
            if (action === 'all' && !privileged) return reply('❌ Only the owner or a sudo can unleash `dominance all`.');

            if (action === 'off') {
                clearTimer(jid);
                delete config.dominance[jid];
                saveState();
                return reply(OFF_TEXT);
            }

            // optional timer
            let durationMs = null;
            if (timeArg) {
                durationMs = parseDuration(timeArg);
                if (durationMs === null) return reply('❌ Invalid time. Examples: `30s`, `2m`, `1h`, `1h30m`, `1d`.');
                if (durationMs < MIN_MS) return reply('❌ The minimum time is 10 seconds.');
                if (durationMs > MAX_MS) return reply('❌ The maximum time is 7 days.');
            }

            clearTimer(jid);
            config.dominance[jid] = action;
            if (durationMs) {
                config.dominanceUntil[jid] = Date.now() + durationMs;
                scheduleExpiry(sock, jid);
            }
            saveState();

            const timeNote = durationMs ? `\n\n⏳ _The pressure holds for ${formatMs(durationMs)}, then fades._` : '';
            const note = (await botIsAdmin(sock, jid)) === false
                ? '\n\n⚠️ _I am not an admin here, so the pressure has no power until I am promoted._'
                : '';
            return sendGif(sock, jid, msg, action === 'all' ? ALL_GIF : ON_GIF, (action === 'all' ? ALL_TEXT : ON_TEXT) + timeNote + note);
        }
    }
];

commands.handleDominance = handleDominance;
module.exports = commands;
