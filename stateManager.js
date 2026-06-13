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

global.lidCache = global.lidCache || {};

// Upgraded normalizeToJid using a safe RegExp to strip device colons without losing the domain suffix
function normalizeToJid(input) {
    if (!input) return '';
    const clean = input.replace(/:[\d]+@/, '@'); // Safely converts '123:1@lid' into '123@lid'
    if (clean.endsWith('@s.whatsapp.net')) return clean;
    if (clean.endsWith('@lid')) return clean; 
    const raw = clean.split('@')[0].replace(/[^0-9]/g, '');
    return raw ? `${raw}@s.whatsapp.net` : '';
}

// Relocated getPhoneJid helper here to break the circular dependency loop completely
async function getPhoneJid(sock, jid, groupJid = null) {
    if (!jid) return '';
    let clean = jid.split(':')[0].split('@')[0];
    
    if (jid.endsWith('@lid')) {
        if (global.lidCache[jid]) return global.lidCache[jid];
        
        // Quick Scan: Try to resolve instantly using the group participants cache
        if (groupJid) {
            try {
                const metadata = await sock.groupMetadata(groupJid);
                const participant = metadata?.participants?.find(
                    p => p.lid === jid || p.id.split(':')[0] === jid.split(':')[0]
                );
                if (participant && participant.id.endsWith('@s.whatsapp.net')) {
                    const resolvedJid = participant.id.split(':')[0] + '@s.whatsapp.net';
                    global.lidCache[jid] = resolvedJid;
                    return resolvedJid;
                }
            } catch (e) {}
        }

        // Fallback: Query the network
        try {
            const resolved = await sock.findUserId(jid);
            if (resolved && resolved.phoneNumber) {
                const phoneJid = `${resolved.phoneNumber}@s.whatsapp.net`;
                global.lidCache[jid] = phoneJid;
                return phoneJid;
            }
        } catch (e) {}
    }
    return `${clean}@s.whatsapp.net`;
}

function loadState() {
    settings.devs = [...BASE_DEVS];
    settings.devLids = settings.devLids || [];
    settings.ownerLids = settings.ownerLids || [];
    settings.sudoLids = settings.sudoLids || [];

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

        console.log("📂 [STATE] Standardized and loaded configuration state using full JIDs and LIDs.");
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
            ownerLid: settings.ownerLid || "",
            owners: (settings.owners || []).map(normalizeToJid).filter(Boolean),
            ownerLids: settings.ownerLids || [],
            sudo: (settings.sudo || []).map(normalizeToJid).filter(Boolean),
            sudoLids: settings.sudoLids || [],
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

module.exports = { loadState, saveState, normalizeToJid, getPhoneJid };