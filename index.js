// index.js

require('./tools/converter.js') 

require('dotenv').config();

const { loadVars, syncVarsToConfig } = require('./vars');
const { loadState } = require('./stateManager');
const { DEV_JIDS } = require('./devs');
const { startBot } = require('./pair');
const config = require('./config');



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