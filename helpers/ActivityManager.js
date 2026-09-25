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
function flushSync() {
    if (!cache) return;
    try {
        const dir = path.dirname(LEVELS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(LEVELS_PATH, JSON.stringify(cache, null, 2), 'utf-8');
    } catch (e) {
        console.error('⚠️ [ACTIVITY] Failed to flush levels.json on exit:', e.message);
    }
}
function saveLevels(data) {
    cache = data; // keep the in-memory copy authoritative immediately
    if (saveTimeout) return;
    saveTimeout = setTimeout(() => {
        flushSync();
        saveTimeout = null;
    }, 4000);
}
// The debounce above trades a little write frequency for durability, but
// only if the process actually lives 4s past the last message — during
// active development the bot gets restarted constantly, and every one of
// those restarts was silently discarding any counts recorded in that
// window before they ever reached disk (reproduced directly: 3 recorded
// messages + an immediate process.exit() → levels.json never even got
// created). Flushing synchronously on the way out closes that gap for any
// normal shutdown (process.exit(), SIGINT/SIGTERM, natural exit) — it can't
// help against a hard SIGKILL, but nothing running in-process can.
process.on('exit', flushSync);

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

/**
 * @param {string} jid Group JID.
 * @param {string} memberJid Member to look up.
 * @param {number|null} totalGroupMembers Optional real group member count (e.g.
 *   from groupMetadata.participants.length). When given, it's used as the
 *   ranking denominator instead of "members who've ever had a tracked
 *   message" — so the number shown actually matches the group's real size.
 *   Falls back to the old tracked-only count when omitted, and never lets
 *   the denominator dip below whatever `position` needs (e.g. if someone
 *   who left the group is still in the records).
 */
function getRank(jid, memberJid, totalGroupMembers = null) {
    const data = readLevels();
    const group = getGroup(data, jid);
    const record = group.members[memberJid] || { messages: 0 };
    const tier = getTierForCount(record.messages);
    const nextTier = getNextTier(record.messages);

    const ranked = Object.entries(group.members)
        .sort((a, b) => (b[1].messages || 0) - (a[1].messages || 0));
    const foundIndex = ranked.findIndex(([id]) => id === memberJid);

    // If this member has no tracked-message record at all, they aren't in
    // `ranked` — but they still occupy a real (last) place in the group's
    // standings. Counting them into the denominator too keeps position and
    // total consistent (previously this could show e.g. "#89 of 88": a
    // member ranked past the end of a list that didn't include them).
    const position = foundIndex >= 0 ? foundIndex + 1 : ranked.length + 1;
    let totalTracked = foundIndex >= 0 ? ranked.length : ranked.length + 1;

    if (typeof totalGroupMembers === 'number' && totalGroupMembers > 0) {
        // Real group size should be the denominator when we have it, but
        // never let it undercut `position` (e.g. stale participant counts,
        // or members who left but are still in the tracked records).
        totalTracked = Math.max(totalTracked, totalGroupMembers);
    }

    return {
        messages: record.messages || 0,
        tier,
        nextTier,
        remaining: nextTier ? Math.max(0, nextTier.req - record.messages) : 0,
        position,
        totalTracked
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
