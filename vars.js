// vars.js
const fs = require('fs');
const path = require('path');
const config = require('./config');

const VARS_PATH = path.join(__dirname, 'storage', 'vars.json');

// ─── LIST OF DYNAMIC KEYS (persisted in vars.json) ────────────
// These are the keys that can be changed via .setvar and other commands.
const DYNAMIC_KEYS = [
    'prefix',
    'vvs',
    'packName',
    'author',
    'menuImage',
    'warnThreshold',
    'presenceMode',
    'isPublic',
    'autoReact',
    'antipm',
    'lizzyChats',
    'chatbotChats',
    'fridayChats',
    'gojoSleepChats',
    'gojoGlobalSleep',
    'antilink',
    'antitag',
    'antibot',
    'antispam',
    'antigm',
    'antigcstatus',
    'antipromote',
    'antidemote',
    'stickerCommands',
    'welcome',
    'goodbye',
    'gcalerts',
    'presence'
];

// ─── LOAD VARS ────────────────────────────────────────────────────

function loadVars() {
    // Ensure storage directory exists
    const storageDir = path.dirname(VARS_PATH);
    if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }

    try {
        if (fs.existsSync(VARS_PATH)) {
            const data = JSON.parse(fs.readFileSync(VARS_PATH, 'utf8'));
            console.log('✅ [VARS] Loaded persistent variables');
            return data;
        } else {
            // No vars.json → create it from current config
            const initialVars = {};
            for (const key of DYNAMIC_KEYS) {
                if (config[key] !== undefined) {
                    initialVars[key] = config[key];
                }
            }
            fs.writeFileSync(VARS_PATH, JSON.stringify(initialVars, null, 2));
            console.log('📝 [VARS] Created vars.json from current config');
            return initialVars;
        }
    } catch (err) {
        console.error('❌ [VARS] Failed to load vars:', err);
        // Return current config values as fallback
        const fallback = {};
        for (const key of DYNAMIC_KEYS) {
            if (config[key] !== undefined) fallback[key] = config[key];
        }
        return fallback;
    }
}

// ─── SAVE DYNAMIC VARS (reads from config, writes to vars.json) ──

function saveDynamicVars() {
    try {
        const vars = {};
        for (const key of DYNAMIC_KEYS) {
            if (config[key] !== undefined) {
                vars[key] = config[key];
            }
        }
        const storageDir = path.dirname(VARS_PATH);
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        fs.writeFileSync(VARS_PATH, JSON.stringify(vars, null, 2));
        return true;
    } catch (err) {
        console.error('❌ [VARS] Failed to save vars:', err);
        return false;
    }
}

// ─── SYNC VARS → CONFIG ──────────────────────────────────────────

function syncVarsToConfig(vars) {
    if (!vars || typeof vars !== 'object') return config;

    for (const key of DYNAMIC_KEYS) {
        if (vars[key] !== undefined) {
            config[key] = vars[key];
        }
    }

    // ─── SPECIAL HANDLING ────────────────────────────────────────

    // 1. Prefix: if empty string or null, bot becomes prefixless
    if (config.prefix === null || config.prefix === '') {
        console.log('⚡ [VARS] Prefix is empty → bot is now prefixless.');
    }

    // 2. PresenceMode: if set, override presence.autotyping.all
    if (config.presenceMode) {
        const mode = config.presenceMode.toLowerCase().trim();
        if (mode === 'off') {
            config.presence.autotyping.all = false;
            config.presence.autorecording.all = false;
            config.presence.alwaysonline.all = false;
            config.presence.autoread.all = false;
        } else if (mode === 'autotyping') {
            config.presence.autotyping.all = true;
        } else if (mode === 'recording') {
            config.presence.autorecording.all = true;
        } else if (mode === 'online') {
            config.presence.alwaysonline.all = true;
        } else if (mode === 'autoread') {
            config.presence.autoread.all = true;
        }
        console.log(`🔄 [VARS] Presence mode applied: "${mode}"`);
    }

    console.log('🔄 [VARS] Synced to config');
    return config;
}

// ─── GET / SET SINGLE VAR ──────────────────────────────────────

function getVar(key) {
    // Return current value from config (which is already synced)
    return config[key];
}

function setVar(key, value) {
    const keyLower = key.toLowerCase();

    // Find the actual key in DYNAMIC_KEYS (case-insensitive)
    const matchingKey = DYNAMIC_KEYS.find(k => k.toLowerCase() === keyLower);
    if (!matchingKey) {
        console.error(`❌ [VARS] Invalid key: "${key}"`);
        return false;
    }

    // Update config
    config[matchingKey] = value;

    // Save to vars.json (auto-update all dynamic keys)
    return saveDynamicVars();
}

// ─── EXPORTS ─────────────────────────────────────────────────────

module.exports = {
    loadVars,
    saveDynamicVars,
    syncVarsToConfig,
    getVar,
    setVar,
    VARS_PATH,
    DYNAMIC_KEYS
};