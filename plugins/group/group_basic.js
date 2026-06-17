// plugins/group_basic.js
const config = require('../../config');
const { saveState, normalizeToJid } = require('../../stateManager');

// ─── GLOBAL TIMERS ──────────────────────────────────────────────
global.groupTimers = global.groupTimers || {};

// ─── HELPERS ──────────────────────────────────────────────────────

function parseDuration(str) {
    const match = str.match(/^(\d+)([smh])$/i);
    if (!match) return null;
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
    return null;
}

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

    if (mentions.length > 0) {
        return normalizeToJid(mentions[0]);
    }

    if (contextInfo?.participant) {
        return normalizeToJid(contextInfo.participant);
    }

    if (args) {
        const cleanDigits = args.replace(/[^0-9]/g, '');
        if (cleanDigits.length >= 7) {
            return `${cleanDigits}@s.whatsapp.net`;
        }
    }

    return '';
}

function isDeveloper(jid) {
    if (!jid) return false;
    const normalized = normalizeToJid(jid);
    const { DEV_JIDS, DEV_LIDS } = require('../devs');
    return DEV_JIDS.includes(normalized) || DEV_LIDS.includes(normalized);
}

function isOwnerTarget(target) {
    return target === config.ownerJid ||
           (config.ownerLid && target === config.ownerLid) ||
           (config.ownerLids && config.ownerLids.includes(target)) ||
           (config.secondaryOwners && config.secondaryOwners.includes(target));
}

async function verifyPermissions(sock, msg, jid, isOwner, isDev = false, isSudo = false, commandName = '') {
    const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');

    const isAuthorizedMember = isDev || isOwner || isSudo;
    if (!isAuthorizedMember) {
        return false;
    }

    const groupMetadata = await sock.groupMetadata(jid);
    const participants = groupMetadata.participants;

    const botJid = normalizeToJid(sock.user.id);
    const botLid = config.botLid || '';

    const botParticipant = participants.find(p => {
        const pId = normalizeToJid(p.id);
        const pLid = p.lid ? normalizeToJid(p.lid) : '';
        return pId === botJid || (botLid && pId === botLid) || (botLid && pLid === botLid) || (pLid && pLid === botJid);
    });
    const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

    if (!isBotAdmin) {
        await sock.sendMessage(jid, { text: "❌ I must be an administrator in this group first!" }, { quoted: msg });
        return false;
    }

    const exemptCommands = ['tag', 'tagall', 'poll', 'togcstatus', 'getgpp', 'gcjid'];
    if (exemptCommands.includes(commandName.toLowerCase())) {
        return true;
    }

    if (isDev) {
        return true;
    }

    let sender = participants.find(p => {
        const pId = normalizeToJid(p.id);
        const pLid = p.lid ? normalizeToJid(p.lid) : '';
        return pId === senderJid || (pLid && pLid === senderJid);
    });
    const isSenderAdmin = sender?.admin === 'admin' || sender?.admin === 'superadmin';
    if (!isSenderAdmin) {
        await sock.sendMessage(jid, { text: "❌ You must be an administrator in this group to run this command!" }, { quoted: msg });
        return false;
    }

    return true;
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 1. MUTE / UNMUTE
    {
        name: 'mute',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'mute');
            if (!isAuthorized) return;

            if (!args) {
                const prompt = `🔒 *Gotei 13 Domain Control Panel:*\n\nSelect an option below to update domain parameters:`;
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${config.prefix}mute close`, buttonText: { displayText: 'Mute Group 🔒' }, type: 1 },
                        { buttonId: `${config.prefix}mute open`, buttonText: { displayText: 'Unmute Group 🔓' }, type: 1 }
                    ],
                    headerType: 1
                };
                try {
                    return await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (e) {
                    return await sock.sendMessage(jid, { text: `${prompt}\n\n• \`${config.prefix}mute close\`\n• \`${config.prefix}mute open\`` }, { quoted: msg });
                }
            }

            const parts = args.split(' ');
            const action = parts[0].toLowerCase().trim();
            const timeString = parts[1] || '';
            const durationMs = timeString ? parseDuration(timeString) : null;

            const isOpening = ['open', 'unlock', 'unmute'].includes(action);

            if (isOpening) {
                await sock.groupSettingUpdate(jid, 'not_announcement');
                let timeNotice = "";

                if (durationMs) {
                    timeNotice = `\n_This domain will automatically close in ${timeString}._`;
                    if (global.groupTimers[jid]) clearTimeout(global.groupTimers[jid]);
                    global.groupTimers[jid] = setTimeout(async () => {
                        await sock.groupSettingUpdate(jid, 'announcement');
                        await sock.sendMessage(jid, { text: "🔒 *Group Status Updated:*\n\nTime is up. Only Administrators can speak." });
                        delete global.groupTimers[jid];
                    }, durationMs);
                }
                await sock.sendMessage(jid, { text: `🔓 *Group Status Updated:*\n\nEveryone is now free to speak.${timeNotice}` }, { quoted: msg });
            } else {
                await sock.groupSettingUpdate(jid, 'announcement');
                let timeNotice = "";

                if (durationMs) {
                    timeNotice = `\n_This domain will automatically open in ${timeString}._`;
                    if (global.groupTimers[jid]) clearTimeout(global.groupTimers[jid]);
                    global.groupTimers[jid] = setTimeout(async () => {
                        await sock.groupSettingUpdate(jid, 'not_announcement');
                        await sock.sendMessage(jid, { text: "🔓 *Group Status Updated:*\n\nEveryone is now free to speak." });
                        delete global.groupTimers[jid];
                    }, durationMs);
                }
                await sock.sendMessage(jid, { text: `🔒 *Group Status Updated:*\n\nOnly Administrators can speak.${timeNotice}` }, { quoted: msg });
            }
        }
    },

    // 2. KICK
    {
        name: 'kick',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'kick');
            if (!isAuthorized) return;

            const target = parseTargetUser(msg, args);
            if (!target) return await sock.sendMessage(jid, { text: "❌ No valid targets provided." }, { quoted: msg });

            if (isDeveloper(target)) {
                return await sock.sendMessage(jid, { text: "🛡️ *Immunity Triggered:* Cannot restrict a Core Developer of this domain." }, { quoted: msg });
            }

            if (isOwnerTarget(target)) {
                return await sock.sendMessage(jid, { text: "❌ Cannot kick a registered system owner." }, { quoted: msg });
            }

            await sock.groupParticipantsUpdate(jid, [target], "remove");
            await sock.sendMessage(jid, { text: `👋 Exorcised target from this domain.`, mentions: [target] }, { quoted: msg });
        }
    },

    // 3. PROMOTE
    {
        name: 'promote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'promote');
            if (!isAuthorized) return;

            let target = parseTargetUser(msg, args);
            if (!target && isDev) {
                target = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            }

            if (!target) return await sock.sendMessage(jid, { text: "❌ Identify targets to promote." }, { quoted: msg });

            await sock.groupParticipantsUpdate(jid, [target], "promote");
            await sock.sendMessage(jid, { text: `👑 Elevated member to Administrative status.`, mentions: [target] }, { quoted: msg });
        }
    },

    // 4. DEMOTE
    {
        name: 'demote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'demote');
            if (!isAuthorized) return;

            let target = parseTargetUser(msg, args);
            if (!target && isDev) {
                target = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            }

            if (!target) return await sock.sendMessage(jid, { text: "❌ Identify targets to demote." }, { quoted: msg });

            if (isDeveloper(target)) {
                return await sock.sendMessage(jid, { text: "🛡️ *Immunity Triggered:* Cannot restrict a Core Developer of this domain." }, { quoted: msg });
            }

            if (isOwnerTarget(target)) {
                return await sock.sendMessage(jid, { text: "❌ Cannot demote a registered system owner." }, { quoted: msg });
            }

            await sock.groupParticipantsUpdate(jid, [target], "demote");
            await sock.sendMessage(jid, { text: `👋 Demoted admin back to standard member.`, mentions: [target] }, { quoted: msg });
        }
    },

    // 5. TAGALL
    {
        name: 'tagall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'tagall');
            if (!isAuthorized) return;

            const messageText = args ? args : "Attention everyone!";
            const groupMetadata = await sock.groupMetadata(jid);
            const participants = groupMetadata.participants;

            const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
            const members = participants.filter(p => p.admin === null || p.admin === undefined);

            let text = `📢 *Note:* _"${messageText}"_\n\n`;

            text += `             ⟬ ＡＤＭＩＮＳ⟭\n`;
            for (let i = 0; i < admins.length; i += 2) {
                const a1 = admins[i] ? `➣@${admins[i].id.split('@')[0]}` : '';
                const a2 = admins[i + 1] ? `                      ➣@${admins[i + 1].id.split('@')[0]}` : '';
                text += `${a1}${a2}\n`;
            }

            text += `\n           ☲ＭＥＭＢＥＲＳ☲\n`;
            for (let i = 0; i < members.length; i++) {
                text += `➥@${members[i].id.split('@')[0]}\n`;
            }

            const allJids = participants.map(p => p.id);

            await sock.sendMessage(jid, {
                text: text,
                mentions: allJids
            });
        }
    },

    // 6. TAG (Ghost Tag)
    {
        name: 'tag',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'tag');
            if (!isAuthorized) return;

            const groupMetadata = await sock.groupMetadata(jid);
            const participants = groupMetadata.participants.map(p => p.id);

            const quoted = msg.message.extendedTextMessage?.contextInfo;
            let quotedText = '';

            if (quoted && quoted.stanzaId) {
                const qMsg = quoted.quotedMessage;
                quotedText = qMsg?.conversation || qMsg?.extendedTextMessage?.text || qMsg?.imageMessage?.caption || qMsg?.videoMessage?.caption || '';
            }

            const messageText = args ? args : (quotedText ? quotedText : "🤞 *Summoned by Satoru Gojo.*");

            await sock.sendMessage(jid, {
                text: messageText,
                mentions: participants
            });
        }
    },

    // 7. LINK (Group Invite)
    {
        name: 'link',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'link');
            if (!isAuthorized) return;

            const code = await sock.groupInviteCode(jid);
            const inviteLink = `https://chat.whatsapp.com/${code}`;

            await sock.sendMessage(jid, { text: `🔮 *Limitless Domain Link:*\n\n${inviteLink}` }, { quoted: msg });
        }
    },

    // 8. ADMINS
    {
        name: 'admins',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'admins');
            if (!isAuthorized) return;

            const groupMetadata = await sock.groupMetadata(jid);
            const participants = groupMetadata.participants;
            const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');

            const adminJids = admins.map(a => a.id);
            const mentionsList = admins.map(a => `@${a.id.split('@')[0]}`).join(' ');

            await sock.sendMessage(jid, { text: `🔮 *Limitless Admin Summon:*\n\n${mentionsList}`, mentions: adminJids }, { quoted: msg });
        }
    },

    // 9. GCJID (Group JID)
    {
        name: 'gcjid',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            await sock.sendMessage(jid, { text: `🆔 *Group JID:* \`${jid}\`` }, { quoted: msg });
        }
    }
];

// ─── ALIASES ──────────────────────────────────────────────────────

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'mute') {
        aliases.push({ ...cmd, name: 'unmute' });
        aliases.push({ ...cmd, name: 'open' });
        aliases.push({ ...cmd, name: 'close' });
        aliases.push({ ...cmd, name: 'lock' });
        aliases.push({ ...cmd, name: 'unlock' });
    }
    if (cmd.name === 'link') {
        aliases.push({ ...cmd, name: 'invite' });
        aliases.push({ ...cmd, name: 'gclink' });
    }
});
module.exports.push(...aliases);