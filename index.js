// index.js
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── SILENCE LIBSIGNAL'S RAW SESSION DEBUG DUMPS ───────────────────
// Both the main bot's and every sub-bot's makeWASocket() already pass a
// pino logger at level 'silent' — but this dump ("Closing session:
// SessionEntry { ... }", full of raw key Buffers) is still showing up, which
// means it isn't coming through that pino logger at all. It's the
// libsignal-node dependency Baileys uses for the Signal protocol calling
// console.log directly on every session close/replace — something that
// happens constantly while a sub-bot is pairing (fresh sessions get
// renegotiated over and over), which is exactly why it was only showing up
// on sub-bot connect and not on the already-stable main bot connection.
// Dumping that much data to stdout on every single one of those events is
// also real, unnecessary CPU/I/O overhead, not just log noise. This can't be
// fixed inside node_modules (npm install wipes any edit there), so it's
// filtered at the console level instead — anything else still logs normally.
const NOISY_LOG_PATTERNS = [/^Closing session:/, /^Opening session:/, /^SessionEntry/];
for (const method of ['log', 'info', 'debug']) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
        const first = args[0];
        if (typeof first === 'string' && NOISY_LOG_PATTERNS.some(p => p.test(first))) return;
        original(...args);
    };
}

// ─── REDIRECT TEMPORARY DIRECTORY ──────────────────────────────────
// Forces all temporary processes (like stickers or ffmpeg conversions)
// to utilize your main 6GB disk space, preventing virtual /tmp partition ENOSPC errors.
const localTempPath = path.join(__dirname, './storage/temp');
try {
    if (!fs.existsSync(localTempPath)) {
        fs.mkdirSync(localTempPath, { recursive: true });
    }
    os.tmpdir = () => localTempPath;
} catch (e) {
    console.error("Failed to redirect temporary directory path:", e);
}

const config = require('./config');
const { loadVars, syncVarsToConfig } = require('./vars');
const { loadState } = require('./stateManager');

// ─── LOAD PERSISTENT STATE (must happen before anything scans/registers
// commands) ────────────────────────────────────────────────────────────
// commands.js builds every command's registry key from config.prefix at the
// moment it's first required — e.g. "!antispam" — and that key is baked in
// for the whole process (only a manual .reload rebuilds it). Previously
// require('./server') below (which pulls in commands.js) ran BEFORE this,
// so every command was registered under config.js's hardcoded default
// prefix ("/") instead of whatever you'd actually saved via .setvar — the
// live parser was checking incoming messages against your real saved
// prefix while the registry underneath it was keyed on a different one
// entirely. Loading vars/state first means config.prefix is already correct
// by the time anything requires commands.js.
const vars = loadVars();            // ← auto-syncs config.js ↔ vars.json
syncVarsToConfig(vars);             // ← Overrides config with vars.json values
loadState();                        // ← Load permission lists from state.json → merge into config

const { DEV_JIDS } = require('./plugins/devs');
const { startBot } = require('./pair');
const { createServer } = require('./server');

// ─── TEMPORARY LOG CAPTURE ──────────────────────────────────────
global.recentLogs = global.recentLogs || [];
const MAX_LOGS = 100;

const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

function pushLog(level, args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    global.recentLogs.push({ time: new Date().toISOString(), level, message: msg });
    if (global.recentLogs.length > MAX_LOGS) global.recentLogs.shift();
}

console.log = (...a) => { pushLog('INFO', a); origLog(...a); };
console.warn = (...a) => { pushLog('WARN', a); origWarn(...a); };
console.error = (...a) => { pushLog('ERROR', a); origError(...a); };

// ─── IGNITION ──────────────────────────────────────────────────

console.clear();
console.log(`========================================`);
console.log(`⚡ INITIALIZING SYSTEM ENGINES...`);
console.log(`🤖 Bot Name: ${config.botName}`);
console.log(`👑 Owner   : ${config.ownerName}`);
console.log(`⚡ Prefix  : ${config.prefix || '(prefixless)'}`);
console.log(`🛡️ Devs    : ${DEV_JIDS.length} hardcoded`);
console.log(`📦 Owners  : ${config.secondaryOwners.length} secondary`);
console.log(`🛡️ Sudos   : ${config.sudos.length} registered`);
console.log(`========================================\n`);

// ─── START WEB CONSOLE & BOT ────────────────────────────────────

try {
    createServer();
} catch (webErr) {
    console.error("[ERROR] Failed to start web console:", webErr);
}

startBot().catch((error) => {
    console.error("[FATAL ERROR] Failed to ignite system engine:", error);
});

// ─── GLOBAL ERROR CATCHERS ────────────────────────────────────

process.on('unhandledRejection', (reason, promise) => {
    console.error("[SYSTEM WARNING] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on('uncaughtException', (err) => {
    console.error("[SYSTEM CRITICAL] Uncaught Exception thrown:", err);
});