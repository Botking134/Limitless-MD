// helpers/MenuDomains.js
// Media + "brain damage" cooldown for the three menus.
//   menu  / list   -> Infinite Void     (Gojo)
//   menu2 / list2  -> Malevolent Shrine (Sukuna)
//   menu3 / list3  -> category picker
//
// Each person may use each menu 5 times in an hour. The next try is blocked ("brain
// damage") until one hour after their first use in that window, with a live countdown.
// Only a dev / primary owner can heal early, with: rct menu | rct menu2 | rct menu3
// (also: reverse-ct ...), optionally on a tagged / replied-to person.

const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { normalizeToJid } = require('../stateManager');

// ─── CONFIG ──────────────────────────────────────────────────────
const MAX_USES = 5;                       // uses allowed per window, per menu
const WINDOW_MS = 60 * 60 * 1000;         // 1 hour
const TICK_MS = 15 * 1000;                // how often the live countdown message updates
const LIVE_MAX_MS = 14 * 60 * 1000;       // WhatsApp only lets a message be edited for ~15 minutes
const TIMEZONE = 'Africa/Lagos';

const DOMAINS = {
    menu: {
        key: 'menu', name: 'Infinite Void',
        gifs: ['https://files.catbox.moe/y3uv0b.mp4', 'https://files.catbox.moe/7aru8f.mp4'],
        audio: 'https://files.catbox.moe/ab9x6e.mp4'
    },
    menu2: {
        key: 'menu2', name: 'Malevolent Shrine',
        gifs: ['https://files.catbox.moe/mzodiu.mp4', 'https://files.catbox.moe/g6zrky.mp4'],
        audio: 'https://files.catbox.moe/uldbxq.mp4'
    },
    menu3: {
        key: 'menu3', name: 'Domain Expansion',
        gifs: ['https://files.catbox.moe/g6zrky.mp4'],
        audio: null
    }
};

const RCT_GIFS = [
    'https://files.catbox.moe/dvct1z.gif',
    'https://files.catbox.moe/80mibd.gif',
    'https://files.catbox.moe/2230b3.gif',
    'https://files.catbox.moe/9tfrco.gif'
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ─── MEDIA (downloaded once, then kept in memory) ────────────────
const cache = new Map();

async function download(url) {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    return Buffer.from(res.data);
}

function run(bin, args) {
    return new Promise((resolve, reject) => {
        execFile(bin, args, { timeout: 60000 }, (err, _o, stderr) => err ? reject(new Error((stderr || err.message).toString().slice(-300))) : resolve());
    });
}

const tmp = (ext) => path.join(os.tmpdir(), `menu_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);

async function viaFfmpeg(buffer, inExt, outExt, args) {
    const inFile = tmp(inExt), outFile = tmp(outExt);
    try {
        fs.writeFileSync(inFile, buffer);
        await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', inFile, ...args, outFile]);
        return fs.readFileSync(outFile);
    } finally {
        for (const f of [inFile, outFile]) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
    }
}

// Video buffer for a gif-style message. .mp4 is used as is; real .gif files are
// converted to mp4 because WhatsApp only plays gifs as short mp4 videos.
async function getVideo(url) {
    const hit = cache.get('v:' + url);
    if (hit) return hit;
    let buf = await download(url);
    if (/\.gif(\?|$)/i.test(url)) {
        buf = await viaFfmpeg(buf, '.gif', '.mp4', [
            '-movflags', 'faststart', '-pix_fmt', 'yuv420p',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-an'
        ]);
    }
    cache.set('v:' + url, buf);
    return buf;
}

// Audio buffer (mp3). The audio links are .mp4 files, so the sound is extracted first.
async function getAudio(url) {
    const hit = cache.get('a:' + url);
    if (hit) return hit;
    const src = await download(url);
    const mp3 = await viaFfmpeg(src, '.mp4', '.mp3', ['-vn', '-acodec', 'libmp3lame', '-q:a', '4']);
    cache.set('a:' + url, mp3);
    return mp3;
}

async function sendDomainGif(sock, jid, msg, url, caption) {
    try {
        const video = await getVideo(url);
        return await sock.sendMessage(jid, { video, gifPlayback: true, mimetype: 'video/mp4', caption }, { quoted: msg });
    } catch (e) {
        console.error('❌ [MENU] gif failed, sending text only:', e.message);
        return await sock.sendMessage(jid, { text: caption }, { quoted: msg });
    }
}

async function sendDomainAudio(sock, jid, url) {
    if (!url) return;
    try {
        const audio = await getAudio(url);
        await sock.sendMessage(jid, { audio, mimetype: 'audio/mpeg', ptt: false });
    } catch (e) {
        console.error('❌ [MENU] audio conversion failed, trying the link directly:', e.message);
        try { await sock.sendMessage(jid, { audio: { url }, mimetype: 'audio/mp4', ptt: false }); }
        catch (e2) { console.error('❌ [MENU] audio failed:', e2.message); }
    }
}

// ─── COOLDOWN ────────────────────────────────────────────────────
global.menuUses = global.menuUses || {};    // `${menuKey}|${user}` -> { start, count }
global.menuLive = global.menuLive || {};    // `${menuKey}|${user}` -> live countdown { timer, sock, jid, key, domain }

function userKey(msg) {
    const raw = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
    return global.lidCache?.[raw] || raw;
}

const slot = (menuKey, user) => `${menuKey}|${user}`;

// Counts one use. Returns { allowed: true } or { allowed: false, healAt }.
function registerUse(menuKey, user, now = Date.now()) {
    const k = slot(menuKey, user);
    let rec = global.menuUses[k];
    if (rec && now >= rec.start + WINDOW_MS) { delete global.menuUses[k]; rec = null; }
    if (!rec) { global.menuUses[k] = { start: now, count: 1 }; return { allowed: true }; }
    if (rec.count < MAX_USES) { rec.count++; return { allowed: true }; }
    return { allowed: false, healAt: rec.start + WINDOW_MS };
}

function clock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

function lagosTime(ms) {
    return new Date(ms).toLocaleTimeString('en-US', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: true });
}

function blockedText(domain, healAt, now = Date.now(), live = true) {
    return (
        `🧠 *BRAIN DAMAGE SUSTAINED* 🧠\n\n` +
        `You spammed domains. Your mind could not take another *${domain.name}*.\n\n` +
        (live
            ? `⏳ *Heals in:* \`${clock(healAt - now)}\`\n`
            : `⏳ *Heals at:* the time below\n`) +
        `🕒 *Heal time:* ${lagosTime(healAt)} _(Lagos time)_`
    );
}

function stopLive(k) {
    const live = global.menuLive[k];
    if (live) { clearInterval(live.timer); delete global.menuLive[k]; }
    return live;
}

// Sends the "brain damage" message and keeps its countdown ticking.
// Only one live countdown runs per person and menu, however much they spam.
async function sendBlocked(sock, jid, msg, domain, healAt) {
    const user = userKey(msg);
    const k = slot(domain.key, user);
    if (global.menuLive[k]) {
        // already counting down: just show the current time left once, no new timer
        return sock.sendMessage(jid, { text: blockedText(domain, healAt) }, { quoted: msg });
    }
    const sent = await sock.sendMessage(jid, { text: blockedText(domain, healAt) }, { quoted: msg });
    if (!sent?.key) return sent;

    const started = Date.now();
    const live = { sock, jid, key: sent.key, domain, healAt };
    live.timer = setInterval(async () => {
        const now = Date.now();
        try {
            if (now >= healAt) {
                stopLive(k);
                await sock.sendMessage(jid, { text: `🩹 *Brain damage healed.* You can use the ${domain.name} menu again.`, edit: sent.key });
            } else if (now - started >= LIVE_MAX_MS) {
                stopLive(k);
                await sock.sendMessage(jid, { text: blockedText(domain, healAt, now, false), edit: sent.key });
            } else {
                await sock.sendMessage(jid, { text: blockedText(domain, healAt, now), edit: sent.key });
            }
        } catch (e) {
            stopLive(k); // message can no longer be edited
        }
    }, TICK_MS);
    if (live.timer.unref) live.timer.unref();
    global.menuLive[k] = live;
    return sent;
}

// Runs the cooldown for a menu command. Returns true when the menu may be shown.
async function gate(sock, msg, menuKey) {
    const jid = msg.key.remoteJid;
    const domain = DOMAINS[menuKey];
    const res = registerUse(menuKey, userKey(msg));
    if (res.allowed) return true;
    await sendBlocked(sock, jid, msg, domain, res.healAt);
    return false;
}

// Clears a person's cooldown for one menu. Returns { had, count }.
async function heal(menuKey, user) {
    const k = slot(menuKey, user);
    const rec = global.menuUses[k];
    delete global.menuUses[k];
    const live = stopLive(k);
    if (live) {
        try { await live.sock.sendMessage(live.jid, { text: `🩹 *Brain damage healed.* You can use the ${live.domain.name} menu again.`, edit: live.key }); } catch (e) { /* ignore */ }
    }
    return { had: !!rec, count: rec ? rec.count : 0, wasBlocked: !!rec && rec.count >= MAX_USES };
}

module.exports = {
    DOMAINS, RCT_GIFS, MAX_USES, WINDOW_MS,
    pick, getVideo, getAudio, sendDomainGif, sendDomainAudio,
    gate, heal, userKey, registerUse, clock, lagosTime, blockedText
};
