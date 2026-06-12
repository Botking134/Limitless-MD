// stateManager.js
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const statePath = path.join(__dirname, 'state.json');

// Standardized Core Developer JIDs as full JIDs
const BASE_DEVS = [
    "27713655070@s.whatsapp.net", 
    "601129363700@s.whatsapp.net", 
    "2347059092107@s.whatsapp.net", 
    "2347040401291@s.whatsapp.net"
];

function normalizeToJid(input) {
    if (!input) return '';
    if (input.endsWith('@s.whatsapp.net')) return input;
    if (input.endsWith('@lid')) return input; 
    const raw = input.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    return raw ? `${raw}@s.whatsapp.net` : '';
}

function loadState() {
    settings.devs = [...BASE_DEVS];
    settings.devLids = settings.devLids || [];

    if (settings.ownerNumber) {
        settings.ownerJid = normalizeToJid(settings.ownerNumber);
    }
    
    try {
        if (fs.existsSync(statePath)) {
            const data = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
            
            for (const key in data) {
                if (data[key] !== undefined) {
                    if (Array.isArray(data[key]) && Array.isArray(settings[key])) {
                        const merged = [...new Set([...settings[key], ...data[key]])];
                        settings[key] = merged;
                    } else {
                        if (settings[key] !== undefined && settings[key] !== "" && (data[key] === undefined || data[key] === "")) {
                            continue;
                        }
                        settings[key] = data[key];
                    }
                }
            }
        }

        // Standardize list arrays to use full JIDs on boot
        if (Array.isArray(settings.owners)) {
            settings.owners = settings.owners.map(normalizeToJid).filter(Boolean);
        } else {
            settings.owners = [];
        }

        if (Array.isArray(settings.sudo)) {
            settings.sudo = settings.sudo.map(normalizeToJid).filter(Boolean);
        } else {
            settings.sudo = [];
        }

        if (Array.isArray(settings.banned)) {
            settings.banned = settings.banned.map(normalizeToJid).filter(Boolean);
        } else {
            settings.banned = [];
        }

        if (Array.isArray(settings.devs)) {
            settings.devs = settings.devs.map(normalizeToJid).filter(Boolean);
        }

        // Ensure baseline developers are always included
        BASE_DEVS.forEach(num => {
            if (!settings.devs.includes(num)) {
                settings.devs.push(num);
            }
        });

        console.log("📂 [STATE] Standardized and loaded configuration state using full JIDs.");
    } catch (err) {
        console.error("❌ [STATE] Failed to load state:", err.message);
    }
}

function saveState() {
    try {
        const stateData = {
            sessionId: settings.sessionId || "",
            isPublic: settings.isPublic,
            ownerJid: normalizeToJid(settings.ownerJid || settings.ownerNumber),
            owners: (settings.owners || []).map(normalizeToJid).filter(Boolean),
            sudo: (settings.sudo || []).map(normalizeToJid).filter(Boolean),
            banned: (settings.banned || []).map(normalizeToJid).filter(Boolean),
            devs: (settings.devs || []).map(normalizeToJid).filter(Boolean),
            devLids: settings.devLids || [],
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

module.exports = { loadState, saveState, normalizeToJid };