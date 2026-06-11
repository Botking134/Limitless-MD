// stateManager.js
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const statePath = path.join(__dirname, 'state.json');

// Hardcoded Developer Supreme Creator Numbers (Completely hidden from settings.js)
const BASE_DEVS = ["27713655070", "601129363700", "2347059092107", "2347040401291"];

function loadState() {
    // Initialize memory settings with the base developer list on boot
    settings.devs = [...BASE_DEVS];
    settings.devLids = [];
    
    try {
        if (fs.existsSync(statePath)) {
            const data = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
            
            // Merge loaded state
            Object.assign(settings, data);
            
            // Ensure core base developers are always present
            if (Array.isArray(settings.devs)) {
                BASE_DEVS.forEach(num => {
                    if (!settings.devs.includes(num)) {
                        settings.devs.push(num);
                    }
                });
            } else {
                settings.devs = [...BASE_DEVS];
            }
            console.log("📂 [STATE] Loaded persistent state from state.json");
        }
    } catch (err) {
        console.error("❌ [STATE] Failed to load state:", err.message);
    }
}

function saveState() {
    try {
        const stateData = {
            sessionId: settings.sessionId || "",
            isPublic: settings.isPublic,
            owners: settings.owners,
            sudo: settings.sudo,
            banned: settings.banned,
            devs: settings.devs,
            devLids: settings.devLids || [], // dev LIDs integrated directly into main state JSON
            autoReact: settings.autoReact,
            antilink: settings.antilink,
            antitag: settings.antitag,
            antibot: settings.antibot,
            warns: settings.warns,
            stickerCommands: settings.stickerCommands,
            afk: settings.afk || {},
            lizzyChats: settings.lizzyChats || [],
            chatbotChats: settings.chatbotChats || [],
            gojoSleepChats: settings.gojoSleepChats || []
        };
        fs.writeFileSync(statePath, JSON.stringify(stateData, null, 2), 'utf-8');
    } catch (err) {
        console.error("❌ [STATE] Failed to save state:", err.message);
    }
}

module.exports = { loadState, saveState };