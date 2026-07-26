// helpers/ChatInterceptors.js
const config = require('../config');
const { saveState, getPhoneJid, normalizeToJid } = require('../stateManager');
const { cleanJid, getRawMessage } = require('./Message');

// Global properties safe-init
global.spamTracker = global.spamTracker || {};
global.spamDeletedCount = global.spamDeletedCount || {};

// ─── HELPERS ──────────────────────────────────────────────────────

/**
 * Formats the custom warning template using slanted mathematical characters
 */
function getThematicWarning(violationReason, senderNumber, count, threshold) {
    let reasonSlanted = '';
    let footerSlanted = '';

    const reason = String(violationReason).trim().toLowerCase();

    if (reason === 'antilink') {
        reasonSlanted = '𝘴𝘦𝘯𝘵 𝘢 𝘥𝘢𝘮𝘯 𝘭𝘪𝘯𝘬';
        footerSlanted = '𝘓𝘪𝘯𝘬𝘴 𝘢𝘳𝘦 𝘯𝘰𝘵 𝘢𝘭𝘭𝘰𝘸𝘦𝘥';
    } else if (reason === 'antitag') {
        reasonSlanted = '𝘶𝘯𝘴𝘢𝘯𝘤𝘵𝘪𝘰𝘯𝘦𝘥 𝘮𝘢𝘴𝘴 𝘵𝘢𝘨𝘨𝘪𝘯𝘨';
        footerSlanted = '𝘔𝘢𝘴𝘴 𝘮𝘦𝘯𝘵𝘪𝘰𝘯𝘴 𝘢𝘳𝘦 𝘧𝘰𝘳𝘣𝘪𝘥𝘥𝘦𝘯';
    } else if (reason === 'antibot') {
        reasonSlanted = '𝘢🇺𝘵𝘰𝘮𝘢𝘵𝘦𝘥 𝘣𝘰𝘵 𝘢𝘤𝘵𝘪𝘷𝘪𝘵𝘺 𝘥𝘦𝘵𝘦𝘤𝘵𝘦𝘥';
        footerSlanted = '𝘖𝘯𝘭𝘺 𝘩𝘶𝘮𝘢𝘯𝘴 𝘢𝘭𝘭𝘰𝘸𝘦𝘥 𝘩𝘦𝘳𝘦';
    } else if (reason === 'anti-group-mention') {
        reasonSlanted = '𝘪𝘭𝘭𝘦𝘨𝘢𝘭 𝘨𝘳𝘰𝘶𝘱 𝘰𝘳 𝘴𝘵𝘢𝘵𝘶𝘴 𝘮𝘦𝘯𝘵𝘪𝘰𝘯';
        footerSlanted = '𝘎𝘳𝘰𝘶𝘱 / 𝘴𝘵𝘢𝘵𝘶𝘴 𝘮𝘦𝘯𝘵𝘪𝘰𝘯𝘴 𝘢𝘳𝘦 𝘯𝘰𝘵 𝘢𝘭𝘭𝘰𝘸𝘦𝘥';
    } else if (reason === 'antigcstatus') {
        reasonSlanted = '𝘶𝘯𝘢🇺𝘵𝘩𝘰𝘳𝘪𝘻𝘦𝘥 𝘤𝘩𝘢𝘯𝘨𝘦𝘴 𝘵𝘰 𝘨𝘳𝘰𝘶𝘱 𝘴𝘦𝘵𝘵𝘪𝘯𝘨𝘴';
        footerSlanted = '𝘎𝘳𝘰𝘶𝘱 𝘮𝘦𝘵𝘢𝘥𝘢𝘵𝘢 𝘪𝘴 𝘳𝘦𝘴𝘵𝘳𝘪𝘤𝘵𝘦𝘥';
    } else {
        reasonSlanted = `𝘷𝘪𝘰𝘭𝘢𝘵𝘦𝘥 ${violationReason} 𝘳𝘶𝘭𝘦𝘴`;
        footerSlanted = '𝘗𝘭𝘦𝘢𝘴𝘦 𝘧𝘰𝘭𝘭𝘰𝘸 𝘵𝘩𝘦 𝘨𝘳𝘰𝘶𝘱 𝘨𝘶𝘪𝘥𝘦𝘭𝘪𝘯𝘦𝘴';
    }

    return `🚫───  𝘞𝘢𝘳𝘯𝘪𝘯𝘨 ───🚮\n\n` +
           `𝘝𝘪𝘰𝘭𝘢𝘵𝘰𝘳: @${senderNumber}\n\n` +
           `𝘙𝘦𝘢𝘴𝘰𝘯: ${reasonSlanted}\n\n` +
           `𝘊𝘰𝘶𝘯𝘵: ${count} / ${threshold}\n\n` +
           `> ${footerSlanted}\n` +
           `────────────────`;
}

// ─── LID-SAFE SILENCE CHECK ─────────────────────────────────────
function isUserSilenced(silencedUsers, jid, senderJid) {
    if (!silencedUsers || !silencedUsers[jid]) return null;

    const silencedEntries = silencedUsers[jid];
    const cleanedSender = cleanJid(senderJid);
    const senderNum = cleanedSender.split('@')[0];

    if (silencedEntries[cleanedSender]) {
        return silencedEntries[cleanedSender];
    }

    for (const [key, data] of Object.entries(silencedEntries)) {
        const cleanedKey = cleanJid(key);
        if (cleanedKey === cleanedSender || cleanedKey.split('@')[0] === senderNum) {
            return data;
        }
    }
    return null;
}

// ─── SECURITY POLICY EXECUTION LAYER ───────────────────────────
async function applySecurityPolicy(sock, msg, policy, senderJid, senderNumber, jid, violationReason) {
    if (!policy || policy === 'off') return;

    // POLICY NORMALIZATION: Automatically map 'on' to 'delete'
    const effectivePolicy = policy === 'on' ? 'delete' : policy;

    let resolvedSender = normalizeToJid(senderJid);
    if (resolvedSender.endsWith('@lid')) {
        const resolved = await getPhoneJid(sock, resolvedSender, jid);
        if (resolved && resolved.endsWith('@s.whatsapp.net')) {
            resolvedSender = resolved;
        }
    }

    if (effectivePolicy === 'delete') {
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            const deleteMsgText = `❌ *Message Deleted:* @${senderNumber} violated ${violationReason} rules.`;
            await sock.sendMessage(jid, { text: deleteMsgText, mentions: [resolvedSender] });
        } catch (e) { /* ignore */ }
    } else if (effectivePolicy === 'warn') {
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            const warnKey = `${jid}_${senderNumber}`;
            config.warns = config.warns || {};
            config.warns[warnKey] = (config.warns[warnKey] || 0) + 1;
            const count = config.warns[warnKey];
            const threshold = config.warnThreshold || 5;

            if (count >= threshold) {
                await sock.groupParticipantsUpdate(jid, [resolvedSender], "remove");
                const kickText = `💀 *Domain Expansion: Malevolent Shrine!*\n\nSayonara @${senderNumber}. Warnings exceeded (${count}/${threshold}) for violating ${violationReason} rules.`;
                await sock.sendMessage(jid, { text: kickText, mentions: [resolvedSender] });
                config.warns[warnKey] = 0;
            } else {
                const warningText = getThematicWarning(violationReason, senderNumber, count, threshold);
                await sock.sendMessage(jid, { text: warningText, mentions: [resolvedSender] });
            }
            saveState();
        } catch (e) { /* ignore */ }
    } else if (effectivePolicy === 'kick') {
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            await sock.groupParticipantsUpdate(jid, [resolvedSender], "remove");
            const directKickText = `👋 Exorcised @${senderNumber} for violating ${violationReason} rules.`;
            await sock.sendMessage(jid, { text: directKickText, mentions: [resolvedSender] });
        } catch (e) { /* ignore */ }
    }
}

// ─── ACTIVE SECURITY POLICY INTERCEPTORS ───────────────────────
async function handleGroupSecurity(sock, msg, body, senderJid, senderNumber, jid, mentionedJids, isAuthorized, isDev, isAdmin) {
    const isImmune = isAuthorized || isDev || isAdmin;
    if (isImmune) return false;

    const botJid = sock.user?.id ? cleanJid(sock.user.id) : '';
    const botLid = sock.user?.lid ? cleanJid(sock.user.lid) : (config.botLid || '');
    const isSenderBotItself = (botJid && cleanJid(senderJid) === botJid) || (botLid && cleanJid(senderJid) === botLid);
    if (isSenderBotItself) return false;

    const rawUnwrapped = getRawMessage(msg.message) || msg.message;

    // 1. Antilink Scanner
    const antilinkPolicy = config.antilink?.[jid] || 'off';
    const hasLink = /(https?:\/\/[^\s]+)/i.test(body) || 
                    /(www\.[a-zA-Z0-9-]+(?:\.[a-zA-Z]{2,6})+(?:\/[^\s]*)?)/i.test(body) || 
                    /chat\.whatsapp\.com\/[a-zA-Z0-9]+/i.test(body) ||
                    /wa\.me\/[0-9]+/i.test(body);

    if (hasLink && antilinkPolicy !== 'off') {
        await applySecurityPolicy(sock, msg, antilinkPolicy, senderJid, senderNumber, jid, "Antilink");
        return true;
    }

    // 2. Antibot Scanner (Supports expanded bot message ID signatures)
    const antibotPolicy = config.antibot?.[jid] || 'off';
    const msgId = msg.key.id || '';
    const isBotSender = msgId.startsWith('BAE5') || 
                        msgId.startsWith('3EB0') || 
                        msgId.startsWith('B24E') ||
                        (msgId.length === 12 && !msgId.startsWith('3A')) ||
                        (msgId.length >= 18 && /^[0-9A-F]+$/i.test(msgId));

    if (isBotSender && antibotPolicy !== 'off') {
        await applySecurityPolicy(sock, msg, antibotPolicy, senderJid, senderNumber, jid, "Antibot");
        return true;
    }

    // 3. Antitag Scanner
    const antitagPolicy = config.antitag?.[jid] || 'off';
    const totalMentions = mentionedJids.length;
    const hasGhostTags = totalMentions > 0 && !body.includes('@');
    const mentionsBotLid = botLid && mentionedJids.some(j => cleanJid(j) === botLid);

    const isTaggingEveryone = /@(everyone|here|all)/i.test(body) || 
                              totalMentions >= 5 || 
                              hasGhostTags || 
                              mentionsBotLid;

    if (isTaggingEveryone && antitagPolicy !== 'off') {
        await applySecurityPolicy(sock, msg, antitagPolicy, senderJid, senderNumber, jid, "Antitag");
        return true;
    }

    // 4. Anti-Group-Mention Scanner (Antigm with Status & Context Group Mention Support)
    const antigmPolicy = config.antigm?.[jid] || 'off';
    const isStatusMention = !!(rawUnwrapped?.groupStatusMessageV2 || msg.mtype === "groupStatusMessageV2");
    const hasContextGroupMention = !!(rawUnwrapped?.extendedTextMessage?.contextInfo?.groupMention);

    const isGroupMention = mentionedJids.some(j => j.endsWith('@g.us')) || 
                           /@g\.us/i.test(body) || 
                           /This group was mentioned/i.test(body) ||
                           isStatusMention ||
                           hasContextGroupMention;

    if (isGroupMention && antigmPolicy !== 'off') {
        await applySecurityPolicy(sock, msg, antigmPolicy, senderJid, senderNumber, jid, "Anti-Group-Mention");
        return true;
    }

    return false;
}

// ─── GROUP STATUS PROTECTION ─────────────────────────────────────
async function handleGroupStatusProtection(sock, msg, cleanChatJid, senderNumber, senderJid, isAuthorized, isDev, isAdmin) {
    const isImmune = isAuthorized || isDev || isAdmin;
    if (isImmune) return false;

    const policy = config.antigcstatus || 'off';
    if (policy !== 'off') {
        await applySecurityPolicy(sock, msg, policy, senderJid, senderNumber, cleanChatJid, "Antigcstatus");
        return true;
    }
    return false;
}

// ─── ANTIBUG RATE-LIMIT ──────────────────────────────────────────
async function handleAntibugSpamLimit(sock, msg, senderJid, senderNumber, jid, isAuthorized, isDev, isAdmin) {
    const isImmune = isAuthorized || isDev || isAdmin;
    if (isImmune) return false;

    let resolvedSender = normalizeToJid(senderJid);
    if (resolvedSender.endsWith('@lid')) {
        const resolved = await getPhoneJid(sock, resolvedSender, jid);
        if (resolved && resolved.endsWith('@s.whatsapp.net')) {
            resolvedSender = resolved;
        }
    }

    const now = Date.now();
    global.spamTracker = global.spamTracker || {};
    if (!global.spamTracker[senderJid]) global.spamTracker[senderJid] = [];
    global.spamTracker[senderJid].push(now);
    global.spamTracker[senderJid] = global.spamTracker[senderJid].filter(t => now - t <= 3000);

    if (global.spamTracker[senderJid].length >= 5) {
        try {
            await sock.sendMessage(jid, {
                text: `🚨 *ANTIBUG BAN HAMMER* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n@${senderNumber} has been blocked for spamming/flooding the system.`,
                mentions: [resolvedSender]
            }, { quoted: msg });
            
            await sock.updateBlockStatus(senderJid, 'block');
            await sock.chatModify({ delete: true, lastMessages: [{ key: msg.key, messageTimestamp: msg.messageTimestamp }] }, jid);
            delete global.spamTracker[senderJid];
        } catch (blockErr) { /* ignore */ }
        return true;
    }

    if (global.spamTracker[senderJid].length === 0) {
        delete global.spamTracker[senderJid];
    }
    return false;
}

// ─── ANTISPAM RATE-LIMIT ─────────────────────────────────────────
async function handleAntispamRateLimit(sock, msg, senderJid, senderNumber, jid, isAuthorized, isDev, isAdmin) {
    const isImmune = isAuthorized || isDev || isAdmin;
    if (isImmune) return false;

    let resolvedSender = normalizeToJid(senderJid);
    if (resolvedSender.endsWith('@lid')) {
        const resolved = await getPhoneJid(sock, resolvedSender, jid);
        if (resolved && resolved.endsWith('@s.whatsapp.net')) {
            resolvedSender = resolved;
        }
    }

    const antispamConfig = config.antispam?.[jid];
    if (antispamConfig && antispamConfig.status === 'on') {
        const rate = antispamConfig.rate || { count: 1, seconds: 2 };
        const now = Date.now();
        global.spamTracker = global.spamTracker || {};
        global.spamDeletedCount = global.spamDeletedCount || {};
        
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
                    await sock.sendMessage(jid, { text: alertText, mentions: [resolvedSender] });
                }
            } catch (e) { /* ignore */ }
            return true;
        }

        if (global.spamTracker[senderJid].length === 0) {
            delete global.spamTracker[senderJid];
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