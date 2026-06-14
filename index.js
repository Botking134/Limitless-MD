// index.js

require('./converter');
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

// Helper to format system uptime
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}

// Boot up the Baileys WebSocket connection safely
startBot().then(() => {
    // Dynamic visual status card alignment values
    const sysName = "LIMITLESS-MD";
    const prefixVal = settings.prefix || "⚡";
    const uptimeStr = formatUptime(process.uptime());

    // Padding helper to keep the right border aligned
    const padLine = (content, targetLength) => {
        const currentLength = content.length;
        if (currentLength < targetLength) {
            return content + " ".repeat(targetLength - currentLength);
        }
        return content;
    };

    // Card construction with dynamic padding
    const sysContent  = padLine(`  ▶ SYSTEM :: ${sysName}`, 44);
    const prefContent = padLine(`  ▶ PREFIX :: ${prefixVal}`, 44);
    const uptContent  = padLine(`  ▶ UPTIME :: ${uptimeStr}`, 44);

    const statusCard = 
        `╔══════════════════════════════════════════════════╗\n` +
        `║             ⚡  ＣＯＮＮＥＣＴＥＤ ⚡             ║\n` +
        `╚══════════════════════════════════════════════════╝\n` +
        ` ╔════════════════════════════════════════════════╗\n` +
        ` ║${sysContent}║\n` +
        ` ║${prefContent}║\n` +
        ` ║${uptContent}║\n` +
        ` ╚════════════════════════════════════════════════╝\n` +
        ` ──────────────────────────────────────────────────\n` +
        ` ──  [ STATUS REPORT ] ────────────────────────────\n` +
        ` ──────────────────────────────────────────────────\n` +
        `   ⟫ 🔴 REVERSAL RED  :: CHARGED [100%]\n` +
        `   ⟫ 🔵 LAPSE BLUE    :: CHARGED [100%]\n` +
        `   ⟫ 🟣 HOLLOW PURPLE :: READY TO FIRE\n` +
        ` ──────────────────────────────────────────────────\n` +
        `   "Don't worry, I'm the strongest."\n` +
        ` ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    console.log(statusCard);
}).catch((error) => {
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