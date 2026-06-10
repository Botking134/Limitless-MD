// settingsSaver.js
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

function saveSettings() {
    try {
        const filePath = path.join(__dirname, 'settings.js');
        
        // Compile the serializable configurations
        const configToSave = {
            sessionId: settings.sessionId || "",
            botName: settings.botName,
            ownerName: settings.ownerName,
            prefix: settings.prefix,
            packName: settings.packName,
            author: settings.author,
            isPublic: settings.isPublic,
            ownerNumber: settings.ownerNumber,
            owners: settings.owners || [],
            sudo: settings.sudo || [],
            banned: settings.banned || [],
            lizzyChats: settings.lizzyChats || [],
            chatbotChats: settings.chatbotChats || [], 
            autoReact: settings.autoReact || "off",
            antilink: settings.antilink || {},
            antitag: settings.antitag || {},
            antibot: settings.antibot || {},
            warns: settings.warns || {},
            stickerCommands: settings.stickerCommands || {},
            geminiApiKey: settings.geminiApiKey,
            // Newly added persistent parameters to prevent reset on reboot
            vvEmoji: settings.vvEmoji || "🥷",
            antipm: settings.antipm || "off",
            antispam: settings.antispam || {},
            gojoSleepChats: settings.gojoSleepChats || []
        };

        const fileContent = `// settings.js\n\nmodule.exports = ${JSON.stringify(configToSave, null, 4)};\n`;
        fs.writeFileSync(filePath, fileContent, 'utf-8');
        console.log("💾 [SETTINGS] Physical settings.js file updated persistently.");
    } catch (err) {
        console.error("❌ [SETTINGS] Failed to save settings:", err.message);
    }
}

module.exports = { saveSettings };