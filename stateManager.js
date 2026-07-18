// stateManager.js
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { DEV_LIDS } = require('./plugins/devs');

// ─── Load vars module for dynamic variable persistence ─────────
const { saveDynamicVars } = require('./vars');

const STATE_PATH = path.join(__dirname, 'storage', 'state.json');

global.lidCache = global.lidCache || {};

function normalizeToJid(input) {
    if (!input) return '';
    const clean = input.replace(/:[\d]+@/, '@');
    if (clean.endsWith('@s.whatsapp.net')) return clean;
    if (clean.endsWith('@lid')) return clean;
    const raw = clean.split('@')[0].replace(/[^0-9]/g, '');
    return raw ? `${raw}@s.whatsapp.net` : '';
}

async function getPhoneJid(sock, jid, groupJid = null) {
    if (!jid) return '';
    const cleanJid = normalizeToJid(jid);
    if (!cleanJid) return '';
    if (cleanJid.endsWith('@s.whatsapp.net')) return cleanJid;
    if (global.lidCache[cleanJid]) return global.lidCache[cleanJid];

    if (groupJid) {
        try {
            const metadata = await sock.groupMetadata(groupJid);
            const participant = metadata?.participants?.find(p => {
                const pLid = p.lid ? normalizeToJid(p.lid) : '';
                return pLid === cleanJid || normalizeToJid(p.id) === cleanJid;
            });
            if (participant) {
                const resolved = normalizeToJid(participant.id);
                if (resolved && resolved.endsWith('@s.whatsapp.net')) {
                    global.lidCache[cleanJid] = resolved;
                    return resolved;
                }
            }
        } catch (e) { /* ignore */ }
    }

    try {
        const resolved = await sock.findUserId(cleanJid);
        if (resolved && resolved.phoneNumber) {
            const phoneJid = `${resolved.phoneNumber}@s.whatsapp.net`;
            global.lidCache[cleanJid] = phoneJid;
            return phoneJid;
        }
    } catch (e) { /* ignore */ }

    return cleanJid;
}

function loadState() {
    const storageDir = path.dirname(STATE_PATH);
    if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }

    // ─── Set Dev LIDs from hardcoded devs.js ────────────────────
    config.devLids = [...DEV_LIDS];

    config.ownerLids = config.ownerLids || [];
    config.sudoLids = config.sudoLids || [];
    config.secondaryOwners = config.secondaryOwners || [];
    config.sudos = config.sudos || [];
    config.banned = config.banned || [];
    config.warns = config.warns || {};
    config.aza = config.aza || { set: false };

    if (config.ownerNumber && !config.ownerJid) {
        config.ownerJid = normalizeToJid(config.ownerNumber);
    }

    try {
        if (fs.existsSync(STATE_PATH)) {
            const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));

            const stateKeys = [
                'secondaryOwners', 'sudos', 'banned',
                'ownerLid', 'ownerLids', 'devLids', 'sudoLids',
                'warns', 'aza'
            ];

            for (const key of stateKeys) {
                if (data[key] !== undefined) {
                    if (Array.isArray(data[key]) && Array.isArray(config[key])) {
                        const merged = [...new Set([...config[key], ...data[key]])];
                        config[key] = merged;
                    } else if (typeof data[key] === 'object' && data[key] !== null) {
                        config[key] = { ...config[key], ...data[key] };
                    } else {
                        config[key] = data[key];
                    }
                }
            }

            // Ensure devLids never get wiped
            if (data.devLids && Array.isArray(data.devLids)) {
                data.devLids.forEach(lid => {
                    if (!config.devLids.includes(lid)) config.devLids.push(lid);
                });
            }

            console.log('✅ [STATE] Loaded permissions from state.json');
        } else {
            fs.writeFileSync(STATE_PATH, JSON.stringify({
                secondaryOwners: [],
                sudos: [],
                banned: [],
                ownerLid: "",
                ownerLids: [],
                devLids: [...DEV_LIDS],
                sudoLids: [],
                warns: {},
                aza: { set: false }
            }, null, 2));
            console.log('📝 [STATE] Created default state.json');
        }
    } catch (err) {
        console.error('❌ [STATE] Failed to load state:', err.message);
    }
}

function saveState() {
    try {
        const storageDir = path.dirname(STATE_PATH);
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }

        const stateData = {
            secondaryOwners: (config.secondaryOwners || []).map(normalizeToJid).filter(Boolean),
            sudos: (config.sudos || []).map(normalizeToJid).filter(Boolean),
            banned: (config.banned || []).map(normalizeToJid).filter(Boolean),
            ownerLid: config.ownerLid || "",
            ownerLids: config.ownerLids || [],
            devLids: [...DEV_LIDS], // Always overwrite with hardcoded LIDs
            sudoLids: config.sudoLids || [],
            warns: config.warns || {},
            aza: config.aza || { set: false }
        };

        fs.writeFileSync(STATE_PATH, JSON.stringify(stateData, null, 2), 'utf-8');

        // ─── Also sync dynamic variables to vars.json ───────────
        try {
            saveDynamicVars();
        } catch (e) {
            console.warn('⚠️ [STATE] Could not save dynamic vars:', e.message);
        }

        return true;
    } catch (err) {
        console.error('❌ [STATE] Failed to save state:', err.message);
        return false;
    }
}

function addSecondaryOwner(jid) {
    const normalized = normalizeToJid(jid);
    if (!normalized) return false;
    if (!config.secondaryOwners.includes(normalized)) {
        config.secondaryOwners.push(normalized);
        saveState();
        return true;
    }
    return false;
}

function removeSecondaryOwner(jid) {
    const normalized = normalizeToJid(jid);
    if (!normalized) return false;
    const index = config.secondaryOwners.indexOf(normalized);
    if (index !== -1) {
        config.secondaryOwners.splice(index, 1);
        saveState();
        return true;
    }
    return false;
}

function addSudo(jid) {
    const normalized = normalizeToJid(jid);
    if (!normalized) return false;
    if (!config.sudos.includes(normalized)) {
        config.sudos.push(normalized);
        saveState();
        return true;
    }
    return false;
}

function removeSudo(jid) {
    const normalized = normalizeToJid(jid);
    if (!normalized) return false;
    const index = config.sudos.indexOf(normalized);
    if (index !== -1) {
        config.sudos.splice(index, 1);
        saveState();
        return true;
    }
    return false;
}

function addBan(jid) {
    const normalized = normalizeToJid(jid);
    if (!normalized) return false;
    if (!config.banned.includes(normalized)) {
        config.banned.push(normalized);
        saveState();
        return true;
    }
    return false;
}

function removeBan(jid) {
    const normalized = normalizeToJid(jid);
    if (!normalized) return false;
    const index = config.banned.indexOf(normalized);
    if (index !== -1) {
        config.banned.splice(index, 1);
        saveState();
        return true;
    }
    return false;
}

module.exports = {
    loadState,
    saveState,
    normalizeToJid,
    getPhoneJid,
    addSecondaryOwner,
    removeSecondaryOwner,
    addSudo,
    removeSudo,
    addBan,
    removeBan
};