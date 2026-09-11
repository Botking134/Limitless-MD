// plugins/news.js
// "Spawn on update" watcher: anime newly-released episodes.
// (The sports/WWE+football watcher was pulled out for now — anime-only until
// that's revisited.)
//
// There's no fixed schedule to configure. Under the hood the bot checks the
// source on a short internal cadence, but it only ever posts when it detects
// something that genuinely wasn't there before (diffed against a "seen"
// cache) — so from the group's point of view, updates just show up the
// moment they exist, not on a timer you set.
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

// ID scheme version — bump this whenever the shape of an item's `id` changes
// (e.g. switching sources changes IDs from numeric AniList IDs to article
// URLs). On a mismatch every current item would otherwise look "fresh" all
// at once and flood every group — instead we silently reseed, exactly like
// a first-ever run.
const SCHEMA_VERSION = 2;

function defaultSeen() {
    return {
        schemaVersion: SCHEMA_VERSION,
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

function loadSeen() {
    const seen = loadJSON(SEEN_FILE, defaultSeen());
    if (seen.schemaVersion !== SCHEMA_VERSION) {
        // ID format changed underneath this data — reseed instead of treating
        // every item under the new scheme as newly "fresh".
        return defaultSeen();
    }
    return seen;
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

// ─── FEATURE 1: ANIME NEWS WATCHER ──────────────────────────────
// Pulls real anime NEWS articles (reveals, announcements, cast news — not
// just "episode aired" pings) from each outlet's public RSS feed, formatted
// to match the "ANIME NEWS UPDATE" card style: title, "via <source>",
// summary, then a Read More link. No API key needed — RSS is public.
//
// Honesty note: I can't reach the open internet from where I write/test this
// code, so these URLs are my best-confidence picks (ANN's feed in particular
// is a long-standing, well-known one; Anime Corner is WordPress, which
// exposes /feed/ by default), not something I've hit and confirmed live from
// here. Use `.news test` below to check straight from your own server —
// that's real network access and will tell you immediately which of these
// actually resolve for you, instead of us guessing back and forth.
const NEWS_SOURCES = [
    { name: 'Anime News Network', url: 'https://www.animenewsnetwork.com/all/rss.xml' },
    { name: 'Anime Corner', url: 'https://animecorner.me/feed/' },
    { name: 'MyAnimeList', url: 'https://myanimelist.net/rss/news.xml' }
];

function decodeEntities(str) {
    return (str || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim();
}

function stripHtml(str) {
    // Unwrap CDATA/entities BEFORE stripping tags — doing it the other way
    // around lets the tag-stripper eat the CDATA opener together with the
    // first real HTML tag inside it, leaving a stray "]]>" behind.
    return decodeEntities(str || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractTag(xml, tag) {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match ? match[1] : '';
}

function extractImage(itemXml) {
    const enclosure = itemXml.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image[^"]*"/i)
        || itemXml.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i)
        || itemXml.match(/<img[^>]*src="([^"]+)"/i);
    const url = enclosure ? enclosure[1] : null;
    // Only accept a real absolute http(s) URL — RSS feeds sometimes give a
    // protocol-relative ("//host/img.jpg") or relative path, which Baileys/
    // WhatsApp can't fetch as-is. Passing that through was the "failed to
    // attach images" you saw; better to just skip the image than send a
    // request that's guaranteed to fail.
    return url && /^https?:\/\//i.test(url) ? url : null;
}

async function fetchImageBuffer(url) {
    // Some hosts (hotlink protection, bot-blocking) reject Baileys' own
    // fetch of a bare image URL. Downloading it ourselves first — with the
    // same User-Agent we use for RSS — and handing WhatsApp raw bytes
    // instead of a URL is more reliable and also means we only fetch once
    // even though the item gets broadcast to many groups.
    const res = await axios.get(url, {
        timeout: 15000,
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LimitlessMD-NewsBot/1.0)' }
    });
    return Buffer.from(res.data);
}

async function fetchOgImage(articleUrl) {
    // Fallback for sources whose RSS entries carry no image at all — Anime
    // News Network's feed is like this (no <enclosure>, no <media:*>, ever).
    // We fetch the actual article page and pull its og:image meta tag
    // instead. Only called for items that are actually new (see below),
    // so this doesn't add a request per poll — just per genuinely fresh item.
    try {
        const { data: html } = await axios.get(articleUrl, {
            timeout: 12000,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LimitlessMD-NewsBot/1.0)' }
        });
        const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        const url = match ? match[1] : null;
        return url && /^https?:\/\//i.test(url) ? url : null;
    } catch (e) {
        return null;
    }
}

async function fetchRssNews(source) {
    const { data: xml } = await axios.get(source.url, {
        timeout: 12000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LimitlessMD-NewsBot/1.0)' }
    });

    const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
    return itemBlocks.map(block => {
        const title = decodeEntities(extractTag(block, 'title'));
        const link = decodeEntities(extractTag(block, 'link')).trim();
        const rawDescription = extractTag(block, 'description') || extractTag(block, 'content:encoded');
        const summary = stripHtml(rawDescription).slice(0, 320);
        const image = extractImage(block);
        if (!title || !link) return null;
        return { id: link, title, link, summary, image, source: source.name };
    }).filter(Boolean);
}

async function checkAnimeUpdates(sock) {
    let allItems = [];
    for (const source of NEWS_SOURCES) {
        try {
            const items = await fetchRssNews(source);
            allItems = allItems.concat(items);
        } catch (e) {
            console.error(`⚠️ [NEWS/ANIME] Fetch failed for ${source.name}:`, e.message);
        }
    }
    if (!allItems.length) return;

    const seen = loadSeen();
    seen.animeIds = seen.animeIds || [];

    // First run ever: just record the current snapshot as the baseline, don't spam
    // every group with the entire recent-news backlog.
    if (!seen.seededAnime) {
        seen.animeIds = trimIds(allItems.map(s => s.id));
        seen.seededAnime = true;
        saveJSON(SEEN_FILE, seen);
        return;
    }

    const seenSet = new Set(seen.animeIds);
    const freshItems = allItems.filter(s => !seenSet.has(s.id));
    if (!freshItems.length) return;

    // Oldest-first so the announcement order matches publish order.
    for (const item of freshItems.reverse()) {
        if (!item.image) {
            item.image = await fetchOgImage(item.link);
        }
        const caption =
            `📰 *ANIME NEWS UPDATE* 📰\n\n` +
            `*${item.title}*\n` +
            `_via ${item.source}_\n\n` +
            `${item.summary}${item.summary.length >= 320 ? '…' : ''}\n\n` +
            `🔗 *Read More*\n${item.link}`;

        let imageBuffer = null;
        if (item.image) {
            try {
                imageBuffer = await fetchImageBuffer(item.image);
            } catch (e) {
                console.error('⚠️ [NEWS/ANIME] Image download failed for', item.title, '— sending as text:', e.message);
            }
        }

        try {
            if (imageBuffer) {
                await broadcast(sock, { image: imageBuffer, caption });
            } else {
                await broadcast(sock, { text: caption });
            }
        } catch (e) {
            // Send failed for some other reason (bad group jid, etc.) — don't just
            // drop the item, still try to get the news out as text.
            console.error('⚠️ [NEWS/ANIME] Send failed for', item.title, '— retrying as text:', e.message);
            try { await broadcast(sock, { text: caption }); } catch (e2) { /* give up on this item */ }
        }

        // Mark this item seen immediately (not just at the end of the loop) —
        // if the process restarts mid-batch, already-sent items won't resend.
        seenSet.add(item.id);
        seen.animeIds = trimIds([...seenSet]);
        saveJSON(SEEN_FILE, seen);
    }
}

// ─── FEATURE 2: SPORTS WATCHER (WWE + Football) — DISABLED FOR NOW ─
// Left in place (unused) rather than deleted, in case sports gets turned back
// on later. Not called from the watcher loop below.
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
const POLL_INTERVAL_MS = 45 * 60 * 1000; // internal check cadence — not user-configurable, not a broadcast schedule
let pollTimer = null;
let isTicking = false; // guards against overlapping ticks (see note below)

function startNewsWatchers(sock) {
    if (pollTimer) return; // already running, idempotent
    const tick = async () => {
        // If a previous tick is still running (e.g. a big first-time batch
        // taking a while to broadcast across many groups) and setInterval
        // fires again before it finishes, an overlapping tick would read the
        // same not-yet-saved "seen" state and re-broadcast the same items —
        // this was the actual cause of news repeating non-stop.
        if (isTicking) return;
        isTicking = true;
        try {
            const activeGroups = await getActiveGroups();
            if (!activeGroups.length) return; // nobody has news on — skip the API calls entirely
            await checkAnimeUpdates(sock);
            // Sports (football/WWE) disabled for now — anime only. See note above.
        } catch (e) {
            console.error('❌ [NEWS] Watcher tick failed:', e.message);
        } finally {
            isTicking = false;
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
                      `Anime news updates, posted the moment they're detected — no fixed schedule.`
            }, { quoted: msg });
        }

        if (option === 'on' || option === 'enable' || option === '1') {
            if (isCurrentlyEnabled) return sock.sendMessage(jid, { text: "ℹ️ News alerts are already enabled here." }, { quoted: msg });
            settings[jid] = true;
            saveJSON(SETTINGS_FILE, settings);
            startNewsWatchers(sock);
            return sock.sendMessage(jid, { text: "✅ *News alerts enabled.* First run just sets a baseline (no backlog spam) — expect the first actual update within the next few minutes. Run *.news test* anytime to check the sources directly." }, { quoted: msg });
        }

        if (option === 'off' || option === 'disable' || option === '0') {
            if (!isCurrentlyEnabled) return sock.sendMessage(jid, { text: "ℹ️ News alerts are already disabled here." }, { quoted: msg });
            delete settings[jid];
            saveJSON(SETTINGS_FILE, settings);
            return sock.sendMessage(jid, { text: "🛑 *News alerts disabled* for this group." }, { quoted: msg });
        }

        if (option === 'test' || option === 'debug') {
            await sock.sendMessage(jid, { text: "🔍 Checking each news source directly, one moment…" }, { quoted: msg });
            const lines = [`🔍 *NEWS SOURCE CHECK*`];
            for (const source of NEWS_SOURCES) {
                try {
                    const items = await fetchRssNews(source);
                    lines.push(`✅ *${source.name}* — ${items.length} item(s)` + (items[0] ? `\n   Latest: "${items[0].title}"` : ''));
                } catch (e) {
                    const status = e.response?.status;
                    lines.push(`❌ *${source.name}* — ${status ? `HTTP ${status}` : e.message}`);
                }
            }
            const seen = loadSeen();
            lines.push(`\n_Baseline seeded: ${seen.seededAnime ? 'yes' : 'no — first tick after enabling only sets the baseline, next tick posts anything new'}_`);
            return sock.sendMessage(jid, { text: lines.join('\n') }, { quoted: msg });
        }

        return sock.sendMessage(jid, { text: "⚠️ Usage: *.news on* | *off* | *status* | *test*" }, { quoted: msg });
    }
};

const commands = [newsToggleCommand];
commands.startNewsWatchers = startNewsWatchers;

module.exports = commands;
