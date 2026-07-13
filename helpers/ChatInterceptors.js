// helpers/ChatInterceptors.js
const config = require('../config');
const { saveState } = require('../stateManager');

// Fallback logic for cleanJid import to safeguard stability
let cleanJid;
try {
    cleanJid = require('./Message').cleanJid;
} catch (e) {
    cleanJid = function(jid) {
        if (!jid) return '';
        const raw = String(jid);
        return raw.split('@')[0].split(':')[0] + '@' + (raw.split('@')[1] || 's.whatsapp.net');
    };
}

// Global properties safe-init
global.spamTracker = global.spamTracker || {};
global.spamDeletedCount = global.spamDeletedCount || {};

// ─── HELPERS ──────────────────────────────────────────────────────

/**
 * Safely unwrap nested WhatsApp message structures
 */
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

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

    // Attempt direct match check first
    if (silencedEntries[cleanedSender]) {
        return silencedEntries[cleanedSender];
    }

    // Fallback comparison loop
    for (const [key, data] of Object.entries(silencedEntries)) {
        const cleanedKey = cleanJid(key);
        if (cleanedKey === cleanedSender) {
            return data;
        }
        const keyNum = cleanedKey.split('@')[0];
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
            
            const deleteMsgText = `❌ *Message Deleted:* @${senderNumber} violated ${violationReason} rules.`;
            await sock.sendMessage(jid, { text: deleteMsgText, mentions: [senderJid] });
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
                
                // Domain Expansion Kick Message
                const kickText = `💀 *Domain Expansion: Malevolent Shrine!*\n\nSayonara @${senderNumber}. Warnings exceeded (${count}/${threshold}) for violating ${violationReason} rules.`;
                await sock.sendMessage(jid, { text: kickText, mentions: [senderJid] });
                config.warns[warnKey] = 0;
            } else {
                // Customized dynamic Warning response
                const warningText = getThematicWarning(violationReason, senderNumber, count, threshold);
                await sock.sendMessage(jid, { text: warningText, mentions: [senderJid] });
            }
            saveState();
        } catch (e) { /* ignore */ }
    } else if (policy === 'kick') {
        try {
            await sock.sendMessage(jid, { delete: msg.key });
            await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
            
            const directKickText = `👋 Exorcised @${senderNumber} for violating ${violationReason} rules.`;
            await sock.sendMessage(jid, { text: directKickText, mentions: [senderJid] });
        } catch (e) { /* ignore */ }
    }
}

// ─── ACTIVE SECURITY POLICY INTERCEPTORS ───────────────────────
async function handleGroupSecurity(sock, msg, body, senderJid, senderNumber, jid, mentionedJids, isAuthorized, isDev, isAdmin) {
    // UNIFIED IMMUNITY: Admins, Sudos, Owners, and Developers are exempt from all group security checks
    const isImmune = isAuthorized || isDev || isAdmin;
    if (isImmune) return false;

    // Fetch local and Lid identity of the bot to prevent self-actions
    const botJid = sock.user?.id ? cleanJid(sock.user.id) : '';
    const botLid = sock.user?.lid ? cleanJid(sock.user.lid) : (config.botLid || '');
    const isSenderBotItself = (botJid && cleanJid(senderJid) === botJid) || (botLid && cleanJid(senderJid) === botLid);
    if (isSenderBotItself) return false;

    // 1. Antilink Domain Scanner (Refined to avoid false-positives on file extensions)
    const antilinkPolicy = config.antilink?.[jid] || 'off';
    const hasLink = /(https?:\/\/[^\s]+)/i.test(body) || 
                    /(www\.[a-zA-Z0-9-]+(?:\.[a-zA-Z]{2,6})+(?:\/[^\s]*)?)/i.test(body) ||
                    /chat\.whatsapp\.com\/[a-zA-Z0-9]+/i.test(body) ||
                    /wa\.me\/[0-9]+/i.test(body);

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

    // 3. Antitag Case-Insensitive Scanner (Includes Ghost Tags & Bot LID Mentions)
    const antitagPolicy = config.antitag?.[jid] || 'off';
    const totalMentions = mentionedJids.length;
    
    // Ghost Tag Detection: Metadata mentions exist, but no visible '@' symbols are inside the message text
    const hasGhostTags = totalMentions > 0 && !body.includes('@');
    
    // Bot LID Mention Detection: Checks if the user is targeting the bot's LID directly
    const mentionsBotLid = botLid && mentionedJids.some(j => cleanJid(j) === botLid);

    const isTaggingEveryone = /@(everyone|here|all)/i.test(body) || 
                              totalMentions >= 5 || 
                              hasGhostTags || 
                              mentionsBotLid;

    if (isTaggingEveryone && antitagPolicy === 'on') {
        await applySecurityPolicy(sock, msg, 'delete', senderJid, senderNumber, jid, "Antitag");
        return true;
    }

    // 4. Anti-Group-Mention (Antigm with status mention support)
    const antigmPolicy = config.antigm?.[jid] || 'off';
    const isGroupMention = mentionedJids.some(j => j.endsWith('@g.us')) || 
                           /@g\.us/i.test(body) || 
                           /This group was mentioned/i.test(body);

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

    const now = Date.now();
    global.spamTracker = global.spamTracker || {};
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

// ─── ANTISPAM RATE-LIMIT ─────────────────────────────────────────
async function handleAntispamRateLimit(sock, msg, senderJid, senderNumber, jid, isAuthorized, isDev, isAdmin) {
    const isImmune = isAuthorized || isDev || isAdmin;
    if (isImmune) return false;

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