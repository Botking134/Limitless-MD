// helpers/PermissionManager.js
const fs = require('fs');
const path = require('path');
const { normalizeToJid } = require('../stateManager');

const permPath = path.join(__dirname, '../storage/permissions.json');

function readPermissions() {
    try {
        if (fs.existsSync(permPath)) {
            return JSON.parse(fs.readFileSync(permPath, 'utf-8'));
        }
    } catch (e) {
        console.error("⚠️ [PERMISSIONS] Failed to parse permissions file.");
    }
    return { users: {}, chats: {} };
}

function savePermissions(data) {
    try {
        const dir = path.dirname(permPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(permPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) { /* ignore */ }
}

function isCommandAllowed(senderJid, jid, cleanCommand) {
    if (!cleanCommand) return false;
    const data = readPermissions();
    const cmdLower = cleanCommand.toLowerCase().trim();

    // 1. Check user-specific permissions
    const cleanSender = normalizeToJid(senderJid).split('@')[0].split(':')[0];
    for (const [userKey, allowedCmds] of Object.entries(data.users || {})) {
        if (userKey.split('@')[0].split(':')[0] === cleanSender) {
            if (Array.isArray(allowedCmds) && allowedCmds.includes(cmdLower)) {
                return true;
            }
        }
    }

    // 2. Check chat/group-level permissions
    const chatAllowed = data.chats?.[jid];
    if (Array.isArray(chatAllowed) && chatAllowed.includes(cmdLower)) {
        return true;
    }

    return false;
}

module.exports = {
    readPermissions,
    savePermissions,
    isCommandAllowed
};