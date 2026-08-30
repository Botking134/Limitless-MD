// plugins/news.js
// Two independent "spawn on update" watchers in one file:
//   1. Anime — newly released episodes
//   2. Sports — WWE and football (Premier League) results
//
// There's no fixed schedule to configure. Under the hood the bot checks each source
// on a short internal cadence, but it only ever posts when it detects something that
// genuinely wasn't there before (diffed against a "seen" cache) — so from the group's
// point of view, updates just show up the moment they exist, not on a timer you set.
//
// Toggle per group: .news on | .news off | .news status

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ─── STORAGE ────────────────────────────────────────────────────
const SETTINGS_FILE = path.join(__dirname, '..', 'storage', 'news_settings.json');
const SEEN_FILE = path.join(__dirname, '..', 'storage', 'news_seen.json');

function loadJSON(filePath, defaultData = {}) {
    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
            return defaultData;
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
        return defaultData;
    }
}

function saveJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`❌ [NEWS] Failed to save ${filePath}:`, e.message);
    }
}

function isEnabled(val) {
    return val === true || val === 'on' || val === '1' || val === 1;
}

function defaultSeen() {
    return {
        animeIds: [],
        sportsIds: { football: [], wwe: [] },
        seededAnime: false,
        seededFootball: false,
        seededWwe: false
    };
}

// Keep the "seen" arrays from growing forever.
function trimIds(arr, max = 300) {
    return arr.length > max ? arr.slice(arr.length - max) : arr;
}

async function getActiveGroups() {
    const settings = loadJSON(SETTINGS_FILE, {});
    return Object.keys(settings).filter(jid => isEnabled(settings[jid]));
}

async function broadcast(sock, payload) {
    const groups = await getActiveGroups();
    for (const jid of groups) {
        try {
            await sock.sendMessage(jid, payload);
        } catch (e) {
            console.error(`❌ [NEWS] Failed to send to ${jid}:`, e.message);
        }
        await new Promise(r => setTimeout(r, 800)); // gentle pacing across groups
    }
}

// ─── FEATURE 1: ANIME EPISODE WATCHER ──────────────────────────
// Public, no-key API — returns anime episodes as they're released.
const ANIME_RECENT_URL = 'https://api.consumet.org/anime/gogoanime/recent-episodes';

async function checkAnimeUpdates(sock) {
    let results;
    try {
        const { data } = await axios.get(ANIME_RECENT_URL, { timeout: 12000 });
        results = data?.results;
        if (!Array.isArray(results) || !results.length) return;
    } catch (e) {
        console.error('⚠️ [NEWS/ANIME] Fetch failed:', e.message);
        return;
    }

    const seen = loadJSON(SEEN_FILE, defaultSeen());
    seen.animeIds = seen.animeIds || [];

    // First run ever: just record the current snapshot as the baseline, don't spam
    // every group with the entire recent-episodes backlog.
    if (!seen.seededAnime) {
        seen.animeIds = trimIds(results.map(r => r.episodeId || r.id));
        seen.seededAnime = true;
        saveJSON(SEEN_FILE, seen);
        return;
    }

    const seenSet = new Set(seen.animeIds);
    const freshItems = results.filter(r => !seenSet.has(r.episodeId || r.id));
    if (!freshItems.length) return;

    // Oldest-first so the announcement order matches release order.
    for (const item of freshItems.reverse()) {
        const title = item.title?.trim() || 'Unknown Anime';
        const episodeNum = item.episodeNumber || item.episodeNumber === 0 ? item.episodeNumber : '?';
        const caption =
            `🎬 *NEW EPISODE ALERT!*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📺 *${title}*\n` +
            `▶️ Episode ${episodeNum} just dropped!`;

        try {
            if (item.image) {
                await broadcast(sock, { image: { url: item.image }, caption });
            } else {
                await broadcast(sock, { text: caption });
            }
        } catch (e) {
            console.error('⚠️ [NEWS/ANIME] Broadcast failed for', title, e.message);
        }
    }

    seen.animeIds = trimIds([...seenSet, ...freshItems.map(r => r.episodeId || r.id)]);
    saveJSON(SEEN_FILE, seen);
}

// ─── FEATURE 2: SPORTS WATCHER (WWE + Football) ────────────────
// TheSportsDB free tier — no signup required, key "123".
const SPORTS_KEY = '123';
const LEAGUES = {
    football: { id: '4328', label: 'Premier League', emoji: '⚽' },
    wwe: { id: '4444', label: 'WWE', emoji: '🤼' }
};

async function checkSportsUpdates(sock, leagueKey) {
    const league = LEAGUES[leagueKey];
    let events;
    try {
        const url = `https://www.thesportsdb.com/api/v1/json/${SPORTS_KEY}/eventspastleague.php?id=${league.id}`;
        const { data } = await axios.get(url, { timeout: 12000 });
        events = data?.events;
        if (!Array.isArray(events) || !events.length) return;
    } catch (e) {
        console.error(`⚠️ [NEWS/SPORTS/${leagueKey}] Fetch failed:`, e.message);
        return;
    }

    const seen = loadJSON(SEEN_FILE, defaultSeen());
    seen.sportsIds = seen.sportsIds || { football: [], wwe: [] };
    seen.sportsIds[leagueKey] = seen.sportsIds[leagueKey] || [];

    const seededKey = leagueKey === 'football' ? 'seededFootball' : 'seededWwe';
    if (!seen[seededKey]) {
        seen.sportsIds[leagueKey] = trimIds(events.map(e => e.idEvent));
        seen[seededKey] = true;
        saveJSON(SEEN_FILE, seen);
        return;
    }

    const seenSet = new Set(seen.sportsIds[leagueKey]);
    const freshEvents = events.filter(e => !seenSet.has(e.idEvent));
    if (!freshEvents.length) return;

    for (const ev of freshEvents.reverse()) {
        const home = ev.strHomeTeam || '';
        const away = ev.strAwayTeam || '';
        const hasScore = ev.intHomeScore !== null && ev.intAwayScore !== null && ev.intHomeScore !== undefined;
        const resultLine = hasScore
            ? `*${home}* ${ev.intHomeScore} - ${ev.intAwayScore} *${away}*`
            : `*${ev.strEvent || `${home} vs ${away}`}*`;

        const caption =
            `${league.emoji} *${league.label.toUpperCase()} UPDATE!*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
            `${resultLine}\n` +
            (ev.dateEvent ? `📅 ${ev.dateEvent}\n` : '') +
            (ev.strVenue ? `📍 ${ev.strVenue}` : '');

        try {
            if (ev.strThumb) {
                await broadcast(sock, { image: { url: ev.strThumb }, caption });
            } else {
                await broadcast(sock, { text: caption });
            }
        } catch (e) {
            console.error(`⚠️ [NEWS/SPORTS/${leagueKey}] Broadcast failed:`, e.message);
        }
    }

    seen.sportsIds[leagueKey] = trimIds([...seenSet, ...freshEvents.map(e => e.idEvent)]);
    saveJSON(SEEN_FILE, seen);
}

// ─── WATCHER LOOP ───────────────────────────────────────────────
const POLL_INTERVAL_MS = 2 * 60 * 1000; // internal check cadence — not user-configurable, not a broadcast schedule
let pollTimer = null;

function startNewsWatchers(sock) {
    if (pollTimer) return; // already running, idempotent
    const tick = async () => {
        try {
            const activeGroups = await getActiveGroups();
            if (!activeGroups.length) return; // nobody has news on — skip the API calls entirely
            await checkAnimeUpdates(sock);
            await checkSportsUpdates(sock, 'football');
            await checkSportsUpdates(sock, 'wwe');
        } catch (e) {
            console.error('❌ [NEWS] Watcher tick failed:', e.message);
        }
    };
    tick(); // run once immediately (will just seed baselines on first-ever run)
    pollTimer = setInterval(tick, POLL_INTERVAL_MS);
}

// ─── TOGGLE COMMAND ─────────────────────────────────────────────
const newsToggleCommand = {
    name: 'news',
    category: 'group',
    execute: async (sock, msg, args, opts) => {
        const jid = msg.key.remoteJid;
        if (!jid.endsWith('@g.us')) {
            return sock.sendMessage(jid, { text: "❌ Group command only." }, { quoted: msg });
        }

        const { isOwner, isSudo, isDev, isAdmin } = opts || {};
        if (!isOwner && !isSudo && !isDev && !isAdmin) {
            return sock.sendMessage(jid, { text: "⛔ Admin permission required." }, { quoted: msg });
        }

        const option = (args || '').trim().toLowerCase();
        const settings = loadJSON(SETTINGS_FILE, {});
        const isCurrentlyEnabled = isEnabled(settings[jid]);

        if (!option || option === 'status') {
            const status = isCurrentlyEnabled ? "🟢 Enabled" : "🔴 Disabled";
            return sock.sendMessage(jid, {
                text: `📰 *News Alerts:* ${status}\n\n` +
                      `Anime episode drops + WWE/Football results, posted the moment they're detected — no fixed schedule.`
            }, { quoted: msg });
        }

        if (option === 'on' || option === 'enable' || option === '1') {
            if (isCurrentlyEnabled) return sock.sendMessage(jid, { text: "ℹ️ News alerts are already enabled here." }, { quoted: msg });
            settings[jid] = true;
            saveJSON(SETTINGS_FILE, settings);
            startNewsWatchers(sock);
            return sock.sendMessage(jid, { text: "✅ *News alerts enabled.* You'll get anime episode drops and WWE/Football updates as they happen." }, { quoted: msg });
        }

        if (option === 'off' || option === 'disable' || option === '0') {
            if (!isCurrentlyEnabled) return sock.sendMessage(jid, { text: "ℹ️ News alerts are already disabled here." }, { quoted: msg });
            delete settings[jid];
            saveJSON(SETTINGS_FILE, settings);
            return sock.sendMessage(jid, { text: "🛑 *News alerts disabled* for this group." }, { quoted: msg });
        }

        return sock.sendMessage(jid, { text: "⚠️ Usage: *.news on* | *off* | *status*" }, { quoted: msg });
    }
};

const commands = [newsToggleCommand];
commands.startNewsWatchers = startNewsWatchers;

module.exports = commands;
