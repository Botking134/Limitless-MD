// stateManager.js
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { DEV_JIDS, DEV_LIDS } = require('./devs');

const STATE_PATH = path.join(__dirname, 'storage', 'state.json');

// ─── GLOBAL LID CACHE ────────────────────────────────────────────
// Used to store resolved LID → Phone JID mappings to reduce network calls.
global.lidCache = global.lidCache || {};

// ─── JID NORMALIZER ─────────────────────────────────────────────
/**
 * Cleans and normalizes any JID or LID string.
 * - Removes device colons (e.g., "123:1@lid" → "123@lid")
 * - Returns input as-is if it's a valid JID or LID.
 * - Strips non-numeric characters and appends @s.whatsapp.net if it looks like a number.
 */
function normalizeToJid(input) {
    if (!input) return '';
    const clean = input.replace(/:[\d]+@/, '@'); // '123:1@lid' → '123@lid'
    if (clean.endsWith('@s.whatsapp.net')) return clean;
    if (clean.endsWith('@lid')) return clean;
    const raw = clean.split('@')[0].replace(/[^0-9]/g, '');
    return raw ? `${raw}@s.whatsapp.net` : '';
}

// ─── LID → PHONE JID RESOLVER ──────────────────────────────────
/**
 * Resolves a LID (@lid) to a phone JID (@s.whatsapp.net).
 * Uses group metadata cache first, then falls back to sock.findUserId().
 */
async function getPhoneJid(sock, jid, groupJid = null) {
    if (!jid) return '';
    const cleanJid = normalizeToJid(jid);
    if (!cleanJid) return '';

    // If already a phone JID, return it.
    if (cleanJid.endsWith('@s.whatsapp.net')) return cleanJid;

    // Check cache
    if (global.lidCache[cleanJid]) return global.lidCache[cleanJid];

    // Try group metadata first (fast)
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

    // Fallback: network query
    try {
        const resolved = await sock.findUserId(cleanJid);
        if (resolved && resolved.phoneNumber) {
            const phoneJid = `${resolved.phoneNumber}@s.whatsapp.net`;
            global.lidCache[cleanJid] = phoneJid;
            return phoneJid;
        }
    } catch (e) { /* ignore */ }

    // If all fails, return the LID itself (maybe it's already a phone JID that wasn't caught).
    return cleanJid;
}

// ─── LOAD STATE ──────────────────────────────────────────────────

function loadState() {
    // Ensure storage directory exists
    const storageDir = path.dirname(STATE_PATH);
    if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }

    // Ensure Devs are present in config (though we use DEV_JIDS directly in handlers,
    // keeping them here for legacy/fallback).
    if (!Array.isArray(config.devs)) {
        config.devs = [...DEV_JIDS];
    } else {
        DEV_JIDS.forEach(dev => {
            if (!config.devs.includes(dev)) config.devs.push(dev);
        });
    }

    // Initialize arrays
    config.devLids = config.devLids || [];
    config.ownerLids = config.ownerLids || [];
    config.sudoLids = config.sudoLids || [];
    config.secondaryOwners = config.secondaryOwners || [];
    config.sudos = config.sudos || [];
    config.banned = config.banned || [];
    config.warns = config.warns || {};
    config.conversationLogs = config.conversationLogs || {};
    config.gclogActive = config.gclogActive || {};
    config.aza = config.aza || { set: false };

    // Resolve owner JID from number if needed
    if (config.ownerNumber && !config.ownerJid) {
        config.ownerJid = normalizeToJid(config.ownerNumber);
    }

    try {
        if (fs.existsSync(STATE_PATH)) {
            const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));

            // Merge saved data into config
            const stateKeys = [
                'secondaryOwners', 'sudos', 'banned',
                'ownerLid', 'ownerLids', 'devLids', 'sudoLids',
                'warns', 'conversationLogs', 'aza', 'gclogActive'
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
            // Create default state file
            fs.writeFileSync(STATE_PATH, JSON.stringify({
                secondaryOwners: [],
                sudos: [],
                banned: [],
                ownerLid: "",
                ownerLids: [],
                devLids: [],
                sudoLids: [],
                warns: {},
                conversationLogs: {},
                aza: { set: false },
                gclogActive: {}
            }, null, 2));
            console.log('📝 [STATE] Created default state.json');
        }
    } catch (err) {
        console.error('❌ [STATE] Failed to load state:', err.message);
    }
}

// ─── SAVE STATE ──────────────────────────────────────────────────

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
            devLids: config.devLids || [],
            sudoLids: config.sudoLids || [],
            warns: config.warns || {},
            conversationLogs: config.conversationLogs || {},
            aza: config.aza || { set: false },
            gclogActive: config.gclogActive || {}
        };

        fs.writeFileSync(STATE_PATH, JSON.stringify(stateData, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error('❌ [STATE] Failed to save state:', err.message);
        return false;
    }
}

// ─── PERMISSION HELPERS (Atomic Updates) ──────────────────────

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

// ─── EXPORTS ─────────────────────────────────────────────────────

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