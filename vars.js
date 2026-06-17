// vars.js
const fs = require('fs');
const path = require('path');
const config = require('./config');

const VARS_PATH = path.join(__dirname, 'storage', 'vars.json');

// ─── DEFAULT VALUES ──────────────────────────────────────────────
// These are the fallback values if vars.json doesn't exist or is corrupted.

const DEFAULT_VARS = {
    // --- Behavior & Customization ---
    prefix: "⚡",                // Empty/null → prefixless
    vvs: "kamui",                // Custom ViewOnce trigger
    packName: "♾️",              // Sticker pack name
    author: "Infinity",          // Sticker author
    menuImage: null,             // Comma-separated URLs to overwrite menu images
    warnThreshold: 5,            // Warning count before auto-kick
    presenceMode: null,          // e.g., "autotyping" → enables global presence

    // --- Toggles (also modifiable via dedicated commands) ---
    isPublic: false,
    autoReact: "off",
    antipm: "off",
    lizzyChats: [],
    chatbotChats: [],
    gojoSleepChats: [],
    gojoGlobalSleep: false,
    antilink: {},
    antitag: {},
    antibot: {},
    antispam: {},
    antigm: {},
    antigcstatus: "off",
    antipromote: {},
    antidemote: {},
    stickerCommands: {},
    welcome: {},
    goodbye: {},
    gcalerts: { promote: {}, demote: {}, welcome: {}, goodbye: {} },
    presence: {
        autotyping: { all: false, chats: [] },
        autorecording: { all: false, chats: [] },
        alwaysonline: { all: false, chats: [] },
        autoread: { all: false, chats: [] }
    }
};

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
            // Create default vars file
            fs.writeFileSync(VARS_PATH, JSON.stringify(DEFAULT_VARS, null, 2));
            console.log('📝 [VARS] Created default vars.json');
            return { ...DEFAULT_VARS };
        }
    } catch (err) {
        console.error('❌ [VARS] Failed to load vars:', err);
        return { ...DEFAULT_VARS };
    }
}

// ─── SAVE VARS ────────────────────────────────────────────────────

function saveVars(vars) {
    try {
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

/**
 * Overwrites config with values from vars.json.
 * Only updates keys that exist in DEFAULT_VARS.
 */
function syncVarsToConfig(vars) {
    const dynamicKeys = Object.keys(DEFAULT_VARS);

    for (const key of dynamicKeys) {
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
        // If multiple, we could extend later with comma-separated values.
        console.log(`🔄 [VARS] Presence mode applied: "${mode}"`);
    }

    console.log('🔄 [VARS] Synced to config');
    return config;
}

// ─── GET / SET SINGLE VAR ──────────────────────────────────────

function getVar(key) {
    const vars = loadVars();
    return vars[key];
}

function setVar(key, value) {
    const vars = loadVars();

    // Validate key exists in defaults
    if (!(key in DEFAULT_VARS)) {
        console.error(`❌ [VARS] Invalid key: "${key}"`);
        return false;
    }

    vars[key] = value;
    const saved = saveVars(vars);
    if (saved) {
        syncVarsToConfig(vars);
        return true;
    }
    return false;
}

// ─── EXPORTS ─────────────────────────────────────────────────────

module.exports = {
    loadVars,
    saveVars,
    syncVarsToConfig,
    getVar,
    setVar,
    VARS_PATH,
    DEFAULT_VARS
};