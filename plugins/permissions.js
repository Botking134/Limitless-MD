// plugins/permissions.js
const config = require('../config');
const { readPermissions, savePermissions } = require('../helpers/PermissionManager');
const { normalizeToJid, getPhoneJid } = require('../stateManager');

function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

function parseTargetUser(msg, args) {
    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo ||
                        rawMsg?.extendedTextMessage?.contextInfo ||
                        rawMsg?.imageMessage?.contextInfo ||
                        rawMsg?.videoMessage?.contextInfo ||
                        rawMsg?.stickerMessage?.contextInfo ||
                        rawMsg?.audioMessage?.contextInfo ||
                        rawMsg?.documentMessage?.contextInfo;

    const mentions = contextInfo?.mentionedJid || [];
    if (contextInfo?.participant) return normalizeToJid(contextInfo.participant);
    if (mentions.length > 0) return normalizeToJid(mentions[0]);

    if (args) {
        const parts = args.trim().split(/\s+/);
        const cleanDigits = parts[0].replace(/[^0-9]/g, '');
        if (cleanDigits.length >= 7) return `${cleanDigits}@s.whatsapp.net`;
    }
    return '';
}

function parseCommandList(str) {
    if (!str) return [];
    return str.split(',')
              .map(c => c.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase().trim())
              .filter(Boolean);
}

module.exports = [
    // 1. ALLOW COMMAND
    {
        name: 'allow',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            const isAuthorized = isOwner || isSudo || isDev || isAdmin;
            if (!isAuthorized) return;

            if (!args || !args.trim()) {
                return await sock.sendMessage(jid, { 
                    text: `❌ *Format:* \`${config.prefix}allow <command1, command2>\`\n\n*Examples:*\n• Reply to a user with \`${config.prefix}allow ping\`\n• Reply to a user with \`${config.prefix}allow ping, menu, sticker\`\n• Run \`${config.prefix}allow ping\` (grants whole group/chat)` 
                }, { quoted: msg });
            }

            const targetUser = parseTargetUser(msg, args);
            const cmdList = parseCommandList(args);

            if (cmdList.length === 0) {
                return await sock.sendMessage(jid, { text: "❌ Please specify at least one valid command name." }, { quoted: msg });
            }

            const data = readPermissions();
            data.users = data.users || {};
            data.chats = data.chats || {};

            // ─── CASE A: TARGETED USER ───
            if (targetUser) {
                let userJid = targetUser;
                if (userJid.endsWith('@lid')) {
                    const resolved = await getPhoneJid(sock, userJid, jid);
                    if (resolved && resolved.endsWith('@s.whatsapp.net')) userJid = resolved;
                }

                data.users[userJid] = data.users[userJid] || [];
                const added = [];
                for (const cmd of cmdList) {
                    if (!data.users[userJid].includes(cmd)) {
                        data.users[userJid].push(cmd);
                        added.push(cmd);
                    }
                }

                savePermissions(data);
                const userNum = userJid.split('@')[0];

                return await sock.sendMessage(jid, {
                    text: `✅ *Permissions Granted!* \n\n👤 *User:* @${userNum}\n📜 *Allowed Commands:* \`${data.users[userJid].join(', ')}\``,
                    mentions: [userJid]
                }, { quoted: msg });
            }

            // ─── CASE B: WHOLE CHAT / GROUP ───
            data.chats[jid] = data.chats[jid] || [];
            for (const cmd of cmdList) {
                if (!data.chats[jid].includes(cmd)) {
                    data.chats[jid].push(cmd);
                }
            }

            savePermissions(data);

            await sock.sendMessage(jid, {
                text: `✅ *Chat Permissions Updated!* \n\n🌐 Everyone in this chat can now run: \`${data.chats[jid].join(', ')}\``
            }, { quoted: msg });
        }
    },

    // 2. DISALLOW COMMAND
    {
        name: 'disallow',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            const isAuthorized = isOwner || isSudo || isDev || isAdmin;
            if (!isAuthorized) return;

            if (!args || !args.trim()) {
                return await sock.sendMessage(jid, { text: `❌ *Format:* \`${config.prefix}disallow <command1, command2>\`` }, { quoted: msg });
            }

            const targetUser = parseTargetUser(msg, args);
            const cmdList = parseCommandList(args);
            const data = readPermissions();

            // ─── CASE A: TARGETED USER ───
            if (targetUser) {
                let userJid = targetUser;
                if (userJid.endsWith('@lid')) {
                    const resolved = await getPhoneJid(sock, userJid, jid);
                    if (resolved && resolved.endsWith('@s.whatsapp.net')) userJid = resolved;
                }

                if (data.users && data.users[userJid]) {
                    data.users[userJid] = data.users[userJid].filter(c => !cmdList.includes(c));
                    if (data.users[userJid].length === 0) delete data.users[userJid];
                    savePermissions(data);
                }

                const userNum = userJid.split('@')[0];
                return await sock.sendMessage(jid, {
                    text: `✅ *Permissions Revoked!* \n\n👤 *User:* @${userNum}\n📜 *Access removed for:* \`${cmdList.join(', ')}\``,
                    mentions: [userJid]
                }, { quoted: msg });
            }

            // ─── CASE B: WHOLE CHAT / GROUP ───
            if (data.chats && data.chats[jid]) {
                data.chats[jid] = data.chats[jid].filter(c => !cmdList.includes(c));
                if (data.chats[jid].length === 0) delete data.chats[jid];
                savePermissions(data);
            }

            await sock.sendMessage(jid, {
                text: `✅ *Chat Permissions Updated!* \n\n🌐 Access removed for: \`${cmdList.join(', ')}\` in this chat.`
            }, { quoted: msg });
        }
    },

    // 3. DISALLOW-ALL COMMAND
    {
        name: 'disallow-all',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            const isAuthorized = isOwner || isSudo || isDev || isAdmin;
            if (!isAuthorized) return;

            const targetUser = parseTargetUser(msg, args);
            const data = readPermissions();

            // ─── CASE A: TARGETED USER ───
            if (targetUser) {
                let userJid = targetUser;
                if (userJid.endsWith('@lid')) {
                    const resolved = await getPhoneJid(sock, userJid, jid);
                    if (resolved && resolved.endsWith('@s.whatsapp.net')) userJid = resolved;
                }

                if (data.users && data.users[userJid]) {
                    delete data.users[userJid];
                    savePermissions(data);
                }

                const userNum = userJid.split('@')[0];
                return await sock.sendMessage(jid, {
                    text: `✅ *All Custom Permissions Cleared!* \n\n👤 @${userNum} no longer has special command access.`,
                    mentions: [userJid]
                }, { quoted: msg });
            }

            // ─── CASE B: WHOLE CHAT / GROUP ───
            if (data.chats && data.chats[jid]) {
                delete data.chats[jid];
                savePermissions(data);
            }

            await sock.sendMessage(jid, {
                text: `✅ *All Custom Chat Permissions Cleared!* \n\n🌐 Group-wide command access reset to default.`
            }, { quoted: msg });
        }
    }
];

// Alias for disallow-all
module.exports.push({
    name: 'disallowall',
    isPrefixless: false,
    execute: async (sock, msg, args, opts) => {
        const cmd = module.exports.find(c => c.name === 'disallow-all');
        if (cmd) await cmd.execute(sock, msg, args, opts);
    }
});