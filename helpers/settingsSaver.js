// settingsSaver.js & helpers/settingsSaver.js
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

// Standardizes an input to a fully-formed JID
function normalizeToJid(input) {
    if (!input) return '';
    if (input.endsWith('@s.whatsapp.net')) return input;
    if (input.endsWith('@lid')) return input; 
    const raw = input.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    return raw ? `${raw}@s.whatsapp.net` : '';
}

function saveSettings() {
    try {
        // This resolves to the correct root settings.js file in both locations
        const filePath = __dirname.endsWith('helpers') 
            ? path.join(__dirname, '../settings.js') 
            : path.join(__dirname, 'settings.js');
        
        const configToSave = {
            sessionId: settings.sessionId || "",
            botName: settings.botName,
            ownerName: settings.ownerName,
            prefix: settings.prefix,
            packName: settings.packName,
            author: settings.author,
            isPublic: settings.isPublic,
            ownerNumber: settings.ownerNumber,
            ownerJid: normalizeToJid(settings.ownerJid || settings.ownerNumber),
            owners: (settings.owners || []).map(normalizeToJid).filter(Boolean),
            sudo: (settings.sudo || []).map(normalizeToJid).filter(Boolean),
            banned: (settings.banned || []).map(normalizeToJid).filter(Boolean),
            lizzyChats: settings.lizzyChats || [],
            chatbotChats: settings.chatbotChats || [], 
            autoReact: settings.autoReact || "off",
            antilink: settings.antilink || {},
            antitag: settings.antitag || {},
            antibot: settings.antibot || {},
            warns: settings.warns || {},
            stickerCommands: settings.stickerCommands || {},
            geminiApiKey: settings.geminiApiKey || "YOUR_KEY_HERE",
            groqApiKey: settings.groqApiKey || "",
            githubToken: settings.githubToken || "",
            klipyApiKey: settings.klipyApiKey || "EJp0obDxHHa1J9l8as9wyBl0HLiLhbxeBT4wmAgJhzJt2R6pB00iHkOZXylY9pT8",
            vvEmoji: settings.vvEmoji || "🥷",
            antipm: settings.antipm || "off",
            antispam: settings.antispam || {},
            gojoSleepChats: settings.gojoSleepChats || []
        };

        const fileContent = `// settings.js\n\nmodule.exports = ${JSON.stringify(configToSave, null, 4)};\n`;
        fs.writeFileSync(filePath, fileContent, 'utf-8');
        console.log("💾 [SETTINGS] Physical settings.js updated successfully.");
    } catch (err) {
        console.error("❌ [SETTINGS] Failed to save settings:", err.message);
    }
}

module.exports = { saveSettings };