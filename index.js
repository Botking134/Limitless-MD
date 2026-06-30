// index.js
const fs = require('fs');
const path = require('path');
const os = require('os');

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