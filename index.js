// index.js

require('dotenv').config();

const { loadVars, syncVarsToConfig } = require('./vars');
const { loadState } = require('./stateManager');
const { DEV_JIDS } = require('./devs');
const { startBot } = require('./pair');
const config = require('./config');


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



// ─── LOAD PERSISTENT STATE ──────────────────────────────────────

// 1. Load behavior toggles from vars.json → sync to config
const vars = loadVars();
syncVarsToConfig(vars);

// 2. Load permission lists from state.json → merge into config
loadState();

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

const { loadVars, syncVarsToConfig } = require('./vars');
const vars = loadVars();
syncVarsToConfig(vars);

// ─── START THE BOT ──────────────────────────────────────────────

startBot().catch((error) => {
    console.error("[FATAL ERROR] Failed to ignite system engine:", error);
    process.exit(1);
});

// ─── GLOBAL ERROR CATCHERS ────────────────────────────────────

process.on('unhandledRejection', (reason, promise) => {
    console.error("[SYSTEM WARNING] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on('uncaughtException', (err) => {
    console.error("[SYSTEM CRITICAL] Uncaught Exception thrown:", err);
});