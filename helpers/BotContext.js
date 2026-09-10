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

function setDefaults(obj) {
    defaults = { ...obj };
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
        varsByBot.set(botId, botId === MAIN_ID ? { ...defaults } : (loadSubVars(botId) || { ...defaults }));
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
    return saveSubVars(botId, getActiveVars());
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

module.exports = {
    MAIN_ID,
    setDefaults,
    setMainVars,
    getActiveVars,
    getActiveBotId,
    persistActive,
    runAsBot,
    forgetBot,
    // Every config.js key that a command can change at runtime. Kept here
    // (instead of only in vars.js) so config.js can build its Proxy without
    // needing to require vars.js.
    DYNAMIC_KEYS: [
        'prefix', 'vvs', 'packName', 'author', 'menuImage', 'warnThreshold', 'presenceMode',
        'isPublic', 'autoReact', 'antipm', 'lizzyChats', 'chatbotChats', 'fridayChats',
        'gojoSleepChats', 'gojoGlobalSleep', 'gojoChats',
        'antilink', 'antitag', 'antibot', 'antispam', 'antigm', 'antigcstatus',
        'antipromote', 'antidemote', 'antibug', 'antidelete', 'antigay', 'antiviewonce',
        'stickerCommands', 'welcome', 'goodbye', 'gcalerts', 'presence',
        'autoviewstatus', 'autoreactstatus', 'statusemoji',
        'afk', 'aliveMediaUrl', 'aliveMessage', 'gayList', 'urielGlobalActive'
    ]
};
