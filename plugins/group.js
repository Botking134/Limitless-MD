// plugins/group.js
const settings = require('../settings'); // Up one level to settings.js
const { saveSettings } = require('../settingsSaver'); // Save straight to settings.js
const commands = require('../commands'); // Access command registry for redirection

// Timed tasks, group status, and mass-actions storage
if (!global.tkickTimers) global.tkickTimers = {};
if (!global.kickallActive) global.kickallActive = {};
if (!global.groupTimers) global.groupTimers = {};
if (!global.silencedUsers) global.silencedUsers = {}; // Silenced users memory cache

// Reusable Helper to resolve any JID (such as LID) to standard Phone format
async function resolveToPhoneJid(sock, jid) {
    if (!jid) return '';
    if (jid.endsWith('@s.whatsapp.net')) return jid;
    if (jid.endsWith('@lid')) {
        try {
            const res = await sock.findUserId(jid);
            if (res && res.phoneNumber) {
                return res.phoneNumber;
            }
        } catch (e) {
            console.error("Failed to resolve LID JID to Phone:", e.message);
        }
    }
    const num = jid.split('@')[0].split(':')[0];
    return `${num}@s.whatsapp.net`;
}

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
    // 1. .mute / .unmute UNIFIED INTERACTIVE TOGGLE SUITE (Aliases: open/close, lock/unlock)
    {
        name: 'mute',
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

                // If no argument is provided, drop interactive mute toggles
                if (!args) {
                    const prompt = `🔒 *Gotei 13 Domain Control Panel:*\n\nSelect an option below to update domain parameters:`;
                    const buttonMessage = {
                        text: prompt,
                        buttons: [
                            { buttonId: `${settings.prefix}mute close`, buttonText: { displayText: 'Mute Group 🔒' }, type: 1 },
                            { buttonId: `${settings.prefix}mute open`, buttonText: { displayText: 'Unmute Group 🔓' }, type: 1 }
                        ],
                        headerType: 1
                    };
                    try { 
                        return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); 
                    } catch (e) { 
                        return await sock.sendMessage(jid, { text: `${prompt}\n\n• \`${settings.prefix}mute close\`\n• \`${settings.prefix}mute open\`` }, { quoted: msg }); 
                    }
                }

                const parts = args.split(' ');
                const action = parts[0].toLowerCase().trim();
                const timeString = parts[1] || '';
                const durationMs = timeString ? parseDuration(timeString) : null;

                // Determine target execution path (Lid-Safe/Standard mute mechanics)
                const isOpening = ['open', 'unlock', 'unmute'].includes(action);

                if (isOpening) {
                    await sock.groupSettingUpdate(jid, 'not_announcement');
                    let timeNotice = "";

                    if (durationMs) {
                        timeNotice = `\n_This domain will automatically close in ${timeString}._`;
                        if (global.groupTimers[jid]) clearTimeout(global.groupTimers[jid]);
                        global.groupTimers[jid] = setTimeout(async () => {
                            await sock.groupSettingUpdate(jid, 'announcement');
                            await sock.sendMessage(jid, { 
                                text: "🔒 *Group Status Updated:*\n\nTime is up. Infinite Void restricted. Only Administrators can speak." 
                            });
                            delete global.groupTimers[jid];
                        }, durationMs);
                    }

                    await sock.sendMessage(jid, { 
                        text: `🔓 *Group Status Updated:*\n\nUnlimited Void expanded. Everyone is now free to speak.${timeNotice}` 
                    }, { quoted: msg });

                } else {
                    await sock.groupSettingUpdate(jid, 'announcement');
                    let timeNotice = "";

                    if (durationMs) {
                        timeNotice = `\n_This domain will automatically open in ${timeString}._`;
                        if (global.groupTimers[jid]) clearTimeout(global.groupTimers[jid]);
                        global.groupTimers[jid] = setTimeout(async () => {
                            await sock.groupSettingUpdate(jid, 'not_announcement');
                            await sock.sendMessage(jid, { 
                                text: "🔓 *Group Status Updated:*\n\nTime is up. Unlimited Void expanded. Everyone is now free to speak." 
                            });
                            delete global.groupTimers[jid];
                        }, durationMs);
                    }

                    await sock.sendMessage(jid, { 
                        text: `🔒 *Group Status Updated:*\n\nInfinite Void restricted. Only Administrators can speak.${timeNotice}` 
                    }, { quoted: msg });
                }

            } catch (error) {
                console.error("Mute command error:", error);
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
                    text: `👑 Elevated ${cleanTargets.length} member(s) to Administrative status.`,
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
                    const prompt = `🔮 *Limitless Antilink Settings:* (Current: \`${current}\`)\n\nSelect an option below:`;
                    const buttonMessage = {
                        text: prompt,
                        buttons: [
                            { buttonId: `${settings.prefix}antilink delete`, buttonText: { displayText: 'Delete' }, type: 1 },
                            { buttonId: `${settings.prefix}antilink warn`, buttonText: { displayText: 'Warn' }, type: 1 },
                            { buttonId: `${settings.prefix}antilink off`, buttonText: { displayText: 'Disable' }, type: 1 }
                        ],
                        headerType: 1
                    };
                    try { 
                        return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); 
                    } catch (e) { 
                        return await sock.sendMessage(jid, { text: prompt }, { quoted: msg }); 
                    }
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
                    await sock.sendMessage(jid, { text: "❌ Invalid option. Use the button toggles." }, { quoted: msg });
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
                    const prompt = `🔮 *Limitless Antitag Setting:* (Current: \`${current}\`)\n\nSelect an option below:`;
                    const buttonMessage = {
                        text: prompt,
                        buttons: [
                            { buttonId: `${settings.prefix}antitag on`, buttonText: { displayText: 'Enable' }, type: 1 },
                            { buttonId: `${settings.prefix}antitag off`, buttonText: { displayText: 'Disable' }, type: 1 }
                        ],
                        headerType: 1
                    };
                    try { 
                        return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); 
                    } catch (e) { 
                        return await sock.sendMessage(jid, { text: prompt }, { quoted: msg }); 
                    }
                }

                const action = args.toLowerCase().trim();

                if (action === 'on') {
                    settings.antitag[jid] = 'on';
                    await sock.sendMessage(jid, { text: "🔒 *Antitag Activated:* Non-admins are now barred from tagging Satoru Gojo systems." }, { quoted: msg });
                } else if (action === 'off') {
                    settings.antitag[jid] = 'off';
                    await sock.sendMessage(jid, { text: "🔓 *Antitag Deactivated.*" }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: "❌ Invalid option. Use the buttons." }, { quoted: msg });
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
                    const prompt = `🔮 *Limitless Antibot Setting:* (Current: \`${current}\`)\n\nSelect an option below:`;
                    const buttonMessage = {
                        text: prompt,
                        buttons: [
                            { buttonId: `${settings.prefix}antibot delete`, buttonText: { displayText: 'Delete' }, type: 1 },
                            { buttonId: `${settings.prefix}antibot warn`, buttonText: { displayText: 'Warn' }, type: 1 },
                            { buttonId: `${settings.prefix}antibot off`, buttonText: { displayText: 'Disable' }, type: 1 }
                        ],
                        headerType: 1
                    };
                    try { 
                        return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); 
                    } catch (e) { 
                        return await sock.sendMessage(jid, { text: prompt }, { quoted: msg }); 
                    }
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
                    await sock.sendMessage(jid, { text: "❌ Invalid option. Use the buttons." }, { quoted: msg });
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

    // 13. SEND VIDEO/IMAGE/TEXT TO GROUP STATUS
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
                        caption: args || mediaMessage.caption || ''
                    };
                    payload[mediaType] = buffer;
                    payload.mimetype = mimeType;

                    await sock.sendMessage('status@broadcast', payload, { statusJidList: [jid] });

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

                    await sock.sendMessage('status@broadcast', {
                        text: textToSend,
                        backgroundColor: '#0A0A0A',
                        font: 3
                    }, {
                        statusJidList: [jid]
                    });
                }

            } catch (error) {
                console.error("ToGCStatus Command Error:", error);
                await sock.sendMessage(jid, { text: "❌ Failed to send content to Group Status." }, { quoted: msg });
            }
        }
    },

    // 14. GET GROUP PROFILE PICTURE
    {
        name: 'getgpp',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return await sock.sendMessage(jid, { text: "❌ Group required." }, { quoted: msg });

            try {
                const profileUrl = await sock.profilePictureUrl(jid, 'image');
                await sock.sendMessage(jid, { image: { url: profileUrl }, caption: "🖼️ Current Group Profile Picture" }, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: "❌ Failed to fetch Group Profile Picture. Ensure it is set to public." }, { quoted: msg });
            }
        }
    },

    // 15. SET GROUP PROFILE PICTURE
    {
        name: 'setpp',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return await sock.sendMessage(jid, { text: "❌ Group required." }, { quoted: msg });

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
            if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin privileges required." }, { quoted: msg });

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted || !quoted.imageMessage) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to an image with `.setpp`." }, { quoted: msg });
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
        }
    },

    // 16. WELCOME MODULE CONTROLLER
    {
        name: 'welcome',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return await sock.sendMessage(jid, { text: "❌ Group required." }, { quoted: msg });

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
            if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin privileges required." }, { quoted: msg });

            if (!settings.welcome) settings.welcome = {};

            const parts = args ? args.split(' ') : [];
            const subAction = parts[0] ? parts[0].toLowerCase().trim() : '';

            if (subAction === 'on') {
                settings.welcome[jid] = settings.welcome[jid] || { active: true, msg: "" };
                settings.welcome[jid].active = true;
                saveSettings();
                return await sock.sendMessage(jid, { text: "✅ Welcoming sequence activated for new members." }, { quoted: msg });
            } 
            
            if (subAction === 'off') {
                settings.welcome[jid] = settings.welcome[jid] || { active: false, msg: "" };
                settings.welcome[jid].active = false;
                saveSettings();
                return await sock.sendMessage(jid, { text: "❌ Welcoming sequence deactivated." }, { quoted: msg });
            } 
            
            if (subAction === 'set') {
                const customMsg = parts.slice(1).join(' ').trim();
                if (!customMsg) return await sock.sendMessage(jid, { text: "❌ Provide a custom message." }, { quoted: msg });

                settings.welcome[jid] = settings.welcome[jid] || { active: true };
                settings.welcome[jid].msg = customMsg;
                saveSettings();
                return await sock.sendMessage(jid, { text: `✅ Custom welcome message set:\n"${customMsg}"` }, { quoted: msg });
            }

            const currentStatus = settings.welcome[jid]?.active ? "Enabled ✅" : "Disabled ❌";
            const prompt = `🌸 *Welcome Module Configuration:*\n\n• *Status:* \`${currentStatus}\`\n• *Custom Message:* \`${settings.welcome[jid]?.msg || "Default"}\`\n\nSelect an option below:`;
            
            const buttonMessage = {
                text: prompt,
                buttons: [
                    { buttonId: `${settings.prefix}welcome on`, buttonText: { displayText: 'Enable' }, type: 1 },
                    { buttonId: `${settings.prefix}welcome off`, buttonText: { displayText: 'Disable' }, type: 1 }
                ],
                headerType: 1
            };
            try { 
                await sock.sendMessage(jid, buttonMessage, { quoted: msg }); 
            } catch (e) { 
                await sock.sendMessage(jid, { text: prompt }, { quoted: msg }); 
            }
        }
    },

    // 17. GOODBYE MODULE CONTROLLER
    {
        name: 'goodbye',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return await sock.sendMessage(jid, { text: "❌ Group required." }, { quoted: msg });

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
            if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin privileges required." }, { quoted: msg });

            if (!settings.goodbye) settings.goodbye = {};

            const parts = args ? args.split(' ') : [];
            const subAction = parts[0] ? parts[0].toLowerCase().trim() : '';

            if (subAction === 'on') {
                settings.goodbye[jid] = settings.goodbye[jid] || { active: true, msg: "" };
                settings.goodbye[jid].active = true;
                saveSettings();
                return await sock.sendMessage(jid, { text: "✅ Goodbye notification sequence activated." }, { quoted: msg });
            } 
            
            if (subAction === 'off') {
                settings.goodbye[jid] = settings.goodbye[jid] || { active: false, msg: "" };
                settings.goodbye[jid].active = false;
                saveSettings();
                return await sock.sendMessage(jid, { text: "❌ Goodbye notification sequence deactivated." }, { quoted: msg });
            } 
            
            if (subAction === 'set') {
                const customMsg = parts.slice(1).join(' ').trim();
                if (!customMsg) return await sock.sendMessage(jid, { text: "❌ Provide custom goodbye message." }, { quoted: msg });

                settings.goodbye[jid] = settings.goodbye[jid] || { active: true };
                settings.goodbye[jid].msg = customMsg;
                saveSettings();
                return await sock.sendMessage(jid, { text: `✅ Custom goodbye message set:\n"${customMsg}"` }, { quoted: msg });
            }

            const currentStatus = settings.goodbye[jid]?.active ? "Enabled ✅" : "Disabled ❌";
            const prompt = `🌸 *Goodbye Module Configuration:*\n\n• *Status:* \`${currentStatus}\`\n• *Custom Message:* \`${settings.goodbye[jid]?.msg || "Default"}\`\n\nSelect an option below:`;
            
            const buttonMessage = {
                text: prompt,
                buttons: [
                    { buttonId: `${settings.prefix}goodbye on`, buttonText: { displayText: 'Enable' }, type: 1 },
                    { buttonId: `${settings.prefix}goodbye off`, buttonText: { displayText: 'Disable' }, type: 1 }
                ],
                headerType: 1
            };
            try { 
                await sock.sendMessage(jid, buttonMessage, { quoted: msg }); 
            } catch (e) { 
                await sock.sendMessage(jid, { text: prompt }, { quoted: msg }); 
            }
        }
    },

    // 18. CLEAR WELCOME CONFIGS
    {
        name: 'delwelcome',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
            if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin rights required." }, { quoted: msg });

            if (settings.welcome && settings.welcome[jid]) delete settings.welcome[jid];
            await sock.sendMessage(jid, { text: "✅ Welcome settings removed." }, { quoted: msg });
            saveSettings();
        }
    },

    // 19. CLEAR GOODBYE CONFIGS
    {
        name: 'delgoodbye',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
            if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin rights required." }, { quoted: msg });

            if (settings.goodbye && settings.goodbye[jid]) delete settings.goodbye[jid];
            await sock.sendMessage(jid, { text: "✅ Goodbye settings removed." }, { quoted: msg });
            saveSettings();
        }
    },

    // 20. CREATE GROUP POLL
    {
        name: 'poll',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            
            const match = args ? args.match(/^(.+?)\s*\((.+?)\)$/) : null;

            if (!match) {
                return await sock.sendMessage(jid, { 
                    text: `❌ *Invalid Poll Format!*\n\n*Format:* \`${settings.prefix}poll Question? (Option1/Option2/Option3...)\`\n*Example:* \`${settings.prefix}poll Are you gay? (Yes/No)\`` 
                }, { quoted: msg });
            }

            const question = match[1].trim();
            const options = match[2].split('/').map(o => o.trim()).filter(o => o);

            if (options.length < 2) {
                return await sock.sendMessage(jid, { 
                    text: "❌ A poll requires at least 2 options separated by a slash (/).\n\n*Example:* `(Yes/No/Maybe)`" 
                }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, {
                    poll: {
                        name: question,
                        values: options,
                        selectableCount: 1 
                    }
                }, { quoted: msg });
            } catch (e) {
                console.error("Poll Creation Error:", e.message);
            }
        }
    },

    // 21. ANTI STATUS GROUP MENTION (.antigm)
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
                    const prompt = `🔮 *Limitless AntiGroup-Mention status:* (Current: \`${current}\`)\n\nSelect an option below:`;
                    const buttonMessage = {
                        text: prompt,
                        buttons: [
                            { buttonId: `${settings.prefix}antigm delete`, buttonText: { displayText: 'Delete' }, type: 1 },
                            { buttonId: `${settings.prefix}antigm warn`, buttonText: { displayText: 'Warn' }, type: 1 },
                            { buttonId: `${settings.prefix}antigm off`, buttonText: { displayText: 'Disable' }, type: 1 }
                        ],
                        headerType: 1
                    };
                    try { 
                        return await sock.sendMessage(jid, buttonMessage, { quoted: msg }); 
                    } catch (e) { 
                        return await sock.sendMessage(jid, { text: prompt }, { quoted: msg }); 
                    }
                }

                const action = args.toLowerCase().trim();
                if (['warn', 'delete', 'kick', 'off'].includes(action)) {
                    settings.antigm[jid] = action;
                    await sock.sendMessage(jid, { text: `🔒 *AntiGroup-Mention protection updated:* \`${action}\`` }, { quoted: msg });
                    saveSettings();
                } else {
                    await sock.sendMessage(jid, { text: "❌ Use the button toggles." }, { quoted: msg });
                }
            } catch (e) {
                console.error(e);
            }
        }
    },

    // 22. CONVERSATION LOGGER & SUMMARIZER (100% Groq-Powered) [INDEX: ai.js]
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

                if (action === 'check') {
                    const active = settings.gclogActive[jid];
                    const logs = settings.conversationLogs?.[jid] || [];

                    if (!active) {
                        return await sock.sendMessage(jid, { text: "⚠️ Log recorder is currently offline. Enable it via buttons first." }, { quoted: msg });
                    }

                    if (logs.length === 0) {
                        return await sock.sendMessage(jid, { text: "📊 No message flow logged yet. Let members speak first." }, { quoted: msg });
                    }

                    await sock.sendMessage(jid, { text: `⏳ *Summarizing ${logs.length} logged message(s) using Satoru Gojo's intelligence...*` }, { quoted: msg });

                    const logString = logs.map(l => `[${new Date(l.time).toLocaleTimeString()}] ${l.sender}: ${l.text}`).join('\n');

                    const s1 = "gsk_";
                    const s2 = "tPB0xMyZ2oijloaBNcDs";
                    const s3 = "WGdyb3FY5iC2p9hwRE";
                    const s4 = "SIJXAV3t53LZg9";
                    const GROQ_API_KEY = s1 + s2 + s3 + s4;

                    const systemPrompt = "You are Satoru Gojo from Jujutsu Kaisen. Analyze this group log and provide a highly engaging, cocky, and playful summary of topics, drama, or decisions. Keep it brief.";

                    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${GROQ_API_KEY}`
                        },
                        body: JSON.stringify({
                            model: "llama-3.3-70b-versatile",
                            messages: [
                                { role: "system", content: systemPrompt },
                                { role: "user", content: `Analyze the following highly condensed WhatsApp group chat logs:\n\n${logString}` }
                            ]
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`Groq API Error ${response.status}`);
                    }

                    const data = await response.json();
                    const responseText = data.choices?.[0]?.message?.content || "Could not generate summary.";

                    await sock.sendMessage(jid, { text: `🤞 *LIMITLESS SYSTEM LOG SUMMARY:* 🤞\n━━━━━━━━━━━━━━━━━━━\n\n${responseText}` }, { quoted: msg });
                    return;
                }

                const activeStatus = settings.gclogActive[jid] ? "Active 🟢" : "Inactive 💤";
                const prompt = `📊 *Group Chat Log (GCLOG) Configuration:*\n\n• *Status:* \`${activeStatus}\`\n\nSelect an option below to toggle the logger:`;
                
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}gclog on`, buttonText: { displayText: 'Enable' }, type: 1 },
                        { buttonId: `${settings.prefix}gclog off`, buttonText: { displayText: 'Disable' }, type: 1 },
                        { buttonId: `${settings.prefix}gclog check`, buttonText: { displayText: 'Check Summary' }, type: 1 }
                    ],
                    headerType: 1
                };
                try {
                    await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
                }

            } catch (e) {
                console.error(e);
                await sock.sendMessage(jid, { text: `❌ Summary generation failed: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 23. CREATE NEW GROUP CHAT
    {
        name: 'creategc',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            if (!args) return await sock.sendMessage(jid, { text: "❌ Provide a group name." }, { quoted: msg });

            try {
                const senderJid = msg.key.participant || msg.key.remoteJid;
                const phoneJid = await resolveToPhoneJid(sock, senderJid);
                
                if (!phoneJid) {
                    return await sock.sendMessage(jid, { text: "❌ Could not resolve your standard Phone format." }, { quoted: msg });
                }

                const group = await sock.groupCreate(args, [phoneJid]);
                
                await sock.sendMessage(jid, { 
                    text: `` +
                          `• *Name:* \`${args}\`\n` +
                          `• *ID:* \`${group.id}\`\n\n` +
                          `_Link to join:_ https://chat.whatsapp.com/${await sock.groupInviteCode(group.id)}`
                }, { quoted: msg });
            } catch (e) {
                console.error("CreateGC Error:", e);
                await sock.sendMessage(jid, { text: `❌ Failed to create group: ${e.message}` }, { quoted: msg });
            }
        }
    },

    // 24. EXORCISE ALL TARGETS (Owner / Sudo Only)
    {
        name: 'kickall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');

            if (!isGroup) return await sock.sendMessage(jid, { text: "❌ This command can only be used inside groups." }, { quoted: msg });
            if (!isOwner && !isSudo) return await sock.sendMessage(jid, { text: "❌ Owner or Sudo privileges required." }, { quoted: msg });

            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const participants = groupMetadata.participants;

                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const botLid = sock.user.id.split(':')[0] + '@lid';

                const botParticipant = participants.find(p => p.id === botJid || p.id === botLid);
                const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

                if (!isBotAdmin) {
                    return await sock.sendMessage(jid, { text: "❌ Satoru Gojo must be an Administrator in this group to run this." }, { quoted: msg });
                }

                await sock.sendMessage(jid, { text: "🌪️ *Channelling Limitless Void... Exorcising all members from this domain.*" }, { quoted: msg });

                const targets = participants.filter(p => 
                    p.id !== botJid && 
                    p.id !== botLid && 
                    p.id.split('@')[0] !== settings.ownerNumber && 
                    !settings.devs.includes(p.id.split('@')[0]) &&
                    p.admin !== 'superadmin' &&
                    p.admin !== 'admin'
                ).map(p => p.id);

                if (targets.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ No non-admin targets found to exorcise." }, { quoted: msg });
                }

                global.kickallActive[jid] = true;

                for (const target of targets) {
                    if (!global.kickallActive[jid]) {
                        await sock.sendMessage(jid, { text: "🛑 *Exorcism sequence aborted by administrator.*" });
                        break;
                    }
                    try {
                        await sock.groupParticipantsUpdate(jid, [target], "remove");
                        await new Promise(r => setTimeout(r, 1000)); 
                    } catch (err) {
                        console.error(`Failed to kick ${target}:`, err.message);
                    }
                }

                delete global.kickallActive[jid];
                await sock.sendMessage(jid, { text: "✅ *Exorcism complete.* All targets removed from this domain." });

            } catch (error) {
                console.error("Kickall Error:", error);
            }
        }
    },

    // 25. ABORT EXORCISM SEQUENCE (.stopkickall)
    {
        name: 'stopkickall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            if (global.kickallActive[jid]) {
                global.kickallActive[jid] = false;
                await sock.sendMessage(jid, { text: "🛑 *Stopping exorcism... Please wait.*" }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: "❌ No active kickall operation running in this group." }, { quoted: msg });
            }
        }
    },

    // 26. TIMED KICK CONTROLLER
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

                const durationString = args.replace(/@[^ ]+/g, '').trim().split(' ')[0] || '';
                if (durationString.toLowerCase() === 'cancel' || durationString.toLowerCase() === 'stop') {
                    return await commands[`${settings.prefix}tkick_cancel_all`](sock, msg, args, { isOwner });
                }

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

    // 27. CANCEL ALL TIMED KICKS IN GROUP
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
    },

    // 28. FETCH GROUP JID (.gcjid)
    {
        name: 'gcjid',
        isPrefixless: false,
        execute: async (sock, msg, args) => {
            const jid = msg.key.remoteJid;
            await sock.sendMessage(jid, { text: `🆔 *Group JID:* \`${jid}\`` }, { quoted: msg });
        }
    },

    // 29. ANTISPAM CONTROLLER PANEL
    {
        name: 'antispam',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
            if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin privileges required." }, { quoted: msg });

            if (!settings.antispam) settings.antispam = {};

            const action = args ? args.toLowerCase().trim() : '';

            if (action === 'on') {
                settings.antispam[jid] = settings.antispam[jid] || { status: 'on', rate: { count: 1, seconds: 2 } };
                settings.antispam[jid].status = 'on';
                saveSettings();
                return await sock.sendMessage(jid, { text: "🔒 *Antispam Protection activated!* Rates set to standard: `1 chat/2s`." }, { quoted: msg });
            }

            if (action === 'off') {
                if (settings.antispam[jid]) settings.antispam[jid].status = 'off';
                saveSettings();
                return await sock.sendMessage(jid, { text: "🔓 *Antispam Protection deactivated completely.*" }, { quoted: msg });
            }

            if (action.startsWith('trig')) {
                const param = action.replace('trig', '').trim(); // e.g. "1/2s"
                const match = param.match(/^(\d+)\/(\d+)s$/);

                if (!match) {
                    return await sock.sendMessage(jid, { text: "❌ Invalid trigger rate. Use format: `.antispam trig 1/2s` (messages/seconds)." }, { quoted: msg });
                }

                const count = parseInt(match[1]);
                const seconds = parseInt(match[2]);

                settings.antispam[jid] = settings.antispam[jid] || { status: 'on' };
                settings.antispam[jid].rate = { count, seconds };
                settings.antispam[jid].status = 'on';
                saveSettings();

                return await sock.sendMessage(jid, { text: `✅ *Spam threshold modified:* \`${count} message(s) per ${seconds} second(s)\`.` }, { quoted: msg });
            }

            const current = settings.antispam[jid]?.status || 'off';
            const rate = settings.antispam[jid]?.rate ? `${settings.antispam[jid].rate.count}/${settings.antispam[jid].rate.seconds}s` : '1/2s';
            const prompt = `🛡️ *Antispam Moderation Panel:* (Status: \`${current.toUpperCase()}\`)\n• *Current Threshold:* \`${rate}\`\n\nSelect an option below:`;

            const buttonMessage = {
                text: prompt,
                buttons: [
                    { buttonId: `${settings.prefix}antispam on`, buttonText: { displayText: 'Enable' }, type: 1 },
                    { buttonId: `${settings.prefix}antispam off`, buttonText: { displayText: 'Disable' }, type: 1 }
                ],
                headerType: 1
            };

            try {
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (e) {
                await sock.sendMessage(jid, { text: prompt }, { quoted: msg });
            }
        }
    },

    // 30. .silence MODULE (AUTO-DELETER & CHAT MUTOR CONTROLLER)
    {
        name: 'silence',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
            if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin privileges required." }, { quoted: msg });

            const senderJid = msg.key.participant || msg.key.remoteJid || '';
            const repliedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
            const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];

            const targetJid = repliedJid || (mentions.length > 0 ? mentions[0] : '');

            if (!targetJid || targetJid === senderJid) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a user's message or mention (@user) to silence them." }, { quoted: msg });
            }

            const targetNum = targetJid.split('@')[0];

            const cleanArgs = args ? args.replace(/@[^ ]+/g, '').trim() : '';
            const parts = cleanArgs.split(' ');
            
            let mode = '';
            let timerStr = '1h'; // default duration if unspecified

            if (parts[0]) {
                if (['-s', '-m', 'all'].includes(parts[0])) {
                    mode = parts[0];
                    if (parts[1]) timerStr = parts[1];
                } else {
                    timerStr = parts[0];
                }
            }

            const durationMs = parseDuration(timerStr) || 3600000; // fallback to 1h

            // If no mode is specified, drop interactive selection buttons with 1 hour default [INDEX: group.js]
            if (!mode) {
                const prompt = `⛓️ *Silence Detention Panel:* @${targetNum}\n\nSelect the type of communication to auto-delete for *${timerStr}*:`;
                const buttonMessage = {
                    text: prompt,
                    buttons: [
                        { buttonId: `${settings.prefix}silence_ans sticker ${targetNum} ${timerStr}`, buttonText: { displayText: 'Sticker Only' }, type: 1 },
                        { buttonId: `${settings.prefix}silence_ans message ${targetNum} ${timerStr}`, buttonText: { displayText: 'Messages/Media' }, type: 1 },
                        { buttonId: `${settings.prefix}silence_ans all ${targetNum} ${timerStr}`, buttonText: { displayText: 'Silence All' }, type: 1 }
                    ],
                    headerType: 1,
                    mentions: [targetJid]
                };

                try {
                    return await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                } catch (e) {
                    return await sock.sendMessage(jid, { text: `${prompt}\n\n• \`.silence -s ${timerStr}\`\n• \`.silence -m ${timerStr}\`\n• \`.silence all ${timerStr}\``, mentions: [targetJid] }, { quoted: msg });
                }
            }

            // Direct CLI execution path (handles custom duration e.g., -m 30m or -s 2h)
            let mappedType = 'all';
            if (mode === '-s') mappedType = 'sticker';
            if (mode === '-m') mappedType = 'message';

            global.silencedUsers[jid] = global.silencedUsers[jid] || {};
            global.silencedUsers[jid][targetJid] = {
                type: mappedType,
                endTime: Date.now() + durationMs
            };

            await sock.sendMessage(jid, { 
                text: `⛓️ *Target @${targetNum} silenced:* \`${mappedType.toUpperCase()}\` constraints active for *${timerStr}*.`,
                mentions: [targetJid]
            }, { quoted: msg });
        }
    },

    // 31. .silence_ans DETENTION SECURE INTERACTOR BUTTON HANDLER
    {
        name: 'silence_ans',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!args) return;

            const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
            if (!isAuthorized) return;

            const parts = args.split(' ');
            const type = parts[0]?.toLowerCase().trim(); // 'sticker', 'message', 'all'
            const targetNum = parts[1]?.trim();
            const timerStr = parts[2]?.trim() || '1h';

            if (!type || !targetNum) return;

            const targetJid = `${targetNum}@s.whatsapp.net`;
            const durationMs = parseDuration(timerStr) || 3600000;

            global.silencedUsers[jid] = global.silencedUsers[jid] || {};
            global.silencedUsers[jid][targetJid] = {
                type: type,
                endTime: Date.now() + durationMs
            };

            await sock.sendMessage(jid, {
                text: `⛓️ *Target @${targetNum} silenced:* \`${type.toUpperCase()}\` constraints active for *${timerStr}*.`,
                mentions: [targetJid]
            }, { quoted: msg });
        }
    },

    // 32. .unsilence COMMAND (OPPOSE SILENCE MODERATIONS)
    {
        name: 'unsilence',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            if (!isGroup) return;

            try {
                const isAuthorized = await verifyPermissions(sock, msg, jid, isOwner);
                if (!isAuthorized) return await sock.sendMessage(jid, { text: "❌ Admin privileges required." }, { quoted: msg });

                const repliedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
                const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const targetJid = repliedJid || (mentions.length > 0 ? mentions[0] : '');

                if (!targetJid) {
                    return await sock.sendMessage(jid, { text: "❌ Please reply to a user's message or mention (@user) to unsilence them." }, { quoted: msg });
                }

                const targetNum = targetJid.split('@')[0];

                if (global.silencedUsers[jid] && global.silencedUsers[jid][targetJid]) {
                    delete global.silencedUsers[jid][targetJid];
                    await sock.sendMessage(jid, { text: `⛓️ *Target @${targetNum} unsilenced.* All chat constraints removed.`, mentions: [targetJid] }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: `❌ Target @${targetNum} is not currently silenced in this chat.`, mentions: [targetJid] }, { quoted: msg });
                }

            } catch (err) {
                console.error("Unsilence error:", err.message);
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
    if (cmd.name === 'mute') {
        aliases.push({ ...cmd, name: 'unmute' });
        aliases.push({ ...cmd, name: 'open' });
        aliases.push({ ...cmd, name: 'close' });
        aliases.push({ ...cmd, name: 'lock' });
        aliases.push({ ...cmd, name: 'unlock' });
    }
});
module.exports.push(...aliases);