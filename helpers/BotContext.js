// helpers/BotContext.js
//
// Gives each live connection — the main bot AND every sub-bot spun up via
// .addbot — its own isolated copy of the "dynamic" settings that config.js
// exposes (prefix, antilink, isPublic, welcome/goodbye, etc).
//
// Previously all of these lived on ONE shared config object, so a sub-bot
// owner running .setprefix, .mode, .antilink, etc. changed that setting for
// the main bot and every other sub-bot too, since they all `require('../config')`
// and get back the exact same object.
//
// Fix: config.js wraps its dynamic keys in a Proxy (see config.js). Whenever
// plugin code reads/writes config.<dynamicKey>, the Proxy looks up which bot
// is "active" right now — tracked via AsyncLocalStorage, set once per
// incoming message in helpers/Infinity.js based on which socket the message
// came in on — and gets/sets THAT bot's own settings object instead of the
// single shared one. No plugin files need to change: they keep reading and
// writing config.foo exactly as before.

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();
const SUB_SESSIONS_DIR = path.join(__dirname, '../storage/sub_sessions');

const MAIN_ID = 'main';

// botId -> live settings object currently held in memory for that bot.
const varsByBot = new Map();

// Snapshot of config.js's original values for every dynamic key, taken once
// at startup before the proxy starts redirecting anything. This is what a
// brand-new sub-bot (one with no vars.json of its own yet) starts from.
let defaults = {};

// Deep copy, so no two bots ever share the same array/object instance.
// (A plain `{ ...defaults }` copied only the top level, so every new sub-bot
// received the SAME antilink/welcome/sudos object as every other one, and a
// change made in one bot showed up in all of them.)
const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

function setDefaults(obj) {
    defaults = clone(obj);
}

function subVarsPath(botId) {
    return path.join(SUB_SESSIONS_DIR, botId, 'vars.json');
}

function loadSubVars(botId) {
    try {
        const p = subVarsPath(botId);
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        console.error(`⚠️ [BOTCONTEXT] Failed to read settings for sub-bot ${botId}:`, e.message);
    }
    return null;
}

function saveSubVars(botId, obj) {
    try {
        const p = subVarsPath(botId);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(obj, null, 2));
        return true;
    } catch (e) {
        console.error(`⚠️ [BOTCONTEXT] Failed to save settings for sub-bot ${botId}:`, e.message);
        return false;
    }
}

/** Registers the main bot's live settings object (the one vars.js loads from storage/vars.json). */
function setMainVars(obj) {
    varsByBot.set(MAIN_ID, obj);
}

/** Returns the settings object for whichever bot is currently handling a message. */
function getActiveVars() {
    const botId = getActiveBotId();
    if (!varsByBot.has(botId)) {
        // A sub-bot starts from fresh defaults, with whatever it saved on top.
        // Starting from the defaults means a setting added in a later update
        // (missing from an older vars.json) is still the sub-bot's own value
        // instead of falling through to the main bot's shared one.
        varsByBot.set(botId, botId === MAIN_ID
            ? clone(defaults)
            : { ...clone(defaults), ...(loadSubVars(botId) || {}) });
    }
    return varsByBot.get(botId);
}

/** Returns the id of whichever bot is currently handling a message ('main' outside any message context). */
function getActiveBotId() {
    return storage.getStore() || MAIN_ID;
}

/** Persists the currently-active sub-bot's settings to its own vars.json. No-op for the main bot (vars.js owns that path). */
function persistActive() {
    const botId = getActiveBotId();
    if (botId === MAIN_ID) return true;
    const toSave = { ...getActiveVars() };
    for (const k of VOLATILE_KEYS) delete toSave[k];
    return saveSubVars(botId, toSave);
}

/** Runs fn with `botId` set as the active bot for every config.<dynamicKey> access inside it (and anything it awaits). */
function runAsBot(botId, fn) {
    return storage.run(botId || MAIN_ID, fn);
}

/** Drops a sub-bot's in-memory settings and its on-disk vars.json, e.g. when it's removed or logs out. */
function forgetBot(botId) {
    if (!botId || botId === MAIN_ID) return;
    varsByBot.delete(botId);
    try { fs.rmSync(subVarsPath(botId), { force: true }); } catch (e) {}
}

// Every config.js key that a command can change at runtime. Kept here
// (instead of only in vars.js) so config.js can build its Proxy without
// needing to require vars.js. These are persisted for the MAIN bot in
// storage/vars.json.
const DYNAMIC_KEYS = [
        'prefix', 'vvs', 'packName', 'author', 'menuImage', 'warnThreshold', 'presenceMode',
        'isPublic', 'autoReact', 'antipm', 'lizzyChats', 'chatbotChats', 'fridayChats',
        'gojoSleepChats', 'gojoGlobalSleep', 'gojoChats', 'sleepChats',
        'antilink', 'antitag', 'antibot', 'antispam', 'antigm', 'antigcstatus',
        'antipromote', 'antidemote', 'antibug', 'antidelete', 'antigay', 'antiviewonce',
        'stickerCommands', 'welcome', 'goodbye', 'gcalerts', 'presence',
        'autoviewstatus', 'autoreactstatus', 'statusemoji',
        'afk', 'aliveMediaUrl', 'aliveMessage', 'gayList', 'casGlobalActive', 'urielGlobalActive', 'delCount', 'hushList', 'antihush', 'dominance', 'dominanceUntil'
];

// Per-bot keys that the main bot keeps persisting in its OWN place
// (storage/state.json, written by stateManager.js), so they are not in
// DYNAMIC_KEYS. They are still scoped per bot by the config.js Proxy: a
// sub-bot gets its own empty copy, saved in its own vars.json by
// persistActive(). This is what stops one bot's owners, sudos, bans and
// warnings from being read or changed by another bot.
const PER_BOT_KEYS = [
    'ownerJid', 'ownerLid', 'ownerLids',
    'secondaryOwners', 'sudos', 'sudoLids', 'banned', 'warns', 'aza',
    // live per-group message counters (see helpers/Infinity.js). They are
    // scoped per bot but never written to disk: ranks persist through
    // ActivityManager's levels.json instead.
    'totalMessages', 'dailyActivity'
];

// Scoped per bot, but left out of a sub-bot's vars.json.
const VOLATILE_KEYS = ['totalMessages', 'dailyActivity'];

const SCOPED_KEYS = [...DYNAMIC_KEYS, ...PER_BOT_KEYS];

module.exports = {
    MAIN_ID,
    setDefaults,
    setMainVars,
    getActiveVars,
    getActiveBotId,
    persistActive,
    runAsBot,
    forgetBot,
    DYNAMIC_KEYS,
    PER_BOT_KEYS,
    SCOPED_KEYS
};
