// commands.js
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

// Assign commands directly to module.exports to resolve circular dependency disconnects
const commands = module.exports;
const pluginsDir = path.join(__dirname, 'plugins');

if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir);
}

// Helper function to recursively find all JS files in any subdirectory
function getFilesRecursive(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getFilesRecursive(filePath));
        } else if (file.endsWith('.js')) {
            results.push(filePath);
        }
    });
    return results;
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

// 🔄 HOT-RELOAD REGISTRY REBUILDER
// Dynamically decaches and rebuilds all command triggers in real-time
function reloadCommands() {
    // Clear all existing command mappings except our special hidden reload handler
    for (const key in commands) {
        if (key !== 'reload') {
            delete commands[key];
        }
    }

    const pluginFiles = getFilesRecursive(pluginsDir);

    for (const filePath of pluginFiles) {
        try {
            // Decache the file so Node pulls the newly written settings/updates
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
    console.log(`🔄 [LOADER] Recompiled all triggers under active prefix: "${settings.prefix}"`);
}

// Initial Boot Loader
const pluginFiles = getFilesRecursive(pluginsDir);
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

// Attach the hidden reload method directly on the exported object
commands.reload = reloadCommands;