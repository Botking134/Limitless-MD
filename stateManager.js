// stateManager.js
const fs = require('fs');
const path = require('path');
const config = require('./config');

const DEV_LIDS = [
    '90181998776472@lid',
    '139780398567572@lid',
    '724371671200049@lid',
    '70442412994675@lid',
    '66113102717169@lid'
];

const STATE_PATH = path.join(__dirname, 'storage', 'state.json');
const LID_CACHE_PATH = path.join(__dirname, 'storage', 'lid_cache.json');

// This cache used to be purely in-memory, so it started empty on every
// restart. That's exactly what made LID resolution fail right when it
// matters most: a member who leaves shortly after a restart (before the bot
// has seen any of their messages this run) had never been cached, group
// metadata fetched *after* they've already left often no longer lists them
// either, and the live API lookup isn't reliable for someone on their way
// out — so resolution failed and the caller fell back to building a fake
// "phone number" out of the LID's own digits. Persisting this across
// restarts means any mapping ever learned stays known.
try {
    if (fs.existsSync(LID_CACHE_PATH)) {
        global.lidCache = JSON.parse(fs.readFileSync(LID_CACHE_PATH, 'utf-8'));
    }
} catch (e) {
    console.error('⚠️ [LIDCACHE] Failed to load persisted cache, starting fresh:', e.message);
}
global.lidCache = global.lidCache || {};

function persistLidCache() {
    try {
        fs.mkdirSync(path.dirname(LID_CACHE_PATH), { recursive: true });
        fs.writeFileSync(LID_CACHE_PATH, JSON.stringify(global.lidCache));
    } catch (e) {
        console.error('⚠️ [LIDCACHE] Failed to persist cache:', e.message);
    }
}

/**
 * Warms global.lidCache from a group metadata object's participant list —
 * free, since the caller already paid for the metadata fetch. Every
 * participant with both a lid and a real id gets cached, not just whoever
 * one specific lookup was about.
 */
function warmLidCache(metadata) {
    if (!metadata?.participants?.length) return;
    let added = false;
    for (const p of metadata.participants) {
        if (!p.lid || !p.id) continue;
        const lidJid = normalizeToJid(p.lid);
        const phoneJid = normalizeToJid(p.id);
        if (lidJid && phoneJid?.endsWith('@s.whatsapp.net') && global.lidCache[lidJid] !== phoneJid) {
            global.lidCache[lidJid] = phoneJid;
            added = true;
        }
    }
    if (added) persistLidCache();
}

/**
 * Normalizes any WhatsApp identifier cleanly.
 * Strips device identifiers and forces the correct domain.
 */
function normalizeToJid(input) {
    if (!input) return '';
    const clean = input.replace(/:[\d]+@/, '@');
    if (clean.endsWith('@s.whatsapp.net')) return clean;
    if (clean.endsWith('@lid')) return clean;
    // Group JIDs (@g.us) and broadcast/newsletter JIDs must pass through untouched —
    // they are NOT phone-number identifiers, and stripping non-digits + rebuilding as
    // @s.whatsapp.net (the old behavior) silently turns a real group into a garbage,
    // nonexistent "contact" JID. This was corrupting every group-scoped operation
    // (metadata fetch, welcome/goodbye sends, antijoin/antipromote/antidemote/overkill
    // enforcement) anywhere a group JID was run through this function.
    if (clean.endsWith('@g.us')) return clean;
    if (clean.endsWith('@broadcast') || clean.endsWith('@newsletter')) return clean;
    const raw = clean.split('@')[0].replace(/[^0-9]/g, '');
    return raw ? `${raw}@s.whatsapp.net` : '';
}

/**
 * Safely resolves an LID JID to a phone JID.
 * Utilizes the local group participants metadata as a fast cache, falling back to an API search.
 */
async function getPhoneJid(sock, jid, groupJid = null, cachedMetadata = null) {
    if (!jid) return '';
    const cleanJid = normalizeToJid(jid);
    if (!cleanJid) return '';
    if (cleanJid.endsWith('@s.whatsapp.net')) return cleanJid;
    if (global.lidCache[cleanJid]) return global.lidCache[cleanJid];

    if (groupJid) {
        try {
            // Reuse a metadata object the caller already fetched (e.g. in the
            // group-participants.update handler) instead of hitting the socket
            // again for every participant in the same event — repeated
            // groupMetadata()/findUserId() calls in a tight loop is what was
            // triggering WhatsApp's flood protection (reason 500 disconnects).
            const metadata = cachedMetadata || await sock.groupMetadata(groupJid);
            const participant = metadata?.participants?.find(p => {
                const pLid = p.lid ? normalizeToJid(p.lid) : '';
                return pLid === cleanJid || normalizeToJid(p.id) === cleanJid;
            });
            if (participant) {
                const resolved = normalizeToJid(participant.id);
                if (resolved && resolved.endsWith('@s.whatsapp.net')) {
                    global.lidCache[cleanJid] = resolved;
                    persistLidCache();
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
            persistLidCache();
            return phoneJid;
        }
    } catch (e) { /* ignore */ }

    return cleanJid;
}

/**
 * Loads authorization variables from state.json and merges them into the active configuration.
 */
function loadState() {
    const storageDir = path.dirname(STATE_PATH);
    if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }

    // Set Dev LIDs from the hardcoded devs list
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

            // Guarantee Dev LIDs are always present
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

/**
 * Writes the active configurations out to state.json.
 */
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
            devLids: [...DEV_LIDS],
            sudoLids: config.sudoLids || [],
            warns: config.warns || {},
            aza: config.aza || { set: false }
        };

        fs.writeFileSync(STATE_PATH, JSON.stringify(stateData, null, 2), 'utf-8');

        // Sync variables to vars.json
        try {
            const { saveDynamicVars } = require('./vars');
            if (typeof saveDynamicVars === 'function') saveDynamicVars();
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
    warmLidCache,
    addSecondaryOwner,
    removeSecondaryOwner,
    addSudo,
    removeSudo,
    addBan,
    removeBan
};