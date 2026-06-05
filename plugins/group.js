// plugins/group.js
const settings = require('../settings'); // Up one level to settings.js
const { saveSettings } = require('../settingsSaver'); // Save straight to settings.js

// Timed tasks and mass-actions storage
if (!global.tkickTimers) global.tkickTimers = {};
if (!global.kickallActive) global.kickallActive = {};

// Reusable Helper to verify if the sender has admin/owner rights (LID-Safe)
async function verifyPermissions(sock, msg, jid, isOwner) {
    const groupMetadata = await sock.groupMetadata(jid);
    const participants = groupMetadata.participants;

    const senderJid = msg.key.participant || msg.key.remoteJid || '';
    
    let sender = participants.find(p => p.id === senderJid);
    
    if (!sender && senderJid.endsWith('@lid')) {
        try {
            const resolved = await sock.findUserId(senderJid);
            if (resolved && resolved.phoneNumber) {
                sender = participants.find(p => p.id === resolved.phoneNumber);
            }
        } catch (e) {}
    }

    if (!sender) {
        try {
            const resolvedSender = await sock.findUserId(senderJid);
            if (resolvedSender && resolvedSender.lid) {
                sender = participants.find(p => p.id === resolvedSender.lid);
            }
        } catch (e) {}
    }
    
    const isAdmin = sender?.admin === 'admin' || sender?.admin === 'superadmin';

    return isAdmin || isOwner;
}

// Reusable Helper to parse target user from message (LID-Safe)
function parseTargetUser(msg, args) {
    let targetJid = '';
    
    const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
    if (mentions && mentions.length > 0) {
        targetJid = mentions[0];
    } 
    else if (msg.message.extendedTextMessage?.contextInfo?.participant) {
        targetJid = msg.message.extendedTextMessage.contextInfo.participant;
    } 
    else if (args) {
        targetJid = args.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    }
    
    return targetJid;
}

// Duration string parser (e.g., '10s' -> 10000ms, '5m' -> 300000ms, '1h' -> 3600000ms)
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

module.exports = [
    // 1. TIMED GROUP MODE
    {
        name: 'gmode',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ This command can only be used inside group chats." }, { quoted: msg });
            }

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) {
                    return await sock.sendMessage(jid, { text: "❌ Only Group Administrators can run this command." }, { quoted: msg });
                }

                if (!args) {
                    return await sock.sendMessage(jid, { 
                        text: `🔮 *Group Mode Settings:*\n\n` +
                              `• \`${settings.prefix}gmode open <duration>\` — Unlock group (e.g. open 10m).\n` +
                              `• \`${settings.prefix}gmode close <duration>\` — Lock group (e.g. close 1h).` 
                    }, { quoted: msg });
                }

                const parts = args.split(' ');
                const action = parts[0].toLowerCase().trim();
                const timeString = parts[1] || '';
                const durationMs = timeString ? parseDuration(timeString) : null;

                if (action === 'open' || action === 'unlock') {
                    await sock.groupSettingUpdate(jid, 'not_announcement');
                    let timeNotice = "";

                    if (durationMs) {
                        timeNotice = `\n_This domain will automatically close in ${timeString}._`;
                        if (settings.groupTimers[jid]) clearTimeout(settings.groupTimers[jid]);
                        settings.groupTimers[jid] = setTimeout(async () => {
                            await sock.groupSettingUpdate(jid, 'announcement');
                            await sock.sendMessage(jid, { 
                                text: "🔒 *Group Status Updated:*\n\nTime is up. Infinite Void restricted. Only Administrators can speak." 
                            });
                            delete settings.groupTimers[jid];
                        }, durationMs);
                    }

                    await sock.sendMessage(jid, { 
                        text: `🔓 *Group Status Updated:*\n\nUnlimited Void expanded. Everyone is now free to speak.${timeNotice}` 
                    }, { quoted: msg });

                } else if (action === 'close' || action === 'lock') {
                    await sock.groupSettingUpdate(jid, 'announcement');
                    let timeNotice = "";

                    if (durationMs) {
                        timeNotice = `\n_This domain will automatically open in ${timeString}._`;
                        if (settings.groupTimers[jid]) clearTimeout(settings.groupTimers[jid]);
                        settings.groupTimers[jid] = setTimeout(async () => {
                            await sock.groupSettingUpdate(jid, 'not_announcement');
                            await sock.sendMessage(jid, { 
                                text: "🔓 *Group Status Updated:*\n\nTime is up. Unlimited Void expanded. Everyone is now free to speak." 
                            });
                            delete settings.groupTimers[jid];
                        }, durationMs);
                    }

                    await sock.sendMessage(jid, { 
                        text: `🔒 *Group Status Updated:*\n\nInfinite Void restricted. Only Administrators can speak.${timeNotice}` 
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: "❌ Invalid action. Use `open` or `close` followed by time (e.g. `open 5m`)." }, { quoted: msg });
                }

            } catch (error) {
                console.error("Group Mode Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to change group settings. Ensure the bot is an admin." }, { quoted: msg });
            }
        }
    },

    // 2. KICK MEMBER (Supports Multi-Mentions)
    {
        name: 'kick',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) return await sock.sendMessage(jid, { text: "❌ This command can only be used inside groups." }, { quoted: msg });

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin privileges required." }, { quoted: msg });

                // Multi-Target Parser: extract all mentions or fallback to quoted target
                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const targets = mentions.length > 0 ? mentions : [parseTargetUser(msg, args)];

                const cleanTargets = targets.filter(t => t && t.split('@')[0] !== settings.ownerNumber);

                if (cleanTargets.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ No valid targets provided." }, { quoted: msg });
                }

                for (const target of cleanTargets) {
                    await sock.groupParticipantsUpdate(jid, [target], "remove");
                }

                await sock.sendMessage(jid, { 
                    text: `👋 Exorcised ${cleanTargets.length} target(s) from this domain.\n\nKuso yaro 🥷`,
                    mentions: cleanTargets
                }, { quoted: msg });

            } catch (error) {
                console.error("Kick Error:", error);
            }
        }
    },

    // 3. PROMOTE TO ADMIN (Supports Multi-Mentions)
    {
        name: 'promote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) return await sock.sendMessage(jid, { text: "❌ Group required." }, { quoted: msg });

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin privileges required." }, { quoted: msg });

                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const targets = mentions.length > 0 ? mentions : [parseTargetUser(msg, args)];

                const cleanTargets = targets.filter(t => t);

                if (cleanTargets.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ Identify targets to promote." }, { quoted: msg });
                }

                for (const target of cleanTargets) {
                    await sock.groupParticipantsUpdate(jid, [target], "promote");
                }

                await sock.sendMessage(jid, { 
                    text: `👑 Elevated ${cleanTargets.length} member(s) to Administative status.`,
                    mentions: cleanTargets
                }, { quoted: msg });

            } catch (error) {
                console.error(error);
            }
        }
    },

    // 4. DEMOTE FROM ADMIN (Supports Multi-Mentions)
    {
        name: 'demote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) return await sock.sendMessage(jid, { text: "❌ Group required." }, { quoted: msg });

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin privileges required." }, { quoted: msg });

                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const targets = mentions.length > 0 ? mentions : [parseTargetUser(msg, args)];

                const cleanTargets = targets.filter(t => t && t.split('@')[0] !== settings.ownerNumber);

                if (cleanTargets.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ Identify targets to demote." }, { quoted: msg });
                }

                for (const target of cleanTargets) {
                    await sock.groupParticipantsUpdate(jid, [target], "demote");
                }

                await sock.sendMessage(jid, { 
                    text: `👋 Demoted ${cleanTargets.length} admin(s) back to standard members.`,
                    mentions: cleanTargets
                }, { quoted: msg });

            } catch (error) {
                console.error(error);
            }
        }
    },

    // 5. TAG ALL PARTICIPANTS
    {
        name: 'tagall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ This command can only be used inside group chats." }, { quoted: msg });
            }

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) {
                    return await sock.sendMessage(jid, { text: "❌ Only Group Administrators can run this command." }, { quoted: msg });
                }

                const messageText = args ? args : "Attention everyone!";

                await sock.sendMessage(jid, {
                    text: `🔮 *${settings.botName.toUpperCase()} SUMMON:* @all\n\n_${messageText}_`,
                    mentionAll: true
                }, { quoted: msg });

            } catch (error) {
                console.error("Tagall Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to execute tagall." }, { quoted: msg });
            }
        }
    },

    // 6. GHOST TAG
    {
        name: 'tag',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ This command can only be used inside group chats." }, { quoted: msg });
            }

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) {
                    return await sock.sendMessage(jid, { text: "❌ Only Group Administrators can run this command." }, { quoted: msg });
                }

                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants.map(p => p.id);

                const quoted = msg.message.extendedTextMessage?.contextInfo;
                let targetQuotedMsg = msg; 
                let quotedText = '';
                
                if (quoted && quoted.stanzaId) {
                    targetQuotedMsg = {
                        key: {
                            remoteJid: jid,
                            id: quoted.stanzaId,
                            participant: quoted.participant
                        },
                        message: quoted.quotedMessage || {}
                    };
                    
                    const qMsg = quoted.quotedMessage;
                    quotedText = qMsg?.conversation || qMsg?.extendedTextMessage?.text || qMsg?.imageMessage?.caption || qMsg?.videoMessage?.caption || '';
                }

                const messageText = args ? args : (quotedText ? quotedText : "🤞 *Summoned by Satoru Gojo.*");

                await sock.sendMessage(jid, {
                    text: messageText,
                    mentions: participants
                }, { quoted: targetQuotedMsg });

            } catch (error) {
                console.error("Tag Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to execute ghost tag." }, { quoted: msg });
            }
        }
    },

    // 7. FETCH GROUP LINK
    {
        name: 'link',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ This command can only be used inside group chats." }, { quoted: msg });
            }

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) {
                    return await sock.sendMessage(jid, { text: "❌ Only Group Administrators can run this command." }, { quoted: msg });
                }

                const code = await sock.groupInviteCode(jid);
                const inviteLink = `https://chat.whatsapp.com/${code}`;

                await sock.sendMessage(jid, { 
                    text: `🔮 *Limitless Domain Link:*\n\n${inviteLink}` 
                }, { quoted: msg });

            } catch (error) {
                console.error("Link Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to fetch group invite code. Ensure the bot is an Administrator." }, { quoted: msg });
            }
        }
    },

    // 8. ANTILINK CONTROLLER
    {
        name: 'antilink',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ This command can only be used inside group chats." }, { quoted: msg });
            }

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) {
                    return await sock.sendMessage(jid, { text: "❌ Only Group Administrators can run this command." }, { quoted: msg });
                }

                if (!args) {
                    const current = settings.antilink[jid] || 'off';
                    return await sock.sendMessage(jid, {
                        text: `🔮 *Limitless Antilink settings:* (Current: \`${current}\`)\n\n` +
                              `• \`${settings.prefix}antilink warn\` — Delete links & warn the user.\n` +
                              `• \`${settings.prefix}antilink delete\` — Just delete the link message.\n` +
                              `• \`${settings.prefix}antilink kick\` — Delete links & instantly kick the user.\n` +
                              `• \`${settings.prefix}antilink off\` — Disable antilink in this chat.`
                    }, { quoted: msg });
                }

                const action = args.toLowerCase().trim();

                if (['warn', 'delete', 'kick', 'off'].includes(action)) {
                    settings.antilink[jid] = action;
                    
                    if (action === 'off') {
                        await sock.sendMessage(jid, { text: "🔮 *Antilink Deactivated.* Everyone is now free to send links." }, { quoted: msg });
                    } else {
                        await sock.sendMessage(jid, {
                            text: `⚡ *Infinity has been activated in this chat*\n*Status:* ${action}`
                        }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { text: "❌ Invalid option. Use `warn`, `delete`, `kick`, or `off`." }, { quoted: msg });
                }
                saveSettings(); 

            } catch (error) {
                console.error("Antilink Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to change antilink settings. Ensure the bot is an admin." }, { quoted: msg });
            }
        }
    },

    // 9. ADMINS-ONLY TAG
    {
        name: 'admins',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ This command can only be used inside group chats." }, { quoted: msg });
            }

            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants;
                const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
                
                const adminJids = admins.map(a => a.id);
                const mentionsList = admins.map(a => `@${a.id.split('@')[0]}`).join(' ');

                await sock.sendMessage(jid, {
                    text: `🔮 *Limitless Admin Summon:*\n\n${mentionsList}`,
                    mentions: adminJids
                }, { quoted: msg });

            } catch (error) {
                console.error("Admins Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to summon administrators." }, { quoted: msg });
            }
        }
    },

    // 10. ANTITAG MODE CONTROLLER
    {
        name: 'antitag',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ This command can only be used inside group chats." }, { quoted: msg });
            }

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) {
                    return await sock.sendMessage(jid, { text: "❌ Only Group Administrators can run this command." }, { quoted: msg });
                }

                if (!args) {
                    const current = settings.antitag[jid] || 'off';
                    return await sock.sendMessage(jid, {
                        text: `🔮 *Limitless Antitag Setting:* (Current: \`${current}\`)\n\n` +
                              `• \`${settings.prefix}antitag on\` — Delete tags & warn non-admins.\n` +
                              `• \`${settings.prefix}antitag off\` — Allow non-admins to tag the bot.`
                    }, { quoted: msg });
                }

                const action = args.toLowerCase().trim();

                if (action === 'on') {
                    settings.antitag[jid] = 'on';
                    await sock.sendMessage(jid, { text: "🔒 *Antitag Activated:* Non-admins are now barred from tagging Satoru Gojo systems." }, { quoted: msg });
                } else if (action === 'off') {
                    settings.antitag[jid] = 'off';
                    await sock.sendMessage(jid, { text: "🔓 *Antitag Deactivated.*" }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: "❌ Invalid option. Use `on` or `off`." }, { quoted: msg });
                }
                saveSettings(); 

            } catch (error) {
                console.error("Antitag Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to toggle Antitag." }, { quoted: msg });
            }
        }
    },

    // 11. ANTIBOT CONFIGURABLE MODE CONTROLLER
    {
        name: 'antibot',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ This command can only be used inside group chats." }, { quoted: msg });
            }

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) {
                    return await sock.sendMessage(jid, { text: "❌ Only Group Administrators can run this command." }, { quoted: msg });
                }

                if (!args) {
                    const current = settings.antibot[jid] || 'off';
                    return await sock.sendMessage(jid, {
                        text: `🔮 *Limitless Antibot Setting:* (Current: \`${current}\`)\n\n` +
                              `• \`${settings.prefix}antibot warn\` — Delete other bots' messages & warn them.\n` +
                              `• \`${settings.prefix}antibot delete\` — Just delete other bots' messages.\n` +
                              `• \`${settings.prefix}antibot kick\` — Delete & instantly kick other bots.\n` +
                              `• \`${settings.prefix}antibot off\` — Allow other bots in the group.`
                    }, { quoted: msg });
                }

                const action = args.toLowerCase().trim();

                if (['warn', 'delete', 'kick', 'off'].includes(action)) {
                    settings.antibot[jid] = action;
                    
                    if (action === 'off') {
                        await sock.sendMessage(jid, { text: "🔓 *Antibot Deactivated.* Other bots are free to enter." }, { quoted: msg });
                    } else {
                        await sock.sendMessage(jid, { 
                            text: `🔒 *Antibot Activated:*\n*Status:* ${action}` 
                        }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { text: "❌ Invalid option. Use `warn`, `delete`, `kick`, or `off`." }, { quoted: msg });
                }
                saveSettings(); 

            } catch (error) {
                console.error("Antibot Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to toggle Antibot." }, { quoted: msg });
            }
        }
    },

    // 12. WARNINGS SYSTEM COMMAND
    {
        name: 'warn',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ This command can only be used inside group chats." }, { quoted: msg });
            }

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) {
                    return await sock.sendMessage(jid, { text: "❌ Only Group Administrators can run this command." }, { quoted: msg });
                }

                const quoted = msg.message.extendedTextMessage?.contextInfo;
                if (!quoted || !quoted.stanzaId) {
                    return await sock.sendMessage(jid, { text: "❌ Please reply to the message you want to warn." }, { quoted: msg });
                }

                const targetJid = quoted.participant;
                const targetNumber = targetJid.split('@')[0];
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

                if (targetNumber === settings.ownerNumber) {
                    return await sock.sendMessage(jid, { text: "❌ You cannot warn Satoru Gojo's creator." }, { quoted: msg });
                }

                try {
                    await sock.sendMessage(jid, { 
                        delete: { 
                            remoteJid: jid, 
                            id: quoted.stanzaId, 
                            fromMe: targetJid === botJid, 
                            participant: targetJid 
                        } 
                    });
                } catch (e) {
                    console.error("Warning deletion failed:", e.message);
                }

                const warnKey = `${jid}_${targetNumber}`;
                settings.warns[warnKey] = (settings.warns[warnKey] || 0) + 1;
                const count = settings.warns[warnKey];

                const gojoWarnings = [
                    "Tch. Don't push your luck, weakling.",
                    "I suggest you behave. My Infinity has its limits when it comes to annoying pests.",
                    "Keep acting up and I'll show you what Purple looks like up close.",
                    "You're starting to irritate me. And trust me, you don't want the strongest irritated."
                ];
                const selectedWarning = gojoWarnings[Math.floor(Math.random() * gojoWarnings.length)];

                if (count >= 5) {
                    try {
                        await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
                        await sock.sendMessage(jid, {
                            text: `Sayonara! Weakling\n@${targetNumber}\nKuso yaro 🥷`,
                            mentions: [targetJid]
                        });
                        settings.warns[warnKey] = 0;
                    } catch (err) {
                        console.error("Auto-kick on warn failed:", err.message);
                    }
                } else {
                    await sock.sendMessage(jid, {
                        text: `🤞 *${selectedWarning}*\n\n@${targetNumber}\n*Warns:* ${count}/5`,
                        mentions: [targetJid]
                    });
                }
                saveSettings(); 

            } catch (error) {
                console.error("Warn Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to execute warning." }, { quoted: msg });
            }
        }
    },

    // 13. SEND VIDEO/IMAGE/TEXT TO GROUP STATUS (Polymorphic Handler)
    {
        name: 'togcstatus',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) {
                return await sock.sendMessage(jid, { text: "❌ This command can only be used inside group chats." }, { quoted: msg });
            }

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) {
                    return await sock.sendMessage(jid, { text: "❌ Only Group Administrators can run this command." }, { quoted: msg });
                }

                if (quoted && (quoted.videoMessage || quoted.imageMessage || quoted.viewOnceMessageV2?.message || quoted.viewOnceMessage?.message)) {
                    
                    let mediaMessage = null;
                    let mediaType = "";

                    if (quoted.videoMessage) {
                        mediaMessage = quoted.videoMessage;
                        mediaType = "video";
                    } else if (quoted.imageMessage) {
                        mediaMessage = quoted.imageMessage;
                        mediaType = "image";
                    } else if (quoted.viewOnceMessageV2?.message?.videoMessage) {
                        mediaMessage = quoted.viewOnceMessageV2.message.videoMessage;
                        mediaType = "video";
                    } else if (quoted.viewOnceMessageV2?.message?.imageMessage) {
                        mediaMessage = quoted.viewOnceMessageV2.message.imageMessage;
                        mediaType = "image";
                    } else if (quoted.viewOnceMessage?.message?.videoMessage) {
                        mediaMessage = quoted.viewOnceMessage.message.videoMessage;
                        mediaType = "video";
                    } else if (quoted.viewOnceMessage?.message?.imageMessage) {
                        mediaMessage = quoted.viewOnceMessage.message.imageMessage;
                        mediaType = "image";
                    }

                    if (!mediaMessage) {
                        return await sock.sendMessage(jid, { text: "❌ Unsupported media format." }, { quoted: msg });
                    }

                    await sock.sendMessage(jid, { text: `Sending ${mediaType} to Group Status... 🎞️` }, { quoted: msg });

                    const { downloadContentFromMessage } = require('@itsliaaa/baileys');
                    const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    const mimeType = mediaMessage.mimetype || (mediaType === "video" ? "video/mp4" : "image/jpeg");

                    const payload = {
                        caption: args || mediaMessage.caption || '',
                        groupStatus: true
                    };
                    payload[mediaType] = buffer;
                    payload.mimetype = mimeType;

                    await sock.sendMessage(jid, payload);

                } 
                else {
                    let textToSend = args || '';
                    if (!textToSend && quoted) {
                        textToSend = quoted.conversation || quoted.extendedTextMessage?.text || '';
                    }

                    if (!textToSend) {
                        return await sock.sendMessage(jid, { text: "❌ Please reply to a text/media message, or provide text arguments after the command." }, { quoted: msg });
                    }

                    await sock.sendMessage(jid, { text: "Sending text to Group Status... 📝" }, { quoted: msg });

                    await sock.sendMessage(jid, {
                        text: textToSend,
                        groupStatus: true
                    });
                }

            } catch (error) {
                console.error("ToGCStatus Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to send content to Group Status." }, { quoted: msg });
            }
        }
    },

    // 14. GROUP SETTINGS INTERACTIVE CONTROLLER (.gsettings) (Issue 7-10 Repaired)
    {
        name: 'gsettings',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return await sock.sendMessage(jid, { text: "❌ Group required." }, { quoted: msg });

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
            if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin privileges required." }, { quoted: msg });

            if (!settings.welcome) settings.welcome = {};
            if (!settings.goodbye) settings.goodbye = {};

            const parts = args ? args.split(' ') : [];
            const action = parts[0] ? parts[0].toLowerCase().trim() : '';

            // A. FETCH GROUP PROFILE PICTURE (.gsettings getgpp)
            if (action === 'getgpp') {
                try {
                    const profileUrl = await sock.profilePictureUrl(jid, 'image');
                    await sock.sendMessage(jid, { image: { url: profileUrl }, caption: "🖼️ Current Group Profile Picture" }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(jid, { text: "❌ Failed to fetch Group Profile Picture. Ensure it is set to public." }, { quoted: msg });
                }
                return;
            }

            // B. UPDATE GROUP PROFILE PICTURE FROM REPLIED MEDIA (.gsettings setpp)
            if (action === 'setpp') {
                const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quoted || !quoted.imageMessage) {
                    return await sock.sendMessage(jid, { text: "❌ Please reply to an image with `.gsettings setpp`." }, { quoted: msg });
                }

                try {
                    const { downloadContentFromMessage } = await import('@itsliaaa/baileys');
                    const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    await sock.updateProfilePicture(jid, buffer);
                    await sock.sendMessage(jid, { text: "✅ Successfully updated Group Profile Picture!" }, { quoted: msg });
                } catch (e) {
                    console.error(e);
                    await sock.sendMessage(jid, { text: "❌ Failed to update profile picture." }, { quoted: msg });
                }
                return;
            }

            // C. WELCOME INTERACTIVE CONTROLLER (.gsettings welcome <on/off/set>)
            if (action === 'welcome') {
                const subAction = parts[1] ? parts[1].toLowerCase().trim() : '';

                if (subAction === 'on') {
                    settings.welcome[jid] = settings.welcome[jid] || { active: true, msg: "" };
                    settings.welcome[jid].active = true;
                    await sock.sendMessage(jid, { text: "✅ Welcoming sequence activated for new members." }, { quoted: msg });
                } else if (subAction === 'off') {
                    settings.welcome[jid] = settings.welcome[jid] || { active: false, msg: "" };
                    settings.welcome[jid].active = false;
                    await sock.sendMessage(jid, { text: "❌ Welcoming sequence deactivated." }, { quoted: msg });
                } else if (subAction === 'set') {
                    const customMsg = parts.slice(2).join(' ').trim();
                    if (!customMsg) return await sock.sendMessage(jid, { text: "❌ Provide a custom message." }, { quoted: msg });

                    settings.welcome[jid] = settings.welcome[jid] || { active: true };
                    settings.welcome[jid].msg = customMsg;
                    await sock.sendMessage(jid, { text: `✅ Custom welcome message set:\n"${customMsg}"` }, { quoted: msg });
                } else {
                    // Send Button Toggles
                    const prompt = "🌸 *Welcome Module configuration:*\nSelect an option below:";
                    const buttonMessage = {
                        text: prompt,
                        buttons: [
                            { buttonId: `${settings.prefix}gsettings welcome on`, buttonText: { displayText: 'Enable' }, type: 1 },
                            { buttonId: `${settings.prefix}gsettings welcome off`, buttonText: { displayText: 'Disable' }, type: 1 }
                        ],
                        headerType: 1
                    };
                    try { await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (e) { await sock.sendMessage(jid, { text: prompt }, { quoted: msg }); }
                }
                saveSettings();
                return;
            }

            // D. GOODBYE INTERACTIVE CONTROLLER (.gsettings goodbye <on/off/set>)
            if (action === 'goodbye') {
                const subAction = parts[1] ? parts[1].toLowerCase().trim() : '';

                if (subAction === 'on') {
                    settings.goodbye[jid] = settings.goodbye[jid] || { active: true, msg: "" };
                    settings.goodbye[jid].active = true;
                    await sock.sendMessage(jid, { text: "✅ Goodbye notification sequence activated." }, { quoted: msg });
                } else if (subAction === 'off') {
                    settings.goodbye[jid] = settings.goodbye[jid] || { active: false, msg: "" };
                    settings.goodbye[jid].active = false;
                    await sock.sendMessage(jid, { text: "❌ Goodbye notification sequence deactivated." }, { quoted: msg });
                } else if (subAction === 'set') {
                    const customMsg = parts.slice(2).join(' ').trim();
                    if (!customMsg) return await sock.sendMessage(jid, { text: "❌ Provide custom goodbye message." }, { quoted: msg });

                    settings.goodbye[jid] = settings.goodbye[jid] || { active: true };
                    settings.goodbye[jid].msg = customMsg;
                    await sock.sendMessage(jid, { text: `✅ Custom goodbye message set:\n"${customMsg}"` }, { quoted: msg });
                } else {
                    // Send Button Toggles
                    const prompt = "🌸 *Goodbye Module configuration:*\nSelect an option below:";
                    const buttonMessage = {
                        text: prompt,
                        buttons: [
                            { buttonId: `${settings.prefix}gsettings goodbye on`, buttonText: { displayText: 'Enable' }, type: 1 },
                            { buttonId: `${settings.prefix}gsettings goodbye off`, buttonText: { displayText: 'Disable' }, type: 1 }
                        ],
                        headerType: 1
                    };
                    try { await sock.sendMessage(jid, buttonMessage, { quoted: msg }); } catch (e) { await sock.sendMessage(jid, { text: prompt }, { quoted: msg }); }
                }
                saveSettings();
                return;
            }

            // E. DELETE WELCOME/GOODBYE CONFIGS (.gsettings delwelcome / delgoodbye)
            if (action === 'delwelcome') {
                if (settings.welcome[jid]) delete settings.welcome[jid];
                await sock.sendMessage(jid, { text: "✅ Welcome settings removed." }, { quoted: msg });
                saveSettings();
                return;
            }

            if (action === 'delgoodbye') {
                if (settings.goodbye[jid]) delete settings.goodbye[jid];
                await sock.sendMessage(jid, { text: "✅ Goodbye settings removed." }, { quoted: msg });
                saveSettings();
                return;
            }

            // Fallback Menu
            const generalPrompt = `💻 *GSETTINGS MANUAL* 💻\n\n` +
                                  `• \`${settings.prefix}gsettings getgpp\` — Retrieve Group Avatar.\n` +
                                  `• \`${settings.prefix}gsettings setpp\` — Update Avatar from replied image.\n` +
                                  `• \`${settings.prefix}gsettings welcome\` — Configure Welcomer.\n` +
                                  `• \`${settings.prefix}gsettings goodbye\` — Configure Goodbye notifications.\n` +
                                  `• \`${settings.prefix}gsettings delwelcome\` — Clear welcome configs.\n` +
                                  `• \`${settings.prefix}gsettings delgoodbye\` — Clear goodbye configs.`;

            await sock.sendMessage(jid, { text: generalPrompt }, { quoted: msg });
        }
    },

    // 15. EXIT GROUP (.exit)
    {
        name: 'exit',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            if (!isOwner) return; // Locked to Owner/Dev

            await sock.sendMessage(jid, { text: "Deactivating Domain. Exiting domain expansion safely... 👋" }, { quoted: msg });
            await sock.groupLeave(jid);
        }
    },

    // 16. JOIN GROUP VIA LINK (.join)
    {
        name: 'join',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            if (!args) return await sock.sendMessage(jid, { text: "❌ Provide a group invite link." }, { quoted: msg });

            const codeMatch = args.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i);
            if (!codeMatch) return await sock.sendMessage(jid, { text: "❌ Invalid invite link format." }, { quoted: msg });

            try {
                await sock.groupAcceptInvite(codeMatch[1]);
                await sock.sendMessage(jid, { text: "✅ Successfully entered and secured the group domain!" }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed to join group: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 17. ADD USER TO GROUP (.add)
    {
        name: 'add',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return await sock.sendMessage(jid, { text: "❌ Group required." }, { quoted: msg });

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized && !isSudo) return await sock.sendMessage(jid, { text: "❌ Admin rights required." }, { quoted: msg });

                const targetNum = args.replace(/[^0-9]/g, '');
                if (!targetNum) return await sock.sendMessage(jid, { text: "❌ Provide number to add." }, { quoted: msg });

                const targetJid = `${targetNum}@s.whatsapp.net`;
                await sock.groupParticipantsUpdate(jid, [targetJid], "add");
                await sock.sendMessage(jid, { text: `✅ Added target member successfully: @${targetNum}`, mentions: [targetJid] }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed to add member. Ensure the bot is an Administrator.` }, { quoted: msg });
            }
        }
    },

    // 18. GENERATE VCF CONTACT LIST (.vcf)
    {
        name: 'vcf',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin rights required." }, { quoted: msg });

                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants;

                let vcardString = "";
                participants.forEach((p, i) => {
                    const num = p.id.split('@')[0];
                    vcardString += `BEGIN:VCARD\nVERSION:3.0\nFN:${settings.botName} Contact ${i + 1}\nTEL;TYPE=CELL:${num}\nEND:VCARD\n`;
                });

                const buffer = Buffer.from(vcardString, 'utf-8');
                await sock.sendMessage(jid, {
                    document: buffer,
                    mimetype: 'text/vcard',
                    fileName: `${groupMetadata.subject || 'Group'}_Contacts.vcf`
                }, { quoted: msg });

            } catch (e) {
                console.error(e);
            }
        }
    },

    // 19. CREATE GROUP POLL (.poll)
    {
        name: 'poll',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            if (!args) return await sock.sendMessage(jid, { text: `❌ Usage: \`${settings.prefix}poll Question, option1, option2...\`` }, { quoted: msg });

            const parts = args.split(',');
            const question = parts[0].trim();
            const options = parts.slice(1).map(o => o.trim()).filter(o => o);

            if (options.length < 2) {
                return await sock.sendMessage(jid, { text: "❌ A poll requires at least 2 options." }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, {
                    poll: {
                        name: question,
                        values: options,
                        selectableCount: 1 // Single-choice poll constraint
                    }
                }, { quoted: msg });
            } catch (e) {
                console.error(e);
            }
        }
    },

    // 20. ANTI STATUS GROUP MENTION (.antigm)
    {
        name: 'antigm',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin rights required." }, { quoted: msg });

                if (!settings.antigm) settings.antigm = {};

                if (!args) {
                    const current = settings.antigm[jid] || 'off';
                    return await sock.sendMessage(jid, {
                        text: `🔮 *Limitless AntiGroup-Mention status:* (Current: \`${current}\`)\n\n` +
                              `• \`${settings.prefix}antigm warn\` — Warn and delete status tags.\n` +
                              `• \`${settings.prefix}antigm delete\` — Delete status tags.\n` +
                              `• \`${settings.prefix}antigm kick\` — Instantly kick offenders.\n` +
                              `• \`${settings.prefix}antigm off\` — Disable protection.`
                    }, { quoted: msg });
                }

                const action = args.toLowerCase().trim();
                if (['warn', 'delete', 'kick', 'off'].includes(action)) {
                    settings.antigm[jid] = action;
                    await sock.sendMessage(jid, { text: `🔒 *AntiGroup-Mention protection updated:* \`${action}\`` }, { quoted: msg });
                    saveSettings();
                } else {
                    await sock.sendMessage(jid, { text: "❌ Use `warn`, `delete`, `kick`, or `off`." }, { quoted: msg });
                }
            } catch (e) {
                console.error(e);
            }
        }
    },

    // 21. STATUS DOWNLOADER (.save)
    {
        name: 'save',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            
            if (!quoted) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to the status/story content you want to save." }, { quoted: msg });
            }

            try {
                let mediaMessage = null;
                let mediaType = "";

                if (quoted.imageMessage) { mediaMessage = quoted.imageMessage; mediaType = "image"; }
                else if (quoted.videoMessage) { mediaMessage = quoted.videoMessage; mediaType = "video"; }

                if (!mediaMessage) {
                    return await sock.sendMessage(jid, { text: "❌ Replies must contain image or video status files." }, { quoted: msg });
                }

                const { downloadContentFromMessage } = require('@itsliaaa/baileys');
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                if (mediaType === "image") {
                    await sock.sendMessage(jid, { image: buffer, caption: mediaMessage.caption || "Saved Status Image 📂" }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { video: buffer, mimetype: mediaMessage.mimetype || "video/mp4", caption: mediaMessage.caption || "Saved Status Video 📂" }, { quoted: msg });
                }

            } catch (e) {
                console.error(e);
            }
        }
    },

    // 22. SHIP USERS (.ship)
    {
        name: 'ship',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants.map(p => p.id);

                const senderJid = msg.key.participant || msg.key.remoteJid || '';
                
                // Exclude sender from target list
                const filtered = participants.filter(p => p !== senderJid);
                if (filtered.length === 0) return;

                const randomPartner = filtered[Math.floor(Math.random() * filtered.length)];

                const percent = Math.floor(Math.random() * 101);
                let matchMessage = "";

                if (percent < 30) {
                    matchMessage = "💔 *Tragic Compatibility.* Your cursed energy is repelled by theirs.";
                } else if (percent < 70) {
                    matchMessage = "🤝 *Equal partnership.* A stable resonance in character.";
                } else {
                    matchMessage = "💖 *Throughout Heaven and Earth, you alone are their honored one.* Perfect dynamic.";
                }

                await sock.sendMessage(jid, {
                    text: `🤞 *Limitless Matchmaker:* @${senderJid.split('@')[0]} ⚔️ @${randomPartner.split('@')[0]}\n\n` +
                          `🔥 *Love Compatibility:* \`${percent}%\`\n` +
                          `${matchMessage}`,
                    mentions: [senderJid, randomPartner]
                }, { quoted: msg });

            } catch (e) {
                console.error(e);
            }
        }
    },

    // 23. CREATE NEW GROUP CHAT (.creategc)
    {
        name: 'creategc',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            if (!args) return await sock.sendMessage(jid, { text: "❌ Provide a group name." }, { quoted: msg });

            try {
                const group = await sock.groupCreate(args, [msg.key.participant || msg.key.remoteJid]);
                await sock.sendMessage(jid, { text: `✅ Group successfully created!\n\n• *Name:* ${args}\n• *Jid:* ${group.id}` }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: `❌ Failed to create group: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 24. KICKALL COUNTDOWN ENGINE (.kickall) (Features Cancel Buttons)
    {
        name: 'kickall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin rights required." }, { quoted: msg });

                const action = args ? args.toLowerCase().trim() : '';

                if (action === 'cancel' || action === 'stop') {
                    if (!global.kickallActive[jid]) {
                        return await sock.sendMessage(jid, { text: "❌ No active kickall command running." }, { quoted: msg });
                    }
                    clearInterval(global.kickallActive[jid].intervalId);
                    delete global.kickallActive[jid];
                    return await sock.sendMessage(jid, { text: "✅ Mass-exorcism aborted. Kicks cancelled successfully." }, { quoted: msg });
                }

                if (global.kickallActive[jid]) {
                    return await sock.sendMessage(jid, { text: "❌ A kickall command is already active in this domain." }, { quoted: msg });
                }

                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants;

                // Only target standard members (protect bot and group admins)
                const targets = participants.filter(p => p.admin === null && p.id !== sock.user.id).map(p => p.id);

                if (targets.length === 0) {
                    return await sock.sendMessage(jid, { text: "✅ There are no standard members left to kick." }, { quoted: msg });
                }

                let countdown = 10;
                const prompt = `⚠️ *DOMAIN COLLAPSE WARNING* ⚠️\n\n` +
                               `Mass-exorcising *${targets.length}* members from this domain in *${countdown}* seconds.\n\n` +
                               `_Administrators: Click the cancel button below to abort immediately._`;

                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}kickall cancel`, buttonText: { displayText: 'Cancel Exorcism' }, type: 1 }
                    ],
                    headerType: 1
                };

                const sentWarn = await sock.sendMessage(jid, buttonMessage, { quoted: msg });

                // Initialize interval countdown
                global.kickallActive[jid] = {
                    targets: targets,
                    intervalId: setInterval(async () => {
                        countdown--;
                        if (countdown > 0) {
                            await sock.sendMessage(jid, {
                                text: `⚠️ *DOMAIN COLLAPSE WARNING* ⚠️\n\nMass-exorcising *${targets.length}* members in *${countdown}* seconds.`,
                                edit: sentWarn.key
                            });
                        } else {
                            clearInterval(global.kickallActive[jid].intervalId);
                            await sock.sendMessage(jid, { text: "🌪️ *COUNTDOWN ELAPSED. INITIATING MASS EXORCISM.*" });

                            for (const target of targets) {
                                try {
                                    await sock.groupParticipantsUpdate(jid, [target], "remove");
                                } catch (e) {
                                    console.error("Mass-kick single participant error:", e.message);
                                }
                            }
                            delete global.kickallActive[jid];
                        }
                    }, 1000)
                };

            } catch (e) {
                console.error(e);
            }
        }
    },

    // 25. LIST MESSAGE COUNTS (.msgs)
    {
        name: 'msgs',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            if (!settings.msgCount || !settings.msgCount[jid]) {
                return await sock.sendMessage(jid, { text: "📊 No activity has been logged in this domain yet." }, { quoted: msg });
            }

            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants;

                const sortedData = Object.keys(settings.msgCount[jid])
                    .map(user => {
                        return { user, count: settings.msgCount[jid][user].count };
                    })
                    .sort((a, b) => b.count - a.count);

                let leaderboard = `📊 *LIMITLESS ACTIVITY LEADERBOARD*\n`;
                leaderboard += `*Group:* ${groupMetadata.subject || 'This chat'}\n\n`;

                sortedData.forEach((entry, idx) => {
                    leaderboard += `${idx + 1}. @${entry.user.split('@')[0]} — *${entry.count}* msg(s)\n`;
                });

                await sock.sendMessage(jid, {
                    text: leaderboard,
                    mentions: sortedData.map(e => e.user)
                }, { quoted: msg });

            } catch (e) {
                console.error(e);
            }
        }
    },

    // 26. LIST ACTIVE MEMBERS (listactive)
    {
        name: 'listactive',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            if (!settings.msgCount || !settings.msgCount[jid]) {
                return await sock.sendMessage(jid, { text: "📊 No activity records found." }, { quoted: msg });
            }

            try {
                const startOfDay = new Date().setHours(0, 0, 0, 0);

                const activeMembers = Object.keys(settings.msgCount[jid])
                    .filter(user => settings.msgCount[jid][user].lastMsgTime >= startOfDay)
                    .map(user => {
                        return { user, count: settings.msgCount[jid][user].count };
                    });

                if (activeMembers.length === 0) {
                    return await sock.sendMessage(jid, { text: "📊 No members have sent messages yet today." }, { quoted: msg });
                }

                let report = `📊 *ACTIVE DOMAIN MEMBERS TODAY (${activeMembers.length})*\n\n`;
                activeMembers.forEach((entry, idx) => {
                    report += `• @${entry.user.split('@')[0]}\n`;
                });

                await sock.sendMessage(jid, {
                    text: report,
                    mentions: activeMembers.map(m => m.user)
                }, { quoted: msg });

            } catch (e) {
                console.error(e);
            }
        }
    },

    // 27. LIST INACTIVE MEMBERS (listinactive)
    {
        name: 'listinactive',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants.map(p => p.id);

                const startOfDay = new Date().setHours(0, 0, 0, 0);
                const activeJids = Object.keys(settings.msgCount?.[jid] || {})
                    .filter(user => settings.msgCount[jid][user].lastMsgTime >= startOfDay);

                // Filter out active members, bot itself, and owner
                const inactiveMembers = participants.filter(p => !activeJids.includes(p) && p !== sock.user.id);

                if (inactiveMembers.length === 0) {
                    return await sock.sendMessage(jid, { text: "📊 Exceptional! Everyone is active today." }, { quoted: msg });
                }

                let report = `📊 *INACTIVE DOMAIN MEMBERS TODAY (${inactiveMembers.length})*\n\n`;
                inactiveMembers.forEach(user => {
                    report += `• @${user.split('@')[0]}\n`;
                });

                await sock.sendMessage(jid, {
                    text: report,
                    mentions: inactiveMembers
                }, { quoted: msg });

            } catch (e) {
                console.error(e);
            }
        }
    },

    // 28. TIMED KICK CONTROLLER (.tkick) (Supports Cancel Buttons)
    {
        name: 'tkick',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin rights required." }, { quoted: msg });

                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const targets = mentions.length > 0 ? mentions : [parseTargetUser(msg, args)];

                const cleanTargets = targets.filter(t => t && t.split('@')[0] !== settings.ownerNumber);

                // Case A: Show Pending Kicks (No arguments or mentions passed)
                if (cleanTargets.length === 0) {
                    const activeKeys = Object.keys(global.tkickTimers).filter(k => k.startsWith(jid));
                    if (activeKeys.length === 0) {
                        return await sock.sendMessage(jid, { text: "❌ No pending timed kicks running in this domain." }, { quoted: msg });
                    }

                    let list = "⏳ *PENDING TIMED KICKS:*\n\n";
                    const buttons = [];

                    activeKeys.forEach((key, idx) => {
                        const task = global.tkickTimers[key];
                        const remainingSec = Math.max(0, Math.floor((task.endTime - Date.now()) / 1000));
                        list += `${idx + 1}. @${task.targetJid.split('@')[0]} — Remaining: *${remainingSec}s*\n`;
                        
                        // Add single cancel button dynamically
                        buttons.push({
                            buttonId: `${settings.prefix}tkick_cancel ${task.targetJid}`,
                            buttonText: { displayText: `Cancel @${task.targetJid.split('@')[0]}` },
                            type: 1
                        });
                    });

                    const buttonMessage = {
                        text: list,
                        buttons: buttons.slice(0, 3), // Limit button structures to maximum 3
                        headerType: 1,
                        mentions: activeKeys.map(k => global.tkickTimers[k].targetJid)
                    };

                    try {
                        return await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                    } catch (e) {
                        return await sock.sendMessage(jid, { text: list, mentions: activeKeys.map(k => global.tkickTimers[k].targetJid) }, { quoted: msg });
                    }
                }

                // Parse duration from text arguments (e.g. 10s, 5m, etc.)
                const durationString = args.replace(/@[^ ]+/g, '').trim().split(' ')[0] || '';
                const durationMs = parseDuration(durationString);

                if (!durationMs) {
                    return await sock.sendMessage(jid, { text: `❌ Please provide a valid duration string (e.g. \`10s\`, \`5m\`).` }, { quoted: msg });
                }

                // Register Timers
                for (const target of cleanTargets) {
                    const timerKey = `${jid}_${target}`;
                    
                    if (global.tkickTimers[timerKey]) {
                        clearTimeout(global.tkickTimers[timerKey].timeoutId);
                    }

                    const timeoutId = setTimeout(async () => {
                        try {
                            await sock.groupParticipantsUpdate(jid, [target], "remove");
                            await sock.sendMessage(jid, { text: `🌪️ *Timer Elapsed.* Exorcising member: @${target.split('@')[0]}`, mentions: [target] });
                        } catch (err) {}
                        delete global.tkickTimers[timerKey];
                    }, durationMs);

                    global.tkickTimers[timerKey] = {
                        timeoutId,
                        targetJid: target,
                        endTime: Date.now() + durationMs
                    };
                }

                await sock.sendMessage(jid, {
                    text: `⏳ Registered timed kick for *${cleanTargets.length}* member(s).\n\n*Delay:* ${durationString}`,
                    mentions: cleanTargets
                }, { quoted: msg });

            } catch (e) {
                console.error(e);
            }
        }
    },

    // 29. CANCEL INDIVIDUAL TIMED KICK (.tkick_cancel)
    {
        name: 'tkick_cancel',
        isPrefixless: true,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!args) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
            if (!isAuthorized) return;

            const targetJid = args.trim();
            const timerKey = `${jid}_${targetJid}`;

            if (global.tkickTimers[timerKey]) {
                clearTimeout(global.tkickTimers[timerKey].timeoutId);
                delete global.tkickTimers[timerKey];
                await sock.sendMessage(jid, { text: `✅ Timed kick cancelled for: @${targetJid.split('@')[0]}`, mentions: [targetJid] }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: "❌ Timer already elapsed or was never registered." }, { quoted: msg });
            }
        }
    },

    // 30. CONVERSATION LOGGER & SUMMARIZER (.gclog)
    {
        name: 'gclog',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin rights required." }, { quoted: msg });

                if (!settings.gclogActive) settings.gclogActive = {};

                const action = args ? args.toLowerCase().trim() : '';

                if (action === 'on') {
                    settings.gclogActive[jid] = true;
                    await sock.sendMessage(jid, { text: "🔒 *GCLOG Activated.* Recording conversation flow in real-time." }, { quoted: msg });
                    saveSettings();
                    return;
                }

                if (action === 'off') {
                    settings.gclogActive[jid] = false;
                    await sock.sendMessage(jid, { text: "🔓 *GCLOG Deactivated.* Log records cleared." }, { quoted: msg });
                    if (settings.conversationLogs?.[jid]) delete settings.conversationLogs[jid];
                    saveSettings();
                    return;
                }

                // Check/Retrieve summary logs (.gclog check)
                if (action === 'check' || !action) {
                    const active = settings.gclogActive[jid];
                    const logs = settings.conversationLogs?.[jid] || [];

                    if (!active) {
                        return await sock.sendMessage(jid, { text: "⚠️ Log recorder is currently offline. Type `.gclog on` to enable." }, { quoted: msg });
                    }

                    if (logs.length === 0) {
                        return await sock.sendMessage(jid, { text: "📊 No message flow logged yet. Let members speak first." }, { quoted: msg });
                    }

                    await sock.sendMessage(jid, { text: `⏳ *Summarizing ${logs.length} logged message(s) using Gemini AI...*` }, { quoted: msg });

                    // Format conversations into text string
                    const logString = logs.map(l => `[${new Date(l.time).toLocaleTimeString()}] ${l.sender}: ${l.text}`).join('\n');

                    // Import AI Generative Engine dynamically
                    const { GoogleGenerativeAI } = require('@google/generative-ai');
                    const ai = new GoogleGenerativeAI(settings.geminiApiKey);
                    const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });

                    const prompt = `You are the ultimate Satoru Gojo conversation logs analyst. Analyze the following highly condensed WhatsApp group chat logs. Provide a very short, summarized, and extremely engaging outline of the core discussion topics, drama, or key decisions. Keep your tone cocky, playful, and completely in Gojo style:\n\n${logString}`;

                    const result = await model.generateContent(prompt);
                    const responseText = result.response.text();

                    await sock.sendMessage(jid, { text: `🤞 *LIMITLESS SYSTEM LOG SUMMARY:* 🤞\n━━━━━━━━━━━━━━━━━━━\n\n${responseText}` }, { quoted: msg });
                }

            } catch (e) {
                console.error(e);
                await sock.sendMessage(jid, { text: `❌ Summary generation failed: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 31. SET GROUP DESCRIPTION (.gdesc)
    {
        name: 'gdesc',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin rights required." }, { quoted: msg });

                if (!args) return await sock.sendMessage(jid, { text: "❌ Provide text to set." }, { quoted: msg });

                await sock.groupUpdateDescription(jid, args);
                await sock.sendMessage(jid, { text: `✅ Group description set successfully to:\n"${args}"` }, { quoted: msg });

            } catch (e) {
                console.error(e);
            }
        }
    },

    // 32. FETCH GROUP INFO (.ginfo)
    {
        name: 'ginfo',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants;

                const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').length;
                const standard = participants.length - admins;

                const desc = groupMetadata.desc ? groupMetadata.desc.toString() : '_None_';

                const infoText = 
                    `📱 *GROUP INFO MANUAL* 📱\n` +
                    `━━━━━━━━━━━━━━━━━━━\n\n` +
                    `• *Name:* \`${groupMetadata.subject || 'Unknown'}\`\n` +
                    `• *ID:* \`${groupMetadata.id}\`\n` +
                    `• *Owner/Creator:* @${(groupMetadata.owner || '').split('@')[0]}\n` +
                    `• *Total Members:* \`${participants.length}\`\n` +
                    `  - *Admins:* \`${admins}\`\n` +
                    `  - *Members:* \`${standard}\`\n\n` +
                    `📖 *Description:*\n${desc}`;

                await sock.sendMessage(jid, {
                    text: infoText,
                    mentions: groupMetadata.owner ? [groupMetadata.owner] : []
                }, { quoted: msg });

            } catch (e) {
                console.error(e);
            }
        }
    },

    // 33. RESET/REVOKE GROUP LINK (.reset / .revoke)
    {
        name: 'reset',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin rights required." }, { quoted: msg });

                const code = await sock.groupRevokeInvite(jid);
                await sock.sendMessage(jid, { text: "✅ Invite link successfully revoked and reset." }, { quoted: msg });

            } catch (e) {
                console.error(e);
            }
        }
    }
];

// Add structural aliases
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'antilink') {
        aliases.push({ ...cmd, name: 'infinity' });
    }
    if (cmd.name === 'reset') {
        aliases.push({ ...cmd, name: 'revoke' });
    }
});
module.exports.push(...aliases);