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
 * Stores the execute function AND metadata for Delta/Gojo.
 */
function register(cmd) {
    if (!cmd.name || typeof cmd.execute !== 'function') return;

    // Commands are always keyed by their bare name, never by
    // `${prefix}${name}`. This table is a single shared module-level object
    // used by the main bot AND every sub-bot socket — if the key baked in
    // whichever prefix happened to be "active" at register()/reload() time,
    // then one bot changing its prefix (which calls reload()) would silently
    // re-key commands for every other bot too, since they all read from this
    // same object. The dispatcher (helpers/Infinity.js) already strips
    // whatever prefix the user actually typed and looks commands up by bare
    // name, resolving the real prefix per-message via config.prefix (which
    // IS correctly scoped per-bot) — so the key here never needs a prefix.
    const key = cmd.name.toLowerCase();

    // Avoid overwriting core methods (like 'reload')
    if (key === 'reload') return;

    // ─── STORE METADATA (Critical for Delta/Gojo) ──────────────
    commands[key] = {
        execute: cmd.execute,
        metadata: {
            description: cmd.description || `${cmd.name} command`,
            category: cmd.category || 'tools',
            usage: cmd.usage || key,
            permission: cmd.permission || 'public',
            isPrefixless: cmd.isPrefixless || false
        }
    };
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

    console.log(`🔄 [LOADER] Recompiled all triggers (prefix-independent; current prefix: "${config.prefix}")`);
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

// Count total commands loaded (excluding the 'reload' method)
const commandCount = Object.keys(commands).filter(k => k !== 'reload').length;
console.log(`✅ [LOADER] Loaded ${commandCount} commands with prefix "${config.prefix}"`);