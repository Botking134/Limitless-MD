// helpers/ActivityManager.js
//
// Central store for the per-group message-leveling system.
// Backs: .levelup broadcasts, .rank, .leaderboard, and the
// "activity %" figure shown in generated welcome/goodbye cards.
//
// Storage lives in storage/levels.json (survives restarts, unlike the
// old config.totalMessages counter which was never persisted).

const fs = require('fs');
const path = require('path');

const LEVELS_PATH = path.join(__dirname, '../storage/levels.json');

// ─── TIER GRID (shared with plugins/group/group_advanced.js) ───────
const TIER_DATA = [
    { index: 11, name: "Infinitesimal", req: 0, icon: "🌌", desc: "Lower-dimensional entity unable to affect the 3D world." },
    { index: 10, name: "Human", req: 15, icon: "🏃", desc: "Standard human capabilities up to peak athlete level." },
    { index: 9, name: "Superhuman", req: 45, icon: "⚡", desc: "Street-level fighter. Can smash steel, concrete, or small rooms." },
    { index: 8, name: "Urban", req: 90, icon: "🏢", desc: "Destructive force ranging from single buildings to city blocks." },
    { index: 7, name: "Nuclear / Regional", req: 150, icon: "☄️", desc: "Capable of leveling towns, major cities, or vaporizing mountains." },
    { index: 6, name: "Global", req: 250, icon: "🗺️", desc: "Tectonic force capable of destroying island nations or continents." },
    { index: 5, name: "Planetary", req: 400, icon: "🪐", desc: "Celestial power capable of shattering moons and gas giants." },
    { index: 4, name: "Stellar", req: 600, icon: "☀️", desc: "Cosmic power able to completely obliterate stars and solar systems." },
    { index: 3, name: "Cosmic", req: 800, icon: "🌌", desc: "Reality-spanning scale. Can collapse galaxies and physical matter." },
    { index: 2, name: "Multiversal", req: 900, icon: "🔮", desc: "Manipulates multiple timelines and distinct universes simultaneously." },
    { index: 1, name: "Extradimensional (Outerversal)", req: 1000, icon: "👁️", desc: "Transcends space, time, and dimensional conceptual frameworks." },
    { index: 0, name: "Boundless", req: 1500, icon: "👑", desc: "True omnipotence. Beyond any logical framework or hierarchy." }
];

// Sorted ascending by req, handy for "next tier" lookups.
const TIERS_ASC = [...TIER_DATA].sort((a, b) => a.req - b.req);

function getTierForCount(count) {
    let current = TIERS_ASC[0];
    for (const tier of TIERS_ASC) {
        if (count >= tier.req) current = tier;
        else break;
    }
    return current;
}

function getNextTier(count) {
    return TIERS_ASC.find(t => t.req > count) || null;
}

// ─── PERSISTENCE ────────────────────────────────────────────────────
// The disk write is debounced (batched), but reads must never go stale
// between calls — so an in-memory cache is the single source of truth
// for the life of the process, and the debounce only governs when it
// gets flushed to disk. (An earlier version re-read from disk on every
// call, which silently dropped counts between the debounced writes.)
let cache = null;

function loadCacheFromDisk() {
    try {
        if (fs.existsSync(LEVELS_PATH)) {
            return JSON.parse(fs.readFileSync(LEVELS_PATH, 'utf-8'));
        }
    } catch (e) {
        console.error('⚠️ [ACTIVITY] levels.json unreadable, resetting:', e.message);
    }
    return { groups: {} };
}

function readLevels() {
    if (!cache) cache = loadCacheFromDisk();
    return cache;
}

let saveTimeout = null;
function saveLevels(data) {
    cache = data; // keep the in-memory copy authoritative immediately
    if (saveTimeout) return;
    saveTimeout = setTimeout(() => {
        try {
            const dir = path.dirname(LEVELS_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(LEVELS_PATH, JSON.stringify(cache, null, 2), 'utf-8');
        } catch (e) {
            console.error('⚠️ [ACTIVITY] Failed to save levels.json:', e.message);
        }
        saveTimeout = null;
    }, 4000);
}

function getGroup(data, jid) {
    data.groups = data.groups || {};
    data.groups[jid] = data.groups[jid] || { total: 0, members: {} };
    data.groups[jid].members = data.groups[jid].members || {};
    return data.groups[jid];
}

// ─── JOIN / LEAVE LIFECYCLE ─────────────────────────────────────────

/** Call when a member joins a group — captures the baseline for "activity since joining". */
function registerJoin(jid, memberJid) {
    if (!jid || !memberJid) return;
    const data = readLevels();
    const group = getGroup(data, jid);
    group.members[memberJid] = group.members[memberJid] || { messages: 0 };
    group.members[memberJid].joinedAt = Date.now();
    group.members[memberJid].totalAtJoin = group.total;
    saveLevels(data);
}

/**
 * Call when a member leaves — returns their activity % (share of the group's
 * message volume since they joined) and their raw stats, then clears them out.
 * Does NOT delete their message count from the leaderboard's historical record —
 * only clears join-tracking so a later re-join starts fresh.
 */
function getLeaveStats(jid, memberJid) {
    const data = readLevels();
    const group = getGroup(data, jid);
    const record = group.members[memberJid];

    if (!record) return { messages: 0, activityPercent: 0 };

    const totalAtJoin = record.totalAtJoin || 0;
    const windowTotal = Math.max(1, group.total - totalAtJoin);
    const activityPercent = Math.max(0, Math.min(100, Math.round((record.messages / windowTotal) * 100)));

    return { messages: record.messages || 0, activityPercent };
}

// ─── MESSAGE COUNTING ────────────────────────────────────────────────

/**
 * Records one tracked group message from memberJid.
 * Returns level-up info if this message pushed them into a new tier
 * (so the caller can fire a .levelup broadcast), otherwise null.
 */
function recordGroupMessage(jid, memberJid) {
    if (!jid || !memberJid) return null;

    const data = readLevels();
    const group = getGroup(data, jid);
    group.total = (group.total || 0) + 1;

    group.members[memberJid] = group.members[memberJid] || { messages: 0, joinedAt: Date.now(), totalAtJoin: 0 };
    const record = group.members[memberJid];

    const oldTier = getTierForCount(record.messages || 0);
    record.messages = (record.messages || 0) + 1;
    const newTier = getTierForCount(record.messages);

    saveLevels(data);

    if (newTier.index !== oldTier.index) {
        return { leveledUp: true, oldTier, newTier, messages: record.messages };
    }
    return null;
}

// ─── QUERIES (rank / leaderboard) ───────────────────────────────────

function getRank(jid, memberJid) {
    const data = readLevels();
    const group = getGroup(data, jid);
    const record = group.members[memberJid] || { messages: 0 };
    const tier = getTierForCount(record.messages);
    const nextTier = getNextTier(record.messages);

    const ranked = Object.entries(group.members)
        .sort((a, b) => (b[1].messages || 0) - (a[1].messages || 0));
    const position = ranked.findIndex(([id]) => id === memberJid);

    return {
        messages: record.messages || 0,
        tier,
        nextTier,
        remaining: nextTier ? Math.max(0, nextTier.req - record.messages) : 0,
        position: position >= 0 ? position + 1 : ranked.length + 1,
        totalTracked: ranked.length
    };
}

function getLeaderboard(jid, limit = 10) {
    const data = readLevels();
    const group = getGroup(data, jid);

    return Object.entries(group.members)
        .map(([memberJid, record]) => ({
            jid: memberJid,
            messages: record.messages || 0,
            tier: getTierForCount(record.messages || 0)
        }))
        .sort((a, b) => b.messages - a.messages)
        .slice(0, limit);
}

module.exports = {
    TIER_DATA,
    getTierForCount,
    getNextTier,
    registerJoin,
    getLeaveStats,
    recordGroupMessage,
    getRank,
    getLeaderboard
};
