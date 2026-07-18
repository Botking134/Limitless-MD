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
    // 1. WELCOME
    {
        name: 'welcome',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'welcome');
            if (!isAuthorized) return;

            const action = args ? args.toLowerCase().trim() : '';
            if (action !== 'on' && action !== 'off') {
                return await sock.sendMessage(jid, { text: `❌ Use: \`${config.prefix}welcome <on/off>\`` }, { quoted: msg });
            }

            config.gcalerts = config.gcalerts || {};
            config.gcalerts.welcome = config.gcalerts.welcome || {};
            config.gcalerts.welcome[jid] = action;

            config.welcome = config.welcome || {};
            config.welcome[jid] = config.welcome[jid] || {};
            config.welcome[jid].active = (action === 'on');

            saveState();
            await sock.sendMessage(jid, { text: `✅ Welcome alerts have been turned *${action.toUpperCase()}*` }, { quoted: msg });
        }
    },

    // 2. GOODBYE
    {
        name: 'goodbye',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'goodbye');
            if (!isAuthorized) return;

            const action = args ? args.toLowerCase().trim() : '';
            if (action !== 'on' && action !== 'off') {
                return await sock.sendMessage(jid, { text: `❌ Use: \`${config.prefix}goodbye <on/off>\`` }, { quoted: msg });
            }

            config.gcalerts = config.gcalerts || {};
            config.gcalerts.goodbye = config.gcalerts.goodbye || {};
            config.gcalerts.goodbye[jid] = action;

            config.goodbye = config.goodbye || {};
            config.goodbye[jid] = config.goodbye[jid] || {};
            config.goodbye[jid].active = (action === 'on');

            saveState();
            await sock.sendMessage(jid, { text: `✅ Goodbye alerts have been turned *${action.toUpperCase()}*` }, { quoted: msg });
        }
    },

    // 3. SETWELCOME
    {
        name: 'setwelcome',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'setwelcome');
            if (!isAuthorized) return;

            if (!args || !args.trim()) {
                return await sock.sendMessage(jid, { text: `❌ Please provide custom welcome layout.\nExample: \`${config.prefix}setwelcome Welcome @user to @group!\`` }, { quoted: msg });
            }

            config.welcome = config.welcome || {};
            config.welcome[jid] = config.welcome[jid] || {};
            config.welcome[jid].msg = args.trim();
            config.welcome[jid].active = true;

            config.gcalerts = config.gcalerts || {};
            config.gcalerts.welcome = config.gcalerts.welcome || {};
            config.gcalerts.welcome[jid] = 'on';

            saveState();
            await sock.sendMessage(jid, { text: "✅ Custom welcome message set and activated." }, { quoted: msg });
        }
    },

    // 4. SETGOODBYE
    {
        name: 'setgoodbye',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'setgoodbye');
            if (!isAuthorized) return;

            if (!args || !args.trim()) {
                return await sock.sendMessage(jid, { text: `❌ Please provide custom goodbye layout.\nExample: \`${config.prefix}setgoodbye Goodbye @user!\`` }, { quoted: msg });
            }

            config.goodbye = config.goodbye || {};
            config.goodbye[jid] = config.goodbye[jid] || {};
            config.goodbye[jid].msg = args.trim();
            config.goodbye[jid].active = true;

            config.gcalerts = config.gcalerts || {};
            config.gcalerts.goodbye = config.gcalerts.goodbye || {};
            config.gcalerts.goodbye[jid] = 'on';

            saveState();
            await sock.sendMessage(jid, { text: "✅ Custom goodbye message set and activated." }, { quoted: msg });
        }
    },

    // 5. PROMOTION
    {
        name: 'promotion',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'promotion');
            if (!isAuthorized) return;

            const action = args ? args.toLowerCase().trim() : '';
            if (action !== 'on' && action !== 'off') {
                return await sock.sendMessage(jid, { text: `❌ Use: \`${config.prefix}promotion <on/off>\`` }, { quoted: msg });
            }

            config.gcalerts = config.gcalerts || {};
            config.gcalerts.promote = config.gcalerts.promote || {};
            config.gcalerts.promote[jid] = action;

            saveState();
            await sock.sendMessage(jid, { text: `✅ Promotion alerts have been turned *${action.toUpperCase()}*` }, { quoted: msg });
        }
    },

    // 6. DEMOTION
    {
        name: 'demotion',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'demotion');
            if (!isAuthorized) return;

            const action = args ? args.toLowerCase().trim() : '';
            if (action !== 'on' && action !== 'off') {
                return await sock.sendMessage(jid, { text: `❌ Use: \`${config.prefix}demotion <on/off>\`` }, { quoted: msg });
            }

            config.gcalerts = config.gcalerts || {};
            config.gcalerts.demote = config.gcalerts.demote || {};
            config.gcalerts.demote[jid] = action;

            saveState();
            await sock.sendMessage(jid, { text: `✅ Demotion alerts have been turned *${action.toUpperCase()}*` }, { quoted: msg });
        }
    },

    // 8. GCALERTS (Consolidated Alert Dashboard)
    {
        name: 'gcalerts',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return await sock.sendMessage(jid, { text: "❌ Group required." }, { quoted: msg });

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner, isDev, isSudo, 'gcalerts');
            if (!isAuthorized) return;

            config.gcalerts = config.gcalerts || { promote: {}, demote: {}, welcome: {}, goodbye: {} };

            const rawAction = args ? args.toLowerCase().trim() : '';

            // Master enable/disable
            if (rawAction === 'on' || rawAction === 'off') {
                const targetState = rawAction;
                const statusFlag = (targetState === 'on');

                config.gcalerts.promote = config.gcalerts.promote || {};
                config.gcalerts.demote = config.gcalerts.demote || {};
                config.gcalerts.welcome = config.gcalerts.welcome || {};
                config.gcalerts.goodbye = config.gcalerts.goodbye || {};

                config.gcalerts.promote[jid] = targetState;
                config.gcalerts.demote[jid] = targetState;
                config.gcalerts.welcome[jid] = targetState;
                config.gcalerts.goodbye[jid] = targetState;

                config.welcome = config.welcome || {};
                config.welcome[jid] = config.welcome[jid] || {};
                config.welcome[jid].active = statusFlag;

                config.goodbye = config.goodbye || {};
                config.goodbye[jid] = config.goodbye[jid] || {};
                config.goodbye[jid].active = statusFlag;

                saveState();
                return await sock.sendMessage(jid, { text: `✅ *All alerts have been turned ${targetState.toUpperCase()} for this group!*` }, { quoted: msg });
            }

            // Dashboard Status Display
            const welStatus = config.gcalerts.welcome?.[jid] || 'off';
            const gbStatus = config.gcalerts.goodbye?.[jid] || 'off';
            const promStatus = config.gcalerts.promote?.[jid] || 'off';
            const demStatus = config.gcalerts.demote?.[jid] || 'off';

            return await sock.sendMessage(jid, {
                text: `🔔 *Group Alerts Status Dashboard* 🔔\n` +
                      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                      `• *Welcome Alert:* \`${welStatus.toUpperCase()}\` (Linked: .welcome)\n` +
                      `• *Goodbye Alert:* \`${gbStatus.toUpperCase()}\` (Linked: .goodbye)\n` +
                      `• *Promote Alert:* \`${promStatus.toUpperCase()}\` (Linked: .promotion)\n` +
                      `• *Demote Alert:* \`${demStatus.toUpperCase()}\` (Linked: .demotion)\n\n` +
                      `👉 To toggle all alerts: \`${config.prefix}gcalerts <on/off>\`\n` +
                      `👉 To toggle individual alerts: \`welcome\`, \`goodbye\`, \`promotion\`, or \`demotion\``
            }, { quoted: msg });
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

    // 17. JOIN
    {
        name: 'join',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;
            const isAuthorized = isDev || isOwner;
            if (!isAuthorized) return;

            if (!args) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a valid WhatsApp group invite link." }, { quoted: msg });
            }

            const match = args.match(/chat.whatsapp.com\/([a-zA-Z0-9]{15,25})/);
            if (!match) {
                return await sock.sendMessage(jid, { text: "❌ Invalid invite link format." }, { quoted: msg });
            }

            try {
                const code = match[1];
                const joinedJid = await sock.groupAcceptInvite(code);
                await sock.sendMessage(jid, { text: `✅ Joined group successfully! JID: \`${joinedJid}\`` }, { quoted: msg });
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