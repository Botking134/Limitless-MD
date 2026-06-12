// index.js

const { loadState } = require('./stateManager');
loadState(); // Restore persistent sudoers, owners, group modifications, and bans on boot

const { startBot } = require('./pair');
const settings = require('./settings');

console.clear(); // Clears the terminal screen for a clean look
console.log(`========================================`);
console.log(`⚡ INITIALIZING SYSTEM ENGINES...`);
console.log(`🤖 Bot Name: ${settings.botName}`);
console.log(`👑 Owner   : ${settings.ownerName}`);
console.log(`========================================\n`);

// Boot up the Baileys WebSocket connection safely
startBot().catch((error) => {
    console.error("[FATAL ERROR] Failed to ignite system engine:", error);
    process.exit(1);
});

// Global unhandled error catchers to prevent terminal crashes
process.on('unhandledRejection', (reason, promise) => {
    console.error("[SYSTEM WARNING] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on('uncaughtException', (err) => {
    console.error("[SYSTEM CRITICAL] Uncaught Exception thrown:", err);
});