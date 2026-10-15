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

// ─── TIER GRID ──────────────────────────────────────────────────────
// 12 main tiers, each split into VS Battles–style steps (Low / High /
// Complex / Hyperverse / Outerverse ...), 55 steps in total.
//
// TIER_SCALE is the one knob for how long the grind is: every main tier's
// starting message count is `base * TIER_SCALE`, and the steps inside a tier
// are spaced evenly (rounded to 5) between that start and the next tier's.
// Raise it for a longer climb, lower it for a shorter one. (This file is the
// single source of truth — plugins/group/group_advanced.js reads it from here.)
const TIER_SCALE = 4;

const MAIN_TIERS = [
    { index: 11, name: "Infinitesimal", base: 0, icon: "🌌", desc: "Lower-dimensional entity unable to affect the 3D world.",
      steps: ["Low Hypoverse Level", "Hypoverse Level", "High Hypoverse Level"] },
    { index: 10, name: "Human", base: 15, icon: "🏃", desc: "Standard human capabilities up to peak athlete level.",
      steps: ["Below Average Human Level", "Human Level", "Athlete Level"] },
    { index: 9, name: "Superhuman", base: 45, icon: "⚡", desc: "Street-level fighter. Can smash steel, concrete, or small rooms.",
      steps: ["Street Level", "Wall Level", "Small Building Level"] },
    { index: 8, name: "Urban", base: 90, icon: "🏢", desc: "Destructive force ranging from single buildings to city blocks.",
      steps: ["Building Level", "Large Building Level", "City Block Level", "Multi-City Block Level"] },
    { index: 7, name: "Nuclear / Regional", base: 150, icon: "☄️", desc: "Capable of leveling towns, major cities, or vaporizing mountains.",
      steps: ["Small Town Level", "Town Level", "Large Town Level", "Small City Level", "City Level", "Mountain Level", "Large Mountain Level"] },
    { index: 6, name: "Global", base: 250, icon: "🗺️", desc: "Tectonic force capable of destroying island nations or continents.",
      steps: ["Island Level", "Large Island Level", "Small Country Level", "Country Level", "Large Country Level", "Continent Level", "Multi-Continent Level"] },
    { index: 5, name: "Planetary", base: 400, icon: "🪐", desc: "Celestial power capable of shattering moons and gas giants.",
      steps: ["Moon Level", "Small Planet Level", "Planet Level", "Large Planet Level", "Dwarf Star Level"] },
    { index: 4, name: "Stellar", base: 600, icon: "☀️", desc: "Cosmic power able to completely obliterate stars and solar systems.",
      steps: ["Small Star Level", "Star Level", "Large Star Level", "Solar System Level", "Multi-Solar System Level"] },
    { index: 3, name: "Cosmic", base: 800, icon: "🌠", desc: "Reality-spanning scale. Can collapse galaxies and physical matter.",
      steps: ["Galaxy Level", "Multi-Galaxy Level", "Universe Level", "High Universe Level"] },
    { index: 2, name: "Multiversal", base: 900, icon: "🔮", desc: "Manipulates multiple timelines and distinct universes simultaneously.",
      steps: ["Universe Level+", "Low Multiverse Level", "Multiverse Level", "Multiverse Level+"] },
    { index: 1, name: "Extradimensional (Outerversal)", base: 1000, icon: "👁️", desc: "Transcends space, time, and dimensional conceptual frameworks.",
      steps: ["Low Complex Multiverse Level", "Complex Multiverse Level", "High Complex Multiverse Level", "Hyperverse Level",
              "High Hyperverse Level", "Transcendent", "Low Outerverse Level", "Outerverse Level", "High Outerverse Level"] },
    { index: 0, name: "Boundless", base: 1500, icon: "👑", desc: "True omnipotence. Beyond any logical framework or hierarchy.",
      steps: ["Boundless"] }
];

// Flat, ascending list of every step. Shape is a superset of the old grid
// (index / name / req / icon / desc), so existing readers keep working:
//   name      -> display label, e.g. "Planetary · Large Planet Level"
//   tierName  -> main tier only, stepName -> step only
//   major     -> true on the first step of a main tier (the one worth announcing)
const TIER_DATA = [];
MAIN_TIERS.forEach((tier, i) => {
    const start = tier.base * TIER_SCALE;
    const nextStart = i < MAIN_TIERS.length - 1 ? MAIN_TIERS[i + 1].base * TIER_SCALE : null;
    const n = tier.steps.length;
    tier.steps.forEach((stepName, k) => {
        let req = start;
        if (nextStart !== null && k > 0) {
            req = start + Math.round(((nextStart - start) * k / n) / 5) * 5;
        }
        TIER_DATA.push({
            index: tier.index,
            tierName: tier.name,
            stepName,
            name: n === 1 ? tier.name : `${tier.name} · ${stepName}`,
            req,
            icon: tier.icon,
            desc: tier.desc,
            major: k === 0
        });
    });
});
TIER_DATA.sort((a, b) => a.req - b.req);

const TIERS_ASC = TIER_DATA;

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

    if (newTier.req !== oldTier.req) {
        return {
            leveledUp: true,
            majorChange: newTier.index !== oldTier.index,
            oldTier,
            newTier,
            messages: record.messages
        };
    }
    return null;
}

// ─── QUERIES (rank / leaderboard) ───────────────────────────────────

// ─── IDENTITY MERGING ───────────────────────────────────────────────
// Counts are recorded under whichever ID the bot knew for the sender at that
// moment: their phone JID when resolved, otherwise their @lid. The same person
// can therefore have two records (or a lookup can use a different ID than the
// one stored), which made .rank report the wrong position while the
// leaderboard — which just lists stored keys — looked right. Everything below
// folds those IDs into one canonical identity before counting or ranking.
function canonicalJid(jid) {
    if (!jid || typeof jid !== 'string') return '';
    const at = jid.indexOf('@');
    if (at === -1) return jid;
    let clean = jid.slice(0, at).split(':')[0] + jid.slice(at);
    if (clean.endsWith('@lid')) {
        const mapped = global.lidCache && global.lidCache[clean];
        if (mapped && typeof mapped === 'string') {
            const mAt = mapped.indexOf('@');
            clean = mAt === -1 ? mapped : mapped.slice(0, mAt).split(':')[0] + mapped.slice(mAt);
        }
    }
    return clean;
}

// Returns Map<canonicalJid, messages> with duplicate identities summed.
function aggregateMembers(group) {
    const merged = new Map();
    for (const [id, record] of Object.entries(group.members || {})) {
        const key = canonicalJid(id);
        merged.set(key, (merged.get(key) || 0) + (record.messages || 0));
    }
    return merged;
}

/**
 * @param {string} jid Group JID.
 * @param {string} memberJid Member to look up.
 * @param {number|null} totalGroupMembers Optional real group member count, used
 *   as the denominator when larger than the tracked count.
 * @param {string[]} aliases Other IDs known for the same person (e.g. the
 *   original @lid before it was resolved to a phone JID).
 */
function getRank(jid, memberJid, totalGroupMembers = null, aliases = []) {
    const data = readLevels();
    const group = getGroup(data, jid);
    const merged = aggregateMembers(group);

    const targetKeys = new Set([memberJid, ...aliases].map(canonicalJid).filter(Boolean));
    const matchedKey = [...targetKeys].find(k => merged.has(k));
    const messages = matchedKey ? merged.get(matchedKey) : 0;

    const tier = getTierForCount(messages);
    const nextTier = getNextTier(messages);

    const ranked = [...merged.entries()].sort((a, b) => b[1] - a[1]);
    const foundIndex = matchedKey ? ranked.findIndex(([id]) => id === matchedKey) : -1;

    // Someone with no record still holds a real (last) place; count them in
    // the denominator too so position and total stay consistent.
    const position = foundIndex >= 0 ? foundIndex + 1 : ranked.length + 1;
    let totalTracked = foundIndex >= 0 ? ranked.length : ranked.length + 1;

    if (typeof totalGroupMembers === 'number' && totalGroupMembers > 0) {
        totalTracked = Math.max(totalTracked, totalGroupMembers);
    }

    return {
        messages,
        tier,
        nextTier,
        remaining: nextTier ? Math.max(0, nextTier.req - messages) : 0,
        position,
        totalTracked
    };
}

function getLeaderboard(jid, limit = 10) {
    const data = readLevels();
    const group = getGroup(data, jid);

    return [...aggregateMembers(group).entries()]
        .map(([memberJid, messages]) => ({
            jid: memberJid,
            messages,
            tier: getTierForCount(messages)
        }))
        .sort((a, b) => b.messages - a.messages)
        .slice(0, limit);
}

module.exports = {
    TIER_DATA,
    MAIN_TIERS,
    TIER_SCALE,
    getTierForCount,
    getNextTier,
    registerJoin,
    getLeaveStats,
    recordGroupMessage,
    getRank,
    getLeaderboard
};
