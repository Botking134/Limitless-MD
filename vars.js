// vars.js
const fs = require('fs');
const path = require('path');
const config = require('./config');

const VARS_PATH = path.join(__dirname, 'storage', 'vars.json');

// ─── LIST OF DYNAMIC KEYS (persisted in vars.json) ────────────
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

// ─── LOAD VARS (BIDIRECTIONAL SYNC) ─────────────────────────────

function loadVars() {
    const storageDir = path.dirname(VARS_PATH);
    if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }

    // Get config.js modification time
    const configPath = path.join(__dirname, 'config.js');
    const configStat = fs.existsSync(configPath) ? fs.statSync(configPath) : null;
    const configMtime = configStat ? configStat.mtimeMs : 0;

    let vars = {};
    let varsExist = false;

    // Try to load vars.json
    if (fs.existsSync(VARS_PATH)) {
        try {
            const data = JSON.parse(fs.readFileSync(VARS_PATH, 'utf8'));
            vars = data;
            varsExist = true;
            console.log('✅ [VARS] Loaded persistent variables');
        } catch (err) {
            console.error('❌ [VARS] Failed to parse vars.json:', err);
        }
    }

    // Get vars.json modification time
    const varsStat = fs.existsSync(VARS_PATH) ? fs.statSync(VARS_PATH) : null;
    const varsMtime = varsStat ? varsStat.mtimeMs : 0;

    // ─── BIDIRECTIONAL SYNC LOGIC ──────────────────────────────

    // If vars.json doesn't exist, create it from config
    if (!varsExist) {
        console.log('📝 [VARS] Creating vars.json from config.js...');
        const initialVars = {};
        for (const key of DYNAMIC_KEYS) {
            if (config[key] !== undefined) {
                initialVars[key] = config[key];
            }
        }
        fs.writeFileSync(VARS_PATH, JSON.stringify(initialVars, null, 2));
        return initialVars;
    }

    // If vars.json exists and config.js is newer, update vars.json from config.js
    if (configMtime > varsMtime) {
        console.log('🔄 [VARS] config.js is newer → updating vars.json from config.js...');
        const updatedVars = {};
        for (const key of DYNAMIC_KEYS) {
            if (config[key] !== undefined) {
                updatedVars[key] = config[key];
            }
        }
        // Merge with existing vars.json for keys that exist there but not in config
        for (const key of Object.keys(vars)) {
            if (!(key in updatedVars)) {
                updatedVars[key] = vars[key];
            }
        }
        fs.writeFileSync(VARS_PATH, JSON.stringify(updatedVars, null, 2));
        return updatedVars;
    }

    // If vars.json is newer, it will override config in syncVarsToConfig
    console.log('🔄 [VARS] vars.json is newer → will override config.js values');
    return vars;
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
    // Return current value from config
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