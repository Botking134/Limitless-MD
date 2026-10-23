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
        reasonSlanted = '𝘢u𝘵𝘰𝘮𝘢𝘵𝘦𝘥 𝘣𝘰𝘵 𝘢𝘤𝘵𝘪𝘷𝘪𝘵𝘺 𝘥𝘦𝘵𝘦𝘤𝘵𝘦𝘥';
        footerSlanted = '𝘖𝘯𝘭𝘺 𝘩𝘶𝘮𝘢𝘯𝘴 𝘢𝘭𝘭𝘰𝘸𝘦𝘥 𝘩𝘦𝘳𝘦';
    } else if (reason === 'anti-group-mention') {
        reasonSlanted = '𝘪𝘭𝘭𝘦𝘨𝘢𝘭 𝘨𝘳𝘰𝘶𝘱 𝘰𝘳 𝘴𝘵𝘢𝘵𝘶𝘴 𝘮𝘦𝘯𝘵𝘪𝘰𝘯';
        footerSlanted = '𝘎𝘳𝘰𝘶𝘱 / 𝘴𝘵𝘢𝘵𝘶𝘴 𝘮𝘦𝘯𝘵𝘪𝘰𝘯𝘴 𝘢𝘳𝘦 𝘯𝘰𝘵 𝘢𝘭𝘭𝘰𝘸𝘦𝘥';
    } else if (reason === 'antigcstatus') {
        reasonSlanted = '𝘶𝘯𝘢𝘶𝘵𝘩𝘰𝘳𝘪𝘻𝘦𝘥 𝘨𝘳𝘰𝘶𝘱 𝘴𝘵𝘢𝘵𝘶𝘴 𝘱𝘰𝘴𝘵';
        footerSlanted = '𝘎𝘳𝘰𝘶𝘱 𝘴𝘵𝘢𝘵𝘶𝘴 𝘱𝘰𝘴𝘵𝘴 𝘢𝘳𝘦 𝘯𝘰𝘵 𝘢𝘭𝘭𝘰𝘸𝘦𝘥';
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

// ─── FAST, VISIBLE MESSAGE DELETION ─────────────────────────────
// Revoke needs the full key (chat, id, and for other people's messages the
// participant). Failures used to be swallowed silently, which made "it doesn't
// delete" impossible to diagnose, so they are logged with the key that was used.
async function deleteOffendingMessage(sock, jid, msg, reason = '') {
    const key = {
        remoteJid: msg.key?.remoteJid || jid,
        id: msg.key?.id,
        fromMe: false,
        participant: msg.key?.participant || msg.participant || undefined
    };
    let accepted = false;
    try {
        await sock.sendMessage(key.remoteJid, { delete: key });
        console.log(`[SECURITY] Delete request sent for ${key.id} (${reason || 'policy'}), participant=${key.participant || 'none'}`);
        accepted = true;
    } catch (err) {
        console.error(`[SECURITY] Delete failed (${reason || 'policy'}):`, err?.message || err, JSON.stringify(key));
    }

    // Group status posts and status mentions sometimes survive the plain revoke: WhatsApp accepts
    // the request and the post stays. So follow up with the other two revoke forms (the same forms
    // .testdel tries). Extra revokes on an already-deleted message are ignored. This runs in the
    // background so the warning below isn't held up.
    if (/status|mention/i.test(reason || '')) {
        (async () => {
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            try {
                await wait(800);
                if (key.participant && key.participant.endsWith('@lid')) {
                    const phone = await getPhoneJid(sock, key.participant, key.remoteJid);
                    if (phone && phone !== key.participant) {
                        await sock.sendMessage(key.remoteJid, { delete: { ...key, participant: phone } });
                        console.log(`[SECURITY] Follow-up revoke (phone participant) sent for ${key.id}`);
                    }
                }
                await wait(800);
                await sock.relayMessage(key.remoteJid, { protocolMessage: { key, type: 0 } }, { additionalAttributes: { edit: '7' } });
                console.log(`[SECURITY] Follow-up revoke (edit=7) sent for ${key.id}`);
            } catch (err) {
                console.error('[SECURITY] Follow-up revoke error:', err?.message || err);
            }
        })();
    }
    return accepted;
}

// ─── SECURITY POLICY EXECUTION LAYER ───────────────────────────
async function applySecurityPolicy(sock, msg, policy, senderJid, senderNumber, jid, violationReason) {
    if (!policy || policy === 'off') return;

    // POLICY NORMALIZATION: Automatically map 'on' to 'delete'
    const effectivePolicy = policy === 'on' ? 'delete' : policy;

    // Plain-language label for the notices below ("violated group status rules")
    const reasonLabel = ({ 'antigcstatus': 'group status', 'anti-group-mention': 'group mention' })[String(violationReason).trim().toLowerCase()] || violationReason;

    // Delete FIRST. This used to run after the sender's LID was resolved to a phone
    // number (a network lookup), which is time the offending post stayed visible.
    await deleteOffendingMessage(sock, jid, msg, violationReason);

    let resolvedSender = normalizeToJid(senderJid);
    if (resolvedSender.endsWith('@lid')) {
        const resolved = await getPhoneJid(sock, resolvedSender, jid);
        if (resolved && resolved.endsWith('@s.whatsapp.net')) {
            resolvedSender = resolved;
        }
    }
    // For the actual @mention shown in the group, use the original,
    // unconverted JID rather than resolvedSender. Mentioning someone via
    // their raw @lid JID lets the WhatsApp client resolve it to their
    // display name; forcing it to a phone-number JID first (what
    // resolvedSender does) is why antilink/antitag/antibot/etc. mentions
    // showed a bare number while addowner — which never does this
    // conversion — showed a username. resolvedSender is kept for kicking
    // and warn-count keys, where a stable phone-number identity matters
    // more than mention rendering.
    const mentionJid = normalizeToJid(senderJid);

    // Helper to resolve the exact participant ID from group metadata for kicking
    async function getKickTargets(target) {
        let targets = [target];
        try {
            const meta = await sock.groupMetadata(jid);
            const cleanT = cleanJid(target);
            const match = meta.participants?.find(p => cleanJid(p.id) === cleanT || (p.lid && cleanJid(p.lid) === cleanT));
            if (match && match.id) {
                targets = [match.id];
            }
        } catch (e) {}
        return targets;
    }

    if (effectivePolicy === 'delete') {
        try {
            const deleteMsgText = `❌ *Message Deleted:* @${senderNumber} violated ${reasonLabel} rules.`;
            await sock.sendMessage(jid, { text: deleteMsgText, mentions: [mentionJid] });
        } catch (e) { /* ignore */ }
    } else if (effectivePolicy === 'warn') {
        try {
            const warnKey = `${jid}_${senderNumber}`;
            config.warns = config.warns || {};
            config.warns[warnKey] = (config.warns[warnKey] || 0) + 1;
            const count = config.warns[warnKey];
            const threshold = Number(config.warnThreshold) || 5;

            if (count >= threshold) {
                const kickTargets = await getKickTargets(resolvedSender);
                try {
                    await sock.groupParticipantsUpdate(jid, kickTargets, "remove");
                } catch (kErr) {
                    console.error("❌ [SECURITY KICK ERROR]:", kErr.message);
                }
                const kickText = `💀 *Domain Expansion: Malevolent Shrine!*\n\nSayonara @${senderNumber}. Warnings exceeded (${count}/${threshold}) for violating ${reasonLabel} rules.`;
                await sock.sendMessage(jid, { text: kickText, mentions: [mentionJid] });
                config.warns[warnKey] = 0;
            } else {
                const warningText = getThematicWarning(violationReason, senderNumber, count, threshold);
                await sock.sendMessage(jid, { text: warningText, mentions: [mentionJid] });
            }
            saveState();
        } catch (e) {
            console.error("❌ [WARN POLICY ERROR]:", e.message);
        }
    } else if (effectivePolicy === 'kick') {
        try {
            const kickTargets = await getKickTargets(resolvedSender);
            await sock.groupParticipantsUpdate(jid, kickTargets, "remove");
            const directKickText = `👋 Exorcised @${senderNumber} for violating ${reasonLabel} rules.`;
            await sock.sendMessage(jid, { text: directKickText, mentions: [mentionJid] });
        } catch (e) {
            console.error("❌ [KICK POLICY ERROR]:", e.message);
        }
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

    // 4. Anti-Group-Mention Scanner (Antigm — catches the GROUP ITSELF being
    // @-mentioned/tagged, as opposed to antigcstatus below, which is the
    // separate guard over the bot's own gcstatus command / native group
    // status posts. These used to collide: both watched groupStatusMessageV2,
    // and because this scanner runs first and returns early, it silently
    // swallowed every groupStatusMessageV2 event before antigcstatus ever
    // got a turn — so antigcstatus only ever fired when antigm was off.
    // They're now split by actual WhatsApp message/proto type:
    //   antigm        → contextInfo.groupMentions (real @group tag),
    //                    groupMentionedMessage, groupStatusMentionMessage
    //                    (a status that mentions this group)
    //   antigcstatus  → groupStatusMessage / groupStatusMessageV2
    //                    (an actual post TO the group's status)
    const antigmPolicy = config.antigm?.[jid] || 'off';

    // NOTE: rawUnwrapped has already been unwrapped by getRawMessage(), which
    // recurses into wrapper types and returns the inner content directly — so
    // top-level message-type fields (groupMentionedMessage, groupStatusMentionMessage,
    // etc.) must be checked against the original, non-unwrapped msg.message,
    // same pattern used in Infinity.js for groupStatusMessageV2.
    const isGroupMentionedViaStatus = !!msg.message?.groupStatusMentionMessage;
    const hasGroupMentionedMessage = !!msg.message?.groupMentionedMessage;

    // Real WhatsApp "@group" tags live in contextInfo.groupMentions — a
    // REPEATED array of { groupJid, groupSubject }, not a singular
    // "groupMention" field. The old check (`contextInfo?.groupMention`,
    // singular) was reading a field that doesn't exist on the proto and was
    // always undefined, so an actual @group tag in a message never tripped
    // this scanner at all.
    const msgContextInfo = rawUnwrapped?.contextInfo ||
                           rawUnwrapped?.extendedTextMessage?.contextInfo ||
                           rawUnwrapped?.imageMessage?.contextInfo ||
                           rawUnwrapped?.videoMessage?.contextInfo ||
                           rawUnwrapped?.stickerMessage?.contextInfo ||
                           rawUnwrapped?.audioMessage?.contextInfo ||
                           rawUnwrapped?.documentMessage?.contextInfo;
    const contextGroupMentions = msgContextInfo?.groupMentions || [];
    const hasContextGroupMention = Array.isArray(contextGroupMentions) && contextGroupMentions.length > 0;

    const isGroupMention = mentionedJids.some(j => j.endsWith('@g.us')) ||
                           /@g\.us/i.test(body) ||
                           /This group was mentioned/i.test(body) ||
                           isGroupMentionedViaStatus ||
                           hasGroupMentionedMessage ||
                           hasContextGroupMention;

    if (isGroupMention && antigmPolicy !== 'off') {
        await applySecurityPolicy(sock, msg, antigmPolicy, senderJid, senderNumber, jid, "Anti-Group-Mention");
        return true;
    }

    return false;
}

// ─── GROUP STATUS PROTECTION ─────────────────────────────────────
// Guards the groupStatusMessage / groupStatusMessageV2 territory — the same
// message shape the bot's own .gcstatus command relays (see
// plugins/group/group_advanced.js). Scoped per-group via jid, same as every
// other anti-* policy (config.antigcstatus[jid]), not a single bot-wide flag
// — it used to be a bare string (config.antigcstatus = "off"/"warn"/...),
// meaning turning it on in one group silently turned it on in every group
// the bot is in at once.
async function handleGroupStatusProtection(sock, msg, cleanChatJid, senderNumber, senderJid, isAuthorized, isDev, isAdmin) {
    const isImmune = isAuthorized || isDev || isAdmin;
    if (isImmune) return false;

    // antigcstatus was merged into antigm: one setting covers group status posts and group mentions
    const policy = config.antigm?.[cleanChatJid] || 'off';
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

    // Kept as the original, unconverted JID (not resolved to a phone-number
    // JID) so the @mention below shows the person's display name via
    // WhatsApp's own @lid resolution, instead of a bare number.
    const mentionJid = normalizeToJid(senderJid);

    const now = Date.now();
    global.spamTracker = global.spamTracker || {};
    if (!global.spamTracker[senderJid]) global.spamTracker[senderJid] = [];
    global.spamTracker[senderJid].push(now);
    global.spamTracker[senderJid] = global.spamTracker[senderJid].filter(t => now - t <= 3000);

    if (global.spamTracker[senderJid].length >= 5) {
        try {
            await sock.sendMessage(jid, {
                text: `🚨 *ANTIBUG BAN HAMMER* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n@${senderNumber} has been blocked for spamming/flooding the system.`,
                mentions: [mentionJid]
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

    // Same reasoning as handleAntibugSpamLimit above: left unconverted so
    // the @mention resolves to a display name instead of a bare number.
    const mentionJid = normalizeToJid(senderJid);

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
                    const alertText = `🚨 *SPAM ATTACK DETECTED* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n@${senderNumber} rate-limit violated! Admins, choose an action below or use \`${config.prefix}kick @${senderNumber}\` manually.`;
                    const alertMessage = {
                        text: alertText,
                        mentions: [mentionJid],
                        buttons: [
                            { buttonId: `${config.prefix}delspam ${senderNumber}`, buttonText: { displayText: '🧹 Delete Spam' }, type: 1 },
                            { buttonId: `${config.prefix}warn ${senderNumber}`, buttonText: { displayText: '⚠️ Warn' }, type: 1 },
                            { buttonId: `${config.prefix}kick ${senderNumber}`, buttonText: { displayText: '👢 Kick' }, type: 1 }
                        ],
                        headerType: 1
                    };
                    try {
                        await sock.sendMessage(jid, alertMessage);
                    } catch (btnErr) {
                        // Fall back to a plain-text alert if buttons aren't supported
                        // in this chat/client (mirrors the pattern used elsewhere,
                        // e.g. group_basic.js's gmode panel).
                        await sock.sendMessage(jid, { text: alertText, mentions: [mentionJid] });
                    }
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