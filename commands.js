// commands.js
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const commands = {};
const pluginsDir = path.join(__dirname, 'plugins');

if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir);
}

// Helper function to register a command in our system
function register(cmd) {
    if (cmd.name && typeof cmd.execute === 'function') {
        const key = cmd.isPrefixless 
            ? cmd.name.toLowerCase() 
            : `${settings.prefix}${cmd.name.toLowerCase()}`;
            
        commands[key] = cmd.execute;
    }
}

// 🔄 HOT-RELOAD REGISTRY REBUILDER [1]
// Dynamically decaches and rebuilds all command triggers in real-time [1]
function reloadCommands() {
    // Clear all existing command mappings except our special hidden reload handler [1]
    for (const key in commands) {
        if (key !== 'reload') {
            delete commands[key];
        }
    }

    const pluginFiles = fs.readdirSync(pluginsDir).filter(file => file.endsWith('.js'));

    for (const file of pluginFiles) {
        try {
            const pluginPath = path.join(pluginsDir, file);
            
            // Decache the file so Node pulls the newly written settings/updates [1]
            delete require.cache[require.resolve(pluginPath)];
            
            const plugin = require(pluginPath);
            if (Array.isArray(plugin)) {
                plugin.forEach(cmd => register(cmd));
            } else {
                register(plugin);
            }
        } catch (error) {
            console.error(`⚠️ Failed to load plugin [${file}]:`, error.message);
        }
    }
    console.log(`🔄 [LOADER] Recompiled all triggers under active prefix: "${settings.prefix}"`);
}

// Initial Boot Loader
const pluginFiles = fs.readdirSync(pluginsDir).filter(file => file.endsWith('.js'));
for (const file of pluginFiles) {
    try {
        const plugin = require(path.join(pluginsDir, file));
        if (Array.isArray(plugin)) {
            plugin.forEach(cmd => register(cmd));
        } else {
            register(plugin);
        }
    } catch (error) {
        console.error(`⚠️ Failed to load plugin [${file}]:`, error.message);
    }
}

// Attach the hidden reload method directly on the exported object [1]
commands.reload = reloadCommands;

module.exports = commands;