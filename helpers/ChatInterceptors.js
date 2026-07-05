// helpers/ChatInterceptors.js
const config = require('../config');
const { saveState } = require('../stateManager');
const { cleanJid } = require('./Message');

// ─── LID-SAFE SILENCE CHECK ─────────────────────────────────────
function isUserSilenced(silencedUsers, jid, senderJid) {
    if (!silencedUsers || !silencedUsers[jid]) return null;

    const silencedEntries = silencedUsers[jid];
    const senderNum = senderJid.split('@')[0];

    for (const [key, data] of Object.entries(silencedEntries)) {
        const keyNum = key.split('@')[0];
        if (keyNum === senderNum) {
            return data;
        }
    }
    return null;
}

// ─── SECURITY POLICY EXECUTION LAYER ───────────────────────────
async function applySecurityPolicy(sock, msg, policy, senderJid, senderNumber, jid, violationReason) {
    if (!policy || policy === 'off') return;

    if (policy === 'delete') {
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            await sock.sendMessage(jid, {
                text: `❌ *Message Deleted:* @${senderNumber} violated ${violationReason} rules.`,
                mentions: [senderJid]
            });
        } catch (e) { /* ignore */ }
    } else if (policy === 'warn') {
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            const warnKey = `${jid}_${senderNumber}`;
            config.warns = config.warns || {};
            config.warns[warnKey] = (config.warns[warnKey] || 0) + 1;
            const count = config.warns[warnKey];
            const threshold = config.warnThreshold || 5;

            if (count >= threshold) {
                await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
                await sock.sendMessage(jid, {
                    text: `👋 @${senderNumber} kicked. Warnings exceeded (${count}/${threshold}) for violating ${violationReason} rules.`,
                    mentions: [senderJid]
                });
                config.warns[warnKey] = 0;
            } else {
                await sock.sendMessage(jid, {
                    text: `⚠️ @${senderNumber} ${violationReason} is not allowed here! (${count}/${threshold})`,
                    mentions: [senderJid]
                });
            }
            saveState();
        } catch (e) { /* ignore */ }
    } else if (policy === 'kick') {
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
            await sock.sendMessage(jid, {
                text: `👋 Exorcised @${senderNumber} for violating ${violationReason} rules.`,
                mentions: [senderJid]
            });
        } catch (e) { /* ignore */ }
    }
}

// ─── ACTIVE SECURITY POLICY INTERCEPTORS ───────────────────────
async function handleGroupSecurity(sock, msg, body, senderJid, senderNumber, jid, mentionedJids, isAuthorized, isDev) {
    // 1. Antilink Universal Domain Scanner
    const antilinkPolicy = config.antilink?.[jid] || 'off';
    const hasLink = /(https?:\/\/)?(www\.)?([a-zA-Z0-9-]+)\.[a-zA-Z]{2,6}(\/[^\s]*)?/i.test(body) || 
                    /wa\.me\/[0-9]+/i.test(body) || 
                    /chat\.whatsapp\.com\/[a-zA-Z0-9]+/i.test(body);

    if (hasLink && antilinkPolicy !== 'off') {
        await applySecurityPolicy(sock, msg, antilinkPolicy, senderJid, senderNumber, jid, "Antilink");
        return true;
    }

    // 2. Antibot Scanner
    const antibotPolicy = config.antibot?.[jid] || 'off';
    const isBotSender = msg.key.id.startsWith('BAE5') || 
                        msg.key.id.startsWith('3EB0') || 
                        (msg.key.id.length === 12 && !msg.key.id.startsWith('3A'));

    if (isBotSender && antibotPolicy !== 'off') {
        await applySecurityPolicy(sock, msg, antibotPolicy, senderJid, senderNumber, jid, "Antibot");
        return true;
    }

    // 3. Antitag Case-Insensitive Global Scanner
    const antitagPolicy = config.antitag?.[jid] || 'off';
    const isTaggingEveryone = /@(everyone|here|all)/i.test(body) || mentionedJids.length >= 5;

    if (isTaggingEveryone && antitagPolicy === 'on') {
        await applySecurityPolicy(sock, msg, 'delete', senderJid, senderNumber, jid, "Antitag");
        return true;
    }

    // 4. Anti-Group-Mention (Antigm with raw regex support)
    const antigmPolicy = config.antigm?.[jid] || 'off';
    const isGroupMention = mentionedJids.some(j => j.endsWith('@g.us')) || /@g\.us/i.test(body);

    if (isGroupMention && antigmPolicy !== 'off') {
        await applySecurityPolicy(sock, msg, antigmPolicy, senderJid, senderNumber, jid, "Anti-Group-Mention");
        return true;
    }

    return false;
}

// ─── GROUP STATUS PROTECTION ─────────────────────────────────────
async function handleGroupStatusProtection(sock, msg, cleanChatJid, senderNumber, senderJid, isAuthorized, isDev) {
    const policy = config.antigcstatus || 'off';
    if (policy !== 'off') {
        if (policy === 'delete') {
            try {
                await sock.sendMessage(cleanChatJid, { delete: msg.key });
                await sock.sendMessage(cleanChatJid, {
                    text: `❌ *Warning @${senderNumber}:* Group status updates are restricted in this domain.`,
                    mentions: [senderJid]
                });
            } catch (e) { /* ignore */ }
        } else if (policy === 'warn') {
            try {
                await sock.sendMessage(cleanChatJid, { delete: msg.key });
                const warnKey = `${cleanChatJid}_${senderNumber}`;
                config.warns = config.warns || {};
                config.warns[warnKey] = (config.warns[warnKey] || 0) + 1;
                const count = config.warns[warnKey];
                const threshold = config.warnThreshold || 5;

                if (count >= threshold) {
                    await sock.groupParticipantsUpdate(cleanChatJid, [senderJid], "remove");
                    await sock.sendMessage(cleanChatJid, {
                        text: `👋 @${senderNumber} kicked. Warnings exceeded for posting status updates.`,
                        mentions: [senderJid]
                    });
                    config.warns[warnKey] = 0;
                } else {
                    await sock.sendMessage(cleanChatJid, {
                        text: `⚠️ @${senderNumber} Status updates are not allowed here! (${count}/${threshold})`,
                        mentions: [senderJid]
                    });
                }
                saveState();
            } catch (e) { /* ignore */ }
        } else if (policy === 'kick') {
            try {
                await sock.sendMessage(cleanChatJid, { delete: msg.key });
                await sock.groupParticipantsUpdate(cleanChatJid, [senderJid], "remove");
                await sock.sendMessage(cleanChatJid, {
                    text: `👋 Exorcised @${senderNumber} for posting status updates.`,
                    mentions: [senderJid]
                });
            } catch (e) { /* ignore */ }
        }
        return true;
    }
    return false;
}

// ─── ANTIBUG RATE-LIMIT (Non-silent block warning armed) ──────────
async function handleAntibugSpamLimit(sock, msg, senderJid, senderNumber, jid) {
    const now = Date.now();
    if (!global.spamTracker[senderJid]) global.spamTracker[senderJid] = [];
    global.spamTracker[senderJid].push(now);
    global.spamTracker[senderJid] = global.spamTracker[senderJid].filter(t => now - t <= 3000);

    if (global.spamTracker[senderJid].length >= 5) {
        try {
            await sock.sendMessage(jid, {
                text: `🚨 *ANTIBUG BAN HAMMER* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n@${senderNumber} has been blocked for spamming/flooding the system. (Spam threshold exceeded).`,
                mentions: [senderJid]
            }, { quoted: msg });
            
            await sock.updateBlockStatus(senderJid, 'block');
            await sock.chatModify({ delete: true, lastMessages: [{ key: msg.key, messageTimestamp: msg.messageTimestamp }] }, jid);
            delete global.spamTracker[senderJid];
        } catch (blockErr) { /* ignore */ }
        return true;
    }
    return false;
}

// ─── ANTISPAM RATE-LIMIT (Fixed Legacy Buttons) ───────────────────
async function handleAntispamRateLimit(sock, msg, senderJid, senderNumber, jid) {
    const antispamConfig = config.antispam?.[jid];
    if (antispamConfig && antispamConfig.status === 'on') {
        const rate = antispamConfig.rate || { count: 1, seconds: 2 };
        const now = Date.now();
        global.spamTracker[senderJid] = global.spamTracker[senderJid] || [];
        global.spamTracker[senderJid].push(now);
        global.spamTracker[senderJid] = global.spamTracker[senderJid].filter(t => now - t <= (rate.seconds * 1000));

        if (global.spamTracker[senderJid].length > rate.count) {
            try {
                await sock.sendMessage(jid, { delete: msg.key });
                const spamDeleteKey = `${jid}_${senderNumber}`;
                global.spamDeletedCount[spamDeleteKey] = (global.spamDeletedCount[spamDeleteKey] || 0) + 1;

                if (global.spamDeletedCount[spamDeleteKey] >= 10) {
                    global.spamDeletedCount[spamDeleteKey] = 0;
                    const alertText = `🚨 *SPAM ATTACK DETECTED* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n@${senderNumber} rate-limit violated! Admins, use \`${config.prefix}kick @${senderNumber}\` to remove them.`;
                    await sock.sendMessage(jid, { text: alertText, mentions: [senderJid] });
                }
            } catch (e) { /* ignore */ }
            return true;
        }
    }
    return false;
}

module.exports = {
    isUserSilenced,
    applySecurityPolicy,
    handleGroupSecurity,
    handleGroupStatusProtection,
    handleAntibugSpamLimit,
    handleAntispamRateLimit
};