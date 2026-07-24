// plugins/group/group_advanced.js
const config = require('../../config');
const { saveState, normalizeToJid } = require('../../stateManager');
const { DEV_LIDS } = require('../devs');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const axios = require('axios');

// ─── GLOBALS  ──────────────────────────────────────────────────────
global.tkickTimers = global.tkickTimers || {};
global.kickallActive = global.kickallActive || {};
global.groupTimers = global.groupTimers || {};

// ─── TIER GRID CONFIGURATION ───────────────────────────────────────
const TIER_DATA = [
    { index: 11, name: "Infinitesimal", req: 0, icon: "🌌", desc: "Lower-dimensional entity unable to affect the 3D world." },
    { index: 10, name: "Human", req: 15, icon: "🏃", desc: "Standard human capabilities up to peak athlete level." },
    { index: 9, name: "Superhuman", req: 45, icon: "⚡", desc: "Street-level fighter. Can smash steel, concrete, or small rooms." },
    { index: 8, name: "Urban", req: 90, icon: "🏢", desc: "Destructive force ranging from single buildings to city blocks." },
    { index: 7, name: "Nuclear / Regional", req: 150, icon: "☄️", desc: "Capable of leveling towns, major cities, or vaporizing mountains." },
    { index: 6, name: "Global", req: 250, icon: "🗺️", desc: "Tectonic force capable of destroying island nations or continents." },
    { index: 5, name: "Planetary", req: 400, icon: "🪐", desc: "Celestial power capable of shattering moons and gas giants." },
    { index: 4, name: "Stellar", req: 600, icon: "☀️", desc: "Cosmic power able to completely obliterate stars and solar systems." },
    { index: 3, name: "Cosmic", req: 800, icon: "🌌", desc: "Reality-spanning scale. Can collapse galaxies and physical matter." },
    { index: 2, name: "Multiversal", req: 900, icon: "🔮", desc: "Manipulates multiple timelines and distinct universes simultaneously." },
    { index: 1, name: "Extradimensional (Outerversal)", req: 1000, icon: "👁️", desc: "Transcends space, time, and dimensional conceptual frameworks." },
    { index: 0, name: "Boundless", req: 1500, icon: "👑", desc: "True omnipotence. Beyond any logical framework or hierarchy." }
];

// ─── HELPERS ──────────────────────────────────────────────────────

function cleanJid(jid) {
    if (!jid) return '';
    const raw = normalizeToJid(jid);
    return raw.split('@')[0].split(':')[0] + '@' + raw.split('@')[1];
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
        return cleanJid(mentions[0]);
    }

    if (contextInfo?.participant) {
        return cleanJid(contextInfo.participant);
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
    const normalized = cleanJid(jid);
    return DEV_LIDS.includes(normalized);
}

function isOwnerTarget(target) {
    const cleaned = cleanJid(target);
    return cleaned === cleanJid(config.ownerJid) ||
           (config.ownerLid && cleaned === cleanJid(config.ownerLid)) ||
           (config.ownerLids && config.ownerLids.map(cleanJid).includes(cleaned)) ||
           (config.secondaryOwners && config.secondaryOwners.map(cleanJid).includes(cleaned));
}

function parseDuration(str) {
    if (!str) return null;
    const match = str.match(/^(\d+)([smh])$/i);
    if (!match) return null;
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
    return null;
}

async function safeResolveToPhoneJid(sock, senderJid) {
    try {
        const stateManager = require('../../stateManager');
        const resolver = stateManager.resolveToPhoneJid || stateManager.getPhoneJid;
        if (resolver) {
            const resolved = await resolver(sock, senderJid);
            if (resolved) return cleanJid(resolved);
        }
    } catch (e) { /* ignore */ }
    return cleanJid(senderJid);
}

// ─── verifyPermissions Helper ──────────────────────
async function verifyPermissions(sock, msg, jid, isOwner, isDev = false, isSudo = false, commandName = '') {
    const senderJid = cleanJid(msg.key.participant || msg.key.remoteJid || '');

    if (isDev) {
        return true;
    }

    const isAuthorized = isOwner || isSudo;
    if (!isAuthorized) return false;

    const exemptCommands = [
        'tag', 'tagall', 'htag', 'admins', 'link', 'invite', 'gclink',
        'gcjid', 'getgpp', 'poll', 'togcstatus', 'togcjid',
        'join', 'exit', 'listonline', 'msgs', 'ranks'
    ];
    if (exemptCommands.includes(commandName.toLowerCase())) {
        return true;
    }

    const groupMetadata = await sock.groupMetadata(jid);
    const participants = groupMetadata.participants;

    const botJid = sock.user?.id ? cleanJid(sock.user.id) : '';
    const botLid = sock.user?.lid ? cleanJid(sock.user.lid) : (config.botLid || '');

    const botParticipant = participants.find(p => {
        const pId = cleanJid(p.id);
        const pLid = p.lid ? cleanJid(p.lid) : '';
        return (botJid && (pId === botJid || pLid === botJid)) ||
               (botLid && (pId === botLid || pLid === botLid));
    });
    const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

    if (!isBotAdmin) {
        await sock.sendMessage(jid, { text: "❌ I must be an administrator in this group first!" }, { quoted: msg });
        return false;
    }

    let sender = participants.find(p => {
        const pId = cleanJid(p.id);
        const pLid = p.lid ? cleanJid(p.lid) : '';
        return pId === senderJid || (pLid && pLid === senderJid);
    });
    const isSenderAdmin = sender?.admin === 'admin' || sender?.admin === 'superadmin';
    if (!isSenderAdmin) {
        await sock.sendMessage(jid, { text: "❌ You must be an administrator in this group to run this command!" }, { quoted: msg });
        return false;
    }

    return true;
}





// ─── COMMAND DEFINITIONS ─────────────────────────────────────────
const advancedGroupCommands = [



// 7. LEVELUP (Alert Toggle)
    {
        name: 'levelup',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'levelup');
            if (!isAuthorized) return;

            const action = args ? args.toLowerCase().trim() : '';
            if (action !== 'on' && action !== 'off') {
                return await sock.sendMessage(jid, { text: `❌ Use: \`${config.prefix}levelup <on/off>\`` }, { quoted: msg });
            }

            config.gcalerts = config.gcalerts || {};
            config.gcalerts.levelup = config.gcalerts.levelup || {};
            config.gcalerts.levelup[jid] = action;

            saveState();
            await sock.sendMessage(jid, { text: `✅ Level Up milestone broadcast alerts have been turned *${action.toUpperCase()}*` }, { quoted: msg });
        }
    },
    
    // 9. RANKS
    {
        name: 'ranks',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;

            let layout = `📊 *Infinite Void — Universal Power Grid (12-Tiers)*\n` +
                         `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            TIER_DATA.forEach(tier => {
                layout += `${tier.icon} *Tier ${tier.index}: ${tier.name}* (${tier.req} Messages)\n` +
                          `_Status: ${tier.desc}_\n\n`;
            });

            layout += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                      `👉 _Scale your typing velocity to breach milestones!_`;

            await sock.sendMessage(jid, { text: layout }, { quoted: msg });
        }
    },

    // 13. CREATEGC
    {
        name: 'creategc',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isAuthorizedMember = isDev || isOwner || isSudo;
            if (!isAuthorizedMember) return;

            if (!args) return await sock.sendMessage(jid, { text: "❌ Provide a group name." }, { quoted: msg });

            try {
                const senderJid = msg.key.participant || msg.key.remoteJid;
                const phoneJid = await safeResolveToPhoneJid(sock, senderJid);
                if (!phoneJid) return await sock.sendMessage(jid, { text: "❌ Resolution failed." }, { quoted: msg });

                const group = await sock.groupCreate(args, [phoneJid]);
                await sock.sendMessage(jid, { text: `• Name: \`${args}\`\n• ID: \`${group.id}\`` }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 14. KICKALL
    {
        name: 'kickall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'kickall');
            if (!isAuthorized) return;

            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants;

                const botJid = cleanJid(sock.user.id);
                const targets = participants.filter(p => {
                    const normId = cleanJid(p.id);
                    return normId !== botJid &&
                           !isOwnerTarget(normId) &&
                           !isDeveloper(normId) &&
                           p.admin !== 'superadmin' && p.admin !== 'admin';
                }).map(p => p.id);

                if (targets.length === 0) return await sock.sendMessage(jid, { text: "❌ No non-admin targets found to exorcise." }, { quoted: msg });

                const durationString = args ? args.trim() : '';
                const countdownMs = durationString ? (parseDuration(durationString) || 20000) : 20000;
                const countdownSecs = countdownMs / 1000;

                const text = `🌪 *Channelling Limitless Void... Exorcism sequence initiated.* Removing all members in *${countdownSecs} seconds*.`;
                const buttonMessage = {
                    text: text,
                    buttons: [
                        { buttonId: `${config.prefix}stopkickall`, buttonText: { displayText: 'Stop Exorcism 🛑' }, type: 1 }
                    ],
                    headerType: 1
                };

                try {
                    await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (btnErr) {
                    await sock.sendMessage(jid, { text: `${text}\n\n💡 _Type:_ \`${config.prefix}stopkickall\` to abort.` }, { quoted: msg });
                }

                global.kickallActive[jid] = true;

                await new Promise(resolve => setTimeout(resolve, countdownMs));

                if (!global.kickallActive[jid]) {
                    return;
                }

                await sock.sendMessage(jid, { text: "🌪 *Countdown elapsed. Beginning exorcism...*" });

                for (const target of targets) {
                    if (!global.kickallActive[jid]) {
                        await sock.sendMessage(jid, { text: "🛑 *Exorcism sequence aborted by administrator.*" });
                        break;
                    }
                    try {
                        await sock.groupParticipantsUpdate(jid, [target], "remove");
                        await new Promise(r => setTimeout(r, 1000));
                    } catch (err) {}
                }

                if (global.kickallActive[jid]) {
                    await sock.sendMessage(jid, { text: "✅ *Exorcism complete.*" });
                }
                delete global.kickallActive[jid];
            } catch (error) {}
        }
    },

    // 15. STOPKICKALL
    {
        name: 'stopkickall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isAuthorizedMember = isDev || isOwner || isSudo;
            if (!isAuthorizedMember) return;

            if (global.kickallActive[jid]) {
                global.kickallActive[jid] = false;
                await sock.sendMessage(jid, { text: "🛑 *Stopping exorcism...*" }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: "❌ No active operation running." }, { quoted: msg });
            }
        }
    },

    // 16. TKICK
    {
        name: 'tkick',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'tkick');
            if (!isAuthorized) return;

            const target = parseTargetUser(msg, args);

            if (target && isDeveloper(target)) {
                return await sock.sendMessage(jid, { text: "🛡️ *Immunity Triggered:* Cannot restrict a Core Developer of this domain." }, { quoted: msg });
            }

            const cleanTargets = (target && !isOwnerTarget(target)) ? [target] : [];

            const durationString = args ? args.replace(/@[^ ]+/g, '').trim().split(' ')[0] : '';
            if (durationString.toLowerCase() === 'cancel' || durationString.toLowerCase() === 'stop') {
                const activeKeys = Object.keys(global.tkickTimers).filter(k => k.startsWith(jid));
                if (activeKeys.length === 0) return await sock.sendMessage(jid, { text: "❌ No pending timed kicks found." }, { quoted: msg });

                activeKeys.forEach(key => {
                    clearTimeout(global.tkickTimers[key].timeoutId);
                    delete global.tkickTimers[key];
                });

                return await sock.sendMessage(jid, { text: "✅ Cancelled all pending timed kicks in this group." }, { quoted: msg });
            }

            if (cleanTargets.length === 0) {
                const activeKeys = Object.keys(global.tkickTimers).filter(k => k.startsWith(jid));
                if (activeKeys.length === 0) return await sock.sendMessage(jid, { text: "❌ No pending timed kicks found." }, { quoted: msg });

                let list = "⏳ *PENDING TIMED KICKS:*\n\n";
                activeKeys.forEach((key, idx) => {
                    const task = global.tkickTimers[key];
                    const remainingSec = Math.max(0, Math.floor((task.endTime - Date.now()) / 1000));
                    list += `${idx + 1}. @${task.targetJid.split('@')[0]} — Remaining: *${remainingSec}s*\n`;
                });
                return await sock.sendMessage(jid, { text: list, mentions: activeKeys.map(k => global.tkickTimers[k].targetJid) }, { quoted: msg });
            }

            const durationMs = parseDuration(durationString);
            if (!durationMs) return await sock.sendMessage(jid, { text: "❌ Invalid duration." }, { quoted: msg });

            for (const targetJid of cleanTargets) {
                const timerKey = `${jid}_${targetJid}`;
                if (global.tkickTimers[timerKey]) clearTimeout(global.tkickTimers[timerKey].timeoutId);

                const timeoutId = setTimeout(async () => {
                    try {
                        await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
                        await sock.sendMessage(jid, { text: `🌪️ *Timer Elapsed.* Exorcised: @${targetJid.split('@')[0]}`, mentions: [targetJid] });
                    } catch (err) {}
                    delete global.tkickTimers[timerKey];
                }, durationMs);

                global.tkickTimers[timerKey] = { timeoutId, targetJid, endTime: Date.now() + durationMs };
            }

            await sock.sendMessage(jid, { text: `⏳ Timed kick set for target.`, mentions: cleanTargets }, { quoted: msg });
        }
    },

// 17. JOIN (Group Invite Link and JID Parser with Quoted Message Support) [1.1]
    {
        name: 'join',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isAuthorized = isDev || isOwner;
            if (!isAuthorized) return;

            // 1. Resolve Target Text (Direct Arguments vs Quoted Message Text) [1.1]
            let targetText = args ? args.trim() : '';
            const rawMsg = getRawMessage(msg.message);
            const contextInfo = rawMsg?.contextInfo ||
                                rawMsg?.extendedTextMessage?.contextInfo ||
                                rawMsg?.imageMessage?.contextInfo ||
                                rawMsg?.videoMessage?.contextInfo;
            const quoted = contextInfo?.quotedMessage;

            if (!targetText && quoted) {
                const rawContent = getRawMessage(quoted);
                targetText = rawContent?.conversation || 
                             rawContent?.extendedTextMessage?.text || 
                             rawContent?.imageMessage?.caption || 
                             rawContent?.videoMessage?.caption || 
                             '';
                targetText = targetText.trim();
            }

            if (!targetText) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a valid WhatsApp group invite link / JID, or reply directly to a message containing the link." }, { quoted: msg });
            }

            const isGroupJid = targetText.endsWith('@g.us') || /^\d{10,25}@g\.us$/.test(targetText);

            // ─── CASE A: TARGET IS A GROUP JID ─── [1.1]
            if (isGroupJid) {
                try {
                    // Check if the bot is already in the group by attempting to fetch metadata [1.1]
                    const metadata = await sock.groupMetadata(targetText);
                    const subject = metadata.subject || 'Unknown Group';
                    return await sock.sendMessage(jid, { text: `✅ The bot is already a member of this group!\n\n• *Name:* \`${subject}\`\n• *JID:* \`${targetText}\`` }, { quoted: msg });
                } catch (err) {
                    // WhatsApp protocol does not allow joining a random JID without an invite link or admin add [1.1]
                    return await sock.sendMessage(jid, { 
                        text: `❌ Cannot join group JID directly.\n\n_Note: To join a group you are not currently in, please provide a valid group invite link instead._` 
                    }, { quoted: msg });
                }
            }

            // ─── CASE B: TARGET IS AN INVITE LINK ─── [1.1]
            const match = targetText.match(/chat.whatsapp.com\/([a-zA-Z0-9]{15,25})/);
            if (!match) {
                return await sock.sendMessage(jid, { text: "❌ Invalid invite link or JID format. Ensure it is a standard invite link or group JID." }, { quoted: msg });
            }

            try {
                const code = match[1];
                const joinedJid = await sock.groupAcceptInvite(code);
                
                // Fetch group subject safely to verify name [1.1]
                let groupName = 'Group';
                try {
                    const metadata = await sock.groupMetadata(joinedJid);
                    groupName = metadata.subject || 'Group';
                } catch (e) { /* ignore */ }

                await sock.sendMessage(jid, { text: `✅ Joined group successfully!\n\n• *Name:* \`${groupName}\`\n• *JID:* \`${joinedJid}\`` }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed to join group: ${e.message}` }, { quoted: msg });
            }
        }
    },
    

    // 18. EXIT
    {
        name: 'exit',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isAuthorized = isDev || isOwner;
            if (!isAuthorized) return;

            const targetJid = args ? args.trim() : jid;
            if (!targetJid.endsWith('@g.us')) {
                return await sock.sendMessage(jid, { text: "❌ Please run this in a group, or specify a valid group JID." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(targetJid, { text: "👋 Deactivating Infinite Void. Leaving group!" });
                await sock.groupLeave(targetJid);
                if (targetJid !== jid) {
                    await sock.sendMessage(jid, { text: "✅ Successfully left group." }, { quoted: msg });
                }
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed to leave group: ${e.message}` }, { quoted: msg });
            }
        }
    },

// 19. GCSTATUS (Silent Group Status Upload)
    {
        name: 'gcstatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            // Direct permission check (bypasses missing verifyPermissions function)
            const isAuthorized = isOwner || isSudo || isDev;
            if (!isAuthorized) return;

            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const rawContent = quoted ? getRawMessage(quoted) : null;
            try {
                const { downloadContentFromMessage, prepareWAMessageMedia, generateWAMessageFromContent, proto } = await import('@itsliaaa/baileys');
                let messagePayload = {};
                let mediaType = null;
                let buffer = null;
                let caption = '';
                let targetMsg = null; // Correctly scoped outside the block

                if (rawContent?.imageMessage || rawContent?.videoMessage || rawContent?.audioMessage) {
                    mediaType = rawContent.imageMessage ? 'image' : (rawContent.videoMessage ? 'video' : 'audio');
                    targetMsg = rawContent[mediaType + 'Message'];
                    const stream = await downloadContentFromMessage(targetMsg, mediaType);
                    let buf = Buffer.from([]);
                    for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
                    buffer = buf;
                    caption = targetMsg.caption || '';
                }

                if (buffer) {
                    const mediaOptions = mediaType === 'image' ? { image: buffer, caption } :
                                       (mediaType === 'video' ? { video: buffer, caption } :
                                       { audio: buffer, mimetype: targetMsg.mimetype, ptt: targetMsg.ptt || false, seconds: targetMsg.seconds });
                    const prepared = await prepareWAMessageMedia(mediaOptions, { upload: sock.waUploadToServer });
                    const msgObj = {};
                    if (mediaType === 'image') msgObj.imageMessage = prepared.imageMessage;
                    else if (mediaType === 'video') msgObj.videoMessage = prepared.videoMessage;
                    else msgObj.audioMessage = prepared.audioMessage;
                    messagePayload = { groupStatusMessageV2: { message: msgObj } };
                } else {
                    const text = (Array.isArray(args) ? args.join(' ').trim() : args) || quoted?.conversation || quoted?.extendedTextMessage?.text || '';
                    if (!text) return; // Silent exit
                    const randomHex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
                    const bgColor = (0xff000000 + parseInt(randomHex, 16)) | 0; // Force signed 32-bit conversion
                    messagePayload = { groupStatusMessageV2: { message: { extendedTextMessage: { text, backgroundArgb: bgColor, font: 2 } } } };
                }

                const statusMsg = generateWAMessageFromContent(jid, proto.Message.fromObject(messagePayload), { userJid: sock.user.id });
                await sock.relayMessage(jid, statusMsg.message, { messageId: statusMsg.key.id });
                
                // Silent execution: No message reactions, success messages, or error notifications are sent to the chat.
            } catch (e) {
                console.error("[gcstatus Error]:", e.message);
            }
        }
    },

  

    // 20. POLL
    {
        name: 'poll',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'poll');
            if (!isAuthorized) return;

            const match = args ? args.match(/^(.+?)\s*\((.+?)\)$/) : null;
            if (!match) return await sock.sendMessage(jid, { text: "❌ Format: Question? (Option1/Option2)" }, { quoted: msg });

            const question = match[1].trim();
            const options = match[2].split('/').map(o => o.trim()).filter(o => o);

            if (options.length < 2) return await sock.sendMessage(jid, { text: "❌ Minimum 2 options required." }, { quoted: msg });

            try {
                await sock.sendMessage(jid, { poll: { name: question, values: options, selectableCount: 1 } }, { quoted: msg });
            } catch (e) {}
        }
    },

    // 21. HTAG
    {
        name: 'htag',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'htag');
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

            try {
                await sock.sendMessage(jid, { delete: msg.key });
            } catch (err) {}
        }
    },

    // 22. SPAMTAG
    {
        name: 'spamtag',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'spamtag');
            if (!isAuthorized) return;

            if (!args) {
                return await sock.sendMessage(jid, {
                    text: `❌ *Usage:* \`${config.prefix}spamtag <number> <text>\` or reply directly to a message with \`${config.prefix}spamtag <number>\``
                }, { quoted: msg });
            }

            const parts = args.trim().split(' ');
            const count = parseInt(parts[0]);
            if (isNaN(count) || count < 1) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a valid loop number." }, { quoted: msg });
            }

            const finalCount = Math.min(count, 30);

            let textToSend = parts.slice(1).join(' ').trim();
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!textToSend && quoted) {
                const rawContent = getRawMessage(quoted);
                textToSend = rawContent?.conversation || rawContent?.extendedTextMessage?.text || rawContent?.imageMessage?.caption || '';
            }

            if (!textToSend) textToSend = "🔔 *Attention Everyone!*";

            const groupMetadata = await sock.groupMetadata(jid);
            const participants = groupMetadata.participants.map(p => p.id);

            for (let i = 0; i < finalCount; i++) {
                await sock.sendMessage(jid, { text: textToSend, mentions: participants });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
];

// ─── GENERATE ALIASES ─────────────────────────────────────────────
const aliases = [];
advancedGroupCommands.forEach(cmd => {
    if (cmd.name === 'exit') {
        aliases.push({ ...cmd, name: 'leave' });
    }
    if (cmd.name === 'htag') {
        aliases.push({ ...cmd, name: 'ghost' });
    }
});
advancedGroupCommands.push(...aliases);

module.exports = advancedGroupCommands;