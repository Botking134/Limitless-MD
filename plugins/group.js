// plugins/group.js
const settings = require('../settings'); // Up one level to settings.js
const { saveSettings } = require('../settingsSaver'); // Save straight to settings.js
const commands = require('../commands'); // Access command registry for redirection

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

    // 3. PROMOTE TO ADMIN
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

    // 4. DEMOTE FROM ADMIN
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

    // 14. MASS KICK COUNTDOWN ACTION (.kickall) (Issue 2 Fixed: Preserves Cancel Button during edit iterations)
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

                // Initialize interval countdown (Issue 2 Fixed: Re-injects buttons in every edit tick)
                global.kickallActive[jid] = {
                    targets: targets,
                    intervalId: setInterval(async () => {
                        countdown--;
                        if (countdown > 0) {
                            const tickPrompt = `⚠️ *DOMAIN COLLAPSE WARNING* ⚠️\n\n` +
                                               `Mass-exorcising *${targets.length}* members from this domain in *${countdown}* seconds.\n\n` +
                                               `_Administrators: Click the cancel button below to abort immediately._`;

                            const editPayload = {
                                text: tickPrompt,
                                buttons: [
                                    { buttonId: `${settings.prefix}kickall cancel`, buttonText: { displayText: 'Cancel Exorcism' }, type: 1 }
                                ],
                                headerType: 1,
                                edit: sentWarn.key
                            };

                            await sock.sendMessage(jid, editPayload);
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

    // 28. TIMED KICK CONTROLLER (.tkick) (Issue 1 Repaired)
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

                // Check manual typing redirection (If user types "⚡tkick cancel" or "⚡tkick stop")
                const durationString = args.replace(/@[^ ]+/g, '').trim().split(' ')[0] || '';
                if (durationString.toLowerCase() === 'cancel' || durationString.toLowerCase() === 'stop') {
                    return await commands[`${settings.prefix}tkick_cancel_all`](sock, msg, args, { isOwner });
                }

                // If no targets are mentioned, display pending timers status
                if (cleanTargets.length === 0) {
                    const activeKeys = Object.keys(global.tkickTimers).filter(k => k.startsWith(jid));
                    if (activeKeys.length === 0) {
                        return await sock.sendMessage(jid, { text: "❌ No pending timed kicks running in this domain." }, { quoted: msg });
                    }

                    let list = "⏳ *PENDING TIMED KICKS:*\n━━━━━━━━━━━━━━━━━━━\n\n";
                    activeKeys.forEach((key, idx) => {
                        const task = global.tkickTimers[key];
                        const remainingSec = Math.max(0, Math.floor((task.endTime - Date.now()) / 1000));
                        list += `${idx + 1}. @${task.targetJid.split('@')[0]} — Remaining: *${remainingSec}s*\n`;
                    });

                    // Single button to cancel all pending kicks in this group
                    const buttonMessage = {
                        text: list,
                        buttons: [
                            { buttonId: `${settings.prefix}tkick_cancel_all`, buttonText: { displayText: 'Cancel All Kicks' }, type: 1 }
                        ],
                        headerType: 1,
                        mentions: activeKeys.map(k => global.tkickTimers[k].targetJid)
                    };

                    try {
                        return await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                    } catch (e) {
                        return await sock.sendMessage(jid, { text: list, mentions: activeKeys.map(k => global.tkickTimers[k].targetJid) }, { quoted: msg });
                    }
                }

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
                        timeoutId: timeoutId,
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

    // 29. CANCEL ALL TIMED KICKS IN GROUP
    {
        name: 'tkick_cancel_all',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
            if (!isAuthorized) return;

            const activeKeys = Object.keys(global.tkickTimers).filter(k => k.startsWith(jid));

            if (activeKeys.length === 0) {
                return await sock.sendMessage(jid, { text: "❌ No pending timed kicks found to cancel." }, { quoted: msg });
            }

            activeKeys.forEach(key => {
                clearTimeout(global.tkickTimers[key].timeoutId);
                delete global.tkickTimers[key];
            });

            await sock.sendMessage(jid, { text: "✅ Successfully cancelled all pending timed kicks in this group." }, { quoted: msg });
        }
    }
];

// Add structural aliases
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'antilink') {
        aliases.push({ ...cmd, name: 'infinity' });
    }
});
module.exports.push(...aliases);