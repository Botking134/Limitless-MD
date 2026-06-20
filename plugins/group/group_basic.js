// plugins/group/group_basic.js
const config = require('../../config');
const { saveState, normalizeToJid, resolveToPhoneJid } = require('../../stateManager');
const { DEV_LIDS } = require('../../devs');

// ─── MADARA GIFS (Defined directly in this file) ──────────────
const madaraGifs = [
    "https://media.giphy.com/media/PmCiutdmK8mt2/giphy.mp4",
    "https://media.giphy.com/media/5D8fDjKyQfuZW/giphy.mp4"
];

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
    return DEV_LIDS.includes(normalized);
}

function isOwnerTarget(target) {
    return target === config.ownerJid ||
           (config.ownerLid && target === config.ownerLid) ||
           (config.ownerLids && config.ownerLids.includes(target)) ||
           (config.secondaryOwners && config.secondaryOwners.includes(target));
}

// ─── UPDATED verifyPermissions ──────────────────────
async function verifyPermissions(sock, msg, jid, isOwner, isDev = false, isSudo = false, commandName = '') {
    const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');

    // 1. AUTHORIZATION CHECK (Developers bypass all checks)
    if (isDev) {
        return true;
    }

    const isAuthorized = isOwner || isSudo;
    if (!isAuthorized) return false;

    // 2. EXEMPT COMMANDS
    const exemptCommands = [
        'tag', 'tagall', 'htag', 'admins', 'link', 'invite', 'gclink',
        'gcjid', 'getgpp', 'poll', 'togcstatus', 'togcjid',
        'join', 'exit', 'listonline', 'msgs'
    ];
    if (exemptCommands.includes(commandName.toLowerCase())) {
        return true;
    }

    // 3. BOT ADMIN CHECK WITH JID & LID CO-EXISTENCE
    const groupMetadata = await sock.groupMetadata(jid);
    const participants = groupMetadata.participants;

    const botJid = sock.user?.id ? normalizeToJid(sock.user.id) : '';
    const botLid = sock.user?.lid ? normalizeToJid(sock.user.lid) : (config.botLid || '');

    const botParticipant = participants.find(p => {
        const pId = normalizeToJid(p.id);
        const pLid = p.lid ? normalizeToJid(p.lid) : '';
        return (botJid && (pId === botJid || pLid === botJid)) ||
               (botLid && (pId === botLid || pLid === botLid));
    });
    const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

    if (!isBotAdmin) {
        await sock.sendMessage(jid, { text: "❌ I must be an administrator in this group first!" }, { quoted: msg });
        return false;
    }

    // 4. SENDER ADMIN CHECK
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

    // 2. KICK (with GIF fix)
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

            // ─── Send Kick GIF (with try/catch) ──────────────────────
            try {
                await sock.sendMessage(jid, {
                    video: { url: "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExZzJmenhraWhkZHhsNHlnMmg2Z3hqM29pNHFvZ2dzNm53bXVnYjdoeiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/QfCQQQAI860CXZY9qs/giphy.mp4" },
                    gifPlayback: true,
                    caption: "Kokeida Na.... Yare Yare"
                });
            } catch (gifErr) {
                console.error("Failed to send kick GIF:", gifErr.message);
                // Fallback: just send a text notification
                await sock.sendMessage(jid, { text: `👋 Exorcising target from this domain...` }, { quoted: msg });
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

    // 5. TAGALL (with Madara GIF)
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

            // ─── Send Madara GIF with the tag message as caption ──
            const randomGif = madaraGifs[Math.floor(Math.random() * madaraGifs.length)];
            try {
                await sock.sendMessage(jid, {
                    video: { url: randomGif },
                    gifPlayback: true,
                    caption: text,
                    mentions: allJids
                });
            } catch (gifErr) {
                console.error("Failed to send Madara GIF for tagall:", gifErr.message);
                await sock.sendMessage(jid, {
                    text: text,
                    mentions: allJids
                });
            }
        }
    },

    // 6. TAG (with Madara GIF)
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

            // ─── Send Madara GIF with the tag message as caption ──
            const randomGif = madaraGifs[Math.floor(Math.random() * madaraGifs.length)];
            try {
                await sock.sendMessage(jid, {
                    video: { url: randomGif },
                    gifPlayback: true,
                    caption: messageText,
                    mentions: participants
                });
            } catch (gifErr) {
                console.error("Failed to send Madara GIF for tag:", gifErr.message);
                await sock.sendMessage(jid, {
                    text: messageText,
                    mentions: participants
                });
            }
        }
    },

    // 7. LINK
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

    // ─── GCJID ──────────────────────────────────────────────────────
{
    name: 'gcjid',
    isPrefixless: false,
    execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
        const jid = msg.key.remoteJid;
        await sock.sendMessage(jid, { text: jid }, { quoted: msg });
    }
}, 

// ─── ACTIVE – List members who sent messages today ────────────
{
    name: 'active',
    isPrefixless: false,
    execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        if (!isGroup) return;

        const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'active');
        if (!isAuthorized) return;

        const groupMetadata = await sock.groupMetadata(jid);
        const participants = groupMetadata.participants;

        const today = new Date().toDateString();
        let activeList = [];
        let inactiveList = [];

        for (const p of participants) {
            const pJid = normalizeToJid(p.id);
            const dailyKey = `${jid}_${pJid}`;
            const dailyData = config.dailyActivity?.[dailyKey];
            if (dailyData && dailyData.date === today && dailyData.count > 0) {
                activeList.push(pJid);
            } else {
                inactiveList.push(pJid);
            }
        }

        if (activeList.length === 0) {
            return await sock.sendMessage(jid, { text: "📊 No active members today." }, { quoted: msg });
        }

        const activeMentions = activeList.map(j => `@${j.split('@')[0]}`).join(' ');
        const inactiveCount = inactiveList.length;

        await sock.sendMessage(jid, {
            text: `📊 *Active Members Today:*\n\n${activeMentions}\n\n🔇 *Inactive:* ${inactiveCount} members`,
            mentions: activeList
        }, { quoted: msg });
    }
},

// ─── INACTIVE – List members who haven't sent messages today ──
{
    name: 'inactive',
    isPrefixless: false,
    execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        if (!isGroup) return;

        const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'inactive');
        if (!isAuthorized) return;

        const groupMetadata = await sock.groupMetadata(jid);
        const participants = groupMetadata.participants;

        const today = new Date().toDateString();
        let inactiveList = [];

        for (const p of participants) {
            const pJid = normalizeToJid(p.id);
            const dailyKey = `${jid}_${pJid}`;
            const dailyData = config.dailyActivity?.[dailyKey];
            if (!dailyData || dailyData.date !== today || dailyData.count === 0) {
                inactiveList.push(pJid);
            }
        }

        if (inactiveList.length === 0) {
            return await sock.sendMessage(jid, { text: "📊 Everyone has been active today!" }, { quoted: msg });
        }

        const inactiveMentions = inactiveList.map(j => `@${j.split('@')[0]}`).join(' ');

        await sock.sendMessage(jid, {
            text: `📊 *Inactive Members Today:*\n\n${inactiveMentions}`,
            mentions: inactiveList
        }, { quoted: msg });
    }
},

// ─── MSGS – List members with total message counts ─────────────
{
    name: 'msgs',
    isPrefixless: false,
    execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        if (!isGroup) return;

        const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'msgs');
        if (!isAuthorized) return;

        const groupMetadata = await sock.groupMetadata(jid);
        const participants = groupMetadata.participants;

        let msgCounts = [];

        for (const p of participants) {
            const pJid = normalizeToJid(p.id);
            const totalKey = `${jid}_${pJid}`;
            const count = config.totalMessages?.[totalKey] || 0;
            msgCounts.push({ jid: pJid, count });
        }

        // Sort descending by count
        msgCounts.sort((a, b) => b.count - a.count);

        let message = `📊 *Message Counts (All Time)*\n\n`;
        for (const entry of msgCounts) {
            const name = entry.jid.split('@')[0];
            message += `• @${name} : \`${entry.count}\` messages\n`;
        }

        const mentions = msgCounts.map(e => e.jid);
        await sock.sendMessage(jid, {
            text: message,
            mentions: mentions
        }, { quoted: msg });
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