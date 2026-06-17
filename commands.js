// commands.js
const fs = require('fs');
const path = require('path');
const config = require('./config');

// ─── EXPORT MAP ──────────────────────────────────────────────────
// We assign commands directly to module.exports so they can be
// dynamically reloaded without breaking references.
const commands = module.exports;

// ─── PLUGINS DIRECTORY ──────────────────────────────────────────
const pluginsDir = path.join(__dirname, 'plugins');

// Ensure plugins directory exists
if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
}

// ─── FILE SCANNER ────────────────────────────────────────────────
/**
 * Recursively finds all .js files in a directory.
 */
function getFilesRecursive(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;

    const list = fs.readdirSync(dir);
    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getFilesRecursive(filePath));
        } else if (file.endsWith('.js')) {
            results.push(filePath);
        }
    }
    return results;
}

// ─── COMMAND REGISTRATION ────────────────────────────────────────
/**
 * Registers a single command into the exports map.
 * If the command is prefixless, it's stored as-is.
 * Otherwise, it's prefixed with config.prefix.
 */
function register(cmd) {
    if (!cmd.name || typeof cmd.execute !== 'function') return;

    const key = cmd.isPrefixless
        ? cmd.name.toLowerCase()
        : `${config.prefix}${cmd.name.toLowerCase()}`;

    // Avoid overwriting core methods (like 'reload')
    if (key === 'reload') return;

    commands[key] = cmd.execute;
}

// ─── HOT RELOAD ──────────────────────────────────────────────────
/**
 * Clears all registered commands (except the 'reload' method itself)
 * and re-scans the plugins directory to re-register everything.
 * This allows live updates without restarting the bot.
 */
function reloadCommands() {
    // Clear everything except the 'reload' function itself
    for (const key in commands) {
        if (key !== 'reload') {
            delete commands[key];
        }
    }

    const pluginFiles = getFilesRecursive(pluginsDir);

    for (const filePath of pluginFiles) {
        try {
            // Remove from require cache to get fresh copy
            delete require.cache[require.resolve(filePath)];

            const plugin = require(filePath);
            if (Array.isArray(plugin)) {
                plugin.forEach(cmd => register(cmd));
            } else {
                register(plugin);
            }
        } catch (error) {
            console.error(`⚠️ Failed to load plugin [${path.basename(filePath)}]:`, error.message);
        }
    }

    console.log(`🔄 [LOADER] Recompiled all triggers under prefix: "${config.prefix}"`);
}

// ─── INITIAL BOOT LOAD ──────────────────────────────────────────
console.log(`📦 [LOADER] Scanning plugins in: ${pluginsDir}`);

const pluginFiles = getFilesRecursive(pluginsDir);

if (pluginFiles.length === 0) {
    console.log(`⚠️ [LOADER] No plugins found in /plugins. Place your .js command files there.`);
}

for (const filePath of pluginFiles) {
    try {
        const plugin = require(filePath);
        if (Array.isArray(plugin)) {
            plugin.forEach(cmd => register(cmd));
        } else {
            register(plugin);
        }
    } catch (error) {
        console.error(`⚠️ Failed to load plugin [${path.basename(filePath)}]:`, error.message);
    }
}

// ─── ATTACH RELOAD METHOD ────────────────────────────────────────
commands.reload = reloadCommands;

console.log(`✅ [LOADER] Loaded ${Object.keys(commands).length - 1} commands with prefix "${config.prefix}"`);