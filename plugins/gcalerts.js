// plugins/gcalerts.js
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getPhoneJid, normalizeToJid, saveState } = require('../stateManager');

const alertsPath = path.join(__dirname, '../storage/gcalerts.json');

// ─── SETTINGS FILE PERSISTENCE ────────────────────────────────────

function readAlertsData() {
    try {
        if (fs.existsSync(alertsPath)) {
            return JSON.parse(fs.readFileSync(alertsPath, 'utf-8'));
        }
    } catch (e) {
        console.error("⚠️ [ALERTS] Failed to parse alerts file.");
    }
    return { 
        welcome: {}, goodbye: {}, promote: {}, demote: {}, 
        customWelcome: {}, customGoodbye: {}, 
        antijoin: {}, antipromote: {}, antidemote: {}, overkill: {} 
    };
}

function saveAlertsData(data) {
    try {
        const dir = path.dirname(alertsPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(alertsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) { /* ignore */ }
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

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [

    // 1. WELCOME
    {
        name: 'welcome',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const isAuthorized = isOwner || isSudo || isDev || isAdmin;
            if (!isAuthorized) return;

            const action = args ? args.toLowerCase().trim() : '';
            if (action !== 'on' && action !== 'off') {
                return await sock.sendMessage(jid, { text: `❌ Use: \`${config.prefix}welcome <on/off>\`` }, { quoted: msg });
            }

            const data = readAlertsData();
            data.welcome = data.welcome || {};
            data.welcome[jid] = action;
            saveAlertsData(data);

            await sock.sendMessage(jid, { text: `✅ Welcome alerts have been turned *${action.toUpperCase()}*` }, { quoted: msg });
        }
    },

    // 2. GOODBYE
    {
        name: 'goodbye',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const isAuthorized = isOwner || isSudo || isDev || isAdmin;
            if (!isAuthorized) return;

            const action = args ? args.toLowerCase().trim() : '';
            if (action !== 'on' && action !== 'off') {
                return await sock.sendMessage(jid, { text: `❌ Use: \`${config.prefix}goodbye <on/off>\`` }, { quoted: msg });
            }

            const data = readAlertsData();
            data.goodbye = data.goodbye || {};
            data.goodbye[jid] = action;
            saveAlertsData(data);

            await sock.sendMessage(jid, { text: `✅ Goodbye alerts have been turned *${action.toUpperCase()}*` }, { quoted: msg });
        }
    },

    // 3. SETWELCOME
    {
        name: 'setwelcome',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const isAuthorized = isOwner || isSudo || isDev || isAdmin;
            if (!isAuthorized) return;

            if (!args || !args.trim()) {
                return await sock.sendMessage(jid, { text: `❌ Please provide custom welcome layout.\nExample: \`${config.prefix}setwelcome Welcome @user to @group! 🌸\`` }, { quoted: msg });
            }

            const data = readAlertsData();
            data.welcome = data.welcome || {};
            data.welcome[jid] = 'on';
            data.customWelcome = data.customWelcome || {};
            data.customWelcome[jid] = args.trim();
            saveAlertsData(data);

            await sock.sendMessage(jid, { text: "✅ Custom welcome message set and activated." }, { quoted: msg });
        }
    },

    // 4. SETGOODBYE
    {
        name: 'setgoodbye',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const isAuthorized = isOwner || isSudo || isDev || isAdmin;
            if (!isAuthorized) return;

            if (!args || !args.trim()) {
                return await sock.sendMessage(jid, { text: `❌ Please provide custom goodbye layout.\nExample: \`${config.prefix}setgoodbye Goodbye @user! 🥀\`` }, { quoted: msg });
            }

            const data = readAlertsData();
            data.goodbye = data.goodbye || {};
            data.goodbye[jid] = 'on';
            data.customGoodbye = data.customGoodbye || {};
            data.customGoodbye[jid] = args.trim();
            saveAlertsData(data);

            await sock.sendMessage(jid, { text: "✅ Custom goodbye message set and activated." }, { quoted: msg });
        }
    },

    // 5. PROMOTION
    {
        name: 'promotion',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const isAuthorized = isOwner || isSudo || isDev || isAdmin;
            if (!isAuthorized) return;

            const action = args ? args.toLowerCase().trim() : '';
            if (action !== 'on' && action !== 'off') {
                return await sock.sendMessage(jid, { text: `❌ Use: \`${config.prefix}promotion <on/off>\`` }, { quoted: msg });
            }

            const data = readAlertsData();
            data.promote = data.promote || {};
            data.promote[jid] = action;
            saveAlertsData(data);

            await sock.sendMessage(jid, { text: `✅ Promotion alerts have been turned *${action.toUpperCase()}*` }, { quoted: msg });
        }
    },

    // 6. DEMOTION
    {
        name: 'demotion',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return;

            const isAuthorized = isOwner || isSudo || isDev || isAdmin;
            if (!isAuthorized) return;

            const action = args ? args.toLowerCase().trim() : '';
            if (action !== 'on' && action !== 'off') {
                return await sock.sendMessage(jid, { text: `❌ Use: \`${config.prefix}demotion <on/off>\`` }, { quoted: msg });
            }

            const data = readAlertsData();
            data.demote = data.demote || {};
            data.demote[jid] = action;
            saveAlertsData(data);

            await sock.sendMessage(jid, { text: `✅ Demotion alerts have been turned *${action.toUpperCase()}*` }, { quoted: msg });
        }
    },

    // 7. GCALERTS (Consolidated Alert Dashboard)
    {
        name: 'gcalerts',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return await sock.sendMessage(jid, { text: "❌ This command can only be executed within group chats." }, { quoted: msg });

            const isAuthorized = isOwner || isSudo || isDev || isAdmin;
            if (!isAuthorized) return;

            const data = readAlertsData();
            const rawAction = args ? args.toLowerCase().trim() : '';

            // Master enable/disable
            if (rawAction === 'on' || rawAction === 'off') {
                data.promote = data.promote || {};
                data.demote = data.demote || {};
                data.welcome = data.welcome || {};
                data.goodbye = data.goodbye || {};

                data.promote[jid] = rawAction;
                data.demote[jid] = rawAction;
                data.welcome[jid] = rawAction;
                data.goodbye[jid] = rawAction;

                saveAlertsData(data);
                return await sock.sendMessage(jid, { text: `✅ *All alerts have been turned ${rawAction.toUpperCase()} for this group!*` }, { quoted: msg });
            }

            // Dashboard Status Display
            const welStatus = data.welcome?.[jid] || 'off';
            const gbStatus = data.goodbye?.[jid] || 'off';
            const promStatus = data.promote?.[jid] || 'off';
            const demStatus = data.demote?.[jid] || 'off';

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

    // 8. ANTIJOIN (Automatic Gatekeeper Kicks) [1.1]
    {
        name: 'antijoin',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return await sock.sendMessage(jid, { text: "❌ This command can only be executed within group chats." }, { quoted: msg });

            const isAuthorized = isOwner || isSudo || isDev || isAdmin;
            if (!isAuthorized) return;

            const subCommand = args ? args.toLowerCase().trim() : '';
            const data = readAlertsData();
            data.antijoin = data.antijoin || {};

            // ─── CASE A: DISPLAY STATUS & TOGGLE BUTTONS ─── [1.1]
            if (!subCommand) {
                const currentStatus = (data.antijoin[jid] === 'on') ? 'Active 🔒' : 'Inactive 🔓';
                const statusText =
                    `🛡️ *ANTI-JOIN PROTECTION STATE* 🛡️\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `• *Group:* \`${jid.split('@')[0]}\`\n` +
                    `• *Gatekeeper Status:* \`${currentStatus}\`\n\n` +
                    `If active, any unauthorized joins or non-admin additions will trigger an instant, automated kick [1.1]. Configure settings below:`;

                const buttonMessage = {
                    text: statusText,
                    footer: "🛡️ Limitless Security Gatekeeper",
                    buttons: [
                        { buttonId: `${config.prefix}antijoin on`, buttonText: { displayText: "Enable Lock 🔒" }, type: 1 },
                        { buttonId: `${config.prefix}antijoin off`, buttonText: { displayText: "Disable Lock 🔓" }, type: 1 }
                    ],
                    headerType: 1
                };
                return await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            }

            // ─── CASE B: TOGGLE ON/OFF ───
            if (subCommand === 'on' || subCommand === 'off') {
                data.antijoin[jid] = subCommand;
                saveAlertsData(data);
                const confirmText = subCommand === 'on' 
                    ? "🔒 *Anti-Join Protection activated! The automated gatekeeper is now armed.*"
                    : "🔓 *Anti-Join Protection deactivated completely.*";
                return await sock.sendMessage(jid, { text: confirmText }, { quoted: msg });
            }

            await sock.sendMessage(jid, { text: `❌ Unknown option. Type \`${config.prefix}antijoin\` to see active options.` }, { quoted: msg });
        }
    },

    // 9. ANTIPROMOTE (Admin Promotion Protection) [1.1]
    {
        name: 'antipromote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return await sock.sendMessage(jid, { text: "❌ This command can only be executed within group chats." }, { quoted: msg });

            const isAuthorized = isOwner || isSudo || isDev || isAdmin;
            if (!isAuthorized) return;

            const subCommand = args ? args.toLowerCase().trim() : '';
            const data = readAlertsData();
            data.antipromote = data.antipromote || {};

            // ─── CASE A: DISPLAY STATUS & BUTTONS ─── [1.1]
            if (!subCommand) {
                const rawStatus = data.antipromote[jid] || 'off';
                const currentStatus = rawStatus === 'overkill' ? 'OVERKILL 🚨' : (rawStatus === 'on' ? 'Standard 🛡️' : 'Disabled 💤');
                
                const statusText =
                    `🛡️ *ANTI-PROMOTE PROTECTION STATE* 🛡️\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `• *Group:* \`${jid.split('@')[0]}\`\n` +
                    `• *Status:* \`${currentStatus}\`\n\n` +
                    `Prevents unauthorized role promotions. Standard rolls back the change; Overkill demotes all non-exempt admins and locks the chat [1.1].`;

                const buttonMessage = {
                    text: statusText,
                    footer: "🛡️ Limitless Security Shield",
                    buttons: [
                        { buttonId: `${config.prefix}antipromote on`, buttonText: { displayText: "Enable Standard 🛡️" }, type: 1 },
                        { buttonId: `${config.prefix}antipromote overkill`, buttonText: { displayText: "Enable OVERKILL 🚨" }, type: 1 },
                        { buttonId: `${config.prefix}antipromote off`, buttonText: { displayText: "Disable Shield 💤" }, type: 1 }
                    ],
                    headerType: 1
                };
                return await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            }

            // ─── CASE B: SET TOGGLE ───
            if (['on', 'off', 'overkill'].includes(subCommand)) {
                data.antipromote[jid] = subCommand;
                saveAlertsData(data);
                const statusMap = { 'off': 'Disabled 💤', 'on': 'Standard 🛡️', 'overkill': 'OVERKILL 🚨' };
                return await sock.sendMessage(jid, { text: `✅ *Anti-Promote protection updated:* ${statusMap[subCommand]}` }, { quoted: msg });
            }

            await sock.sendMessage(jid, { text: "❌ Invalid option. Use -on, -off, or -overkill." }, { quoted: msg });
        }
    },

    // 10. ANTIDEMOTE (Admin Demotion Protection) [1.1]
    {
        name: 'antidemote',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return await sock.sendMessage(jid, { text: "❌ This command can only be executed within group chats." }, { quoted: msg });

            const isAuthorized = isOwner || isSudo || isDev || isAdmin;
            if (!isAuthorized) return;

            const subCommand = args ? args.toLowerCase().trim() : '';
            const data = readAlertsData();
            data.antidemote = data.antidemote || {};

            // ─── CASE A: DISPLAY STATUS & BUTTONS ─── [1.1]
            if (!subCommand) {
                const rawStatus = data.antidemote[jid] || 'off';
                const currentStatus = rawStatus === 'overkill' ? 'OVERKILL 🚨' : (rawStatus === 'on' ? 'Standard 🛡️' : 'Disabled 💤');
                
                const statusText =
                    `🛡️ *ANTI-DEMOTE PROTECTION STATE* 🛡️\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `• *Group:* \`${jid.split('@')[0]}\`\n` +
                    `• *Status:* \`${currentStatus}\`\n\n` +
                    `Prevents unauthorized role demotions. Standard rolls back the change; Overkill demotes all non-exempt admins and locks the chat [1.1].`;

                const buttonMessage = {
                    text: statusText,
                    footer: "🛡️ Limitless Security Shield",
                    buttons: [
                        { buttonId: `${config.prefix}antidemote on`, buttonText: { displayText: "Enable Standard 🛡️" }, type: 1 },
                        { buttonId: `${config.prefix}antidemote overkill`, buttonText: { displayText: "Enable OVERKILL 🚨" }, type: 1 },
                        { buttonId: `${config.prefix}antidemote off`, buttonText: { displayText: "Disable Shield 💤" }, type: 1 }
                    ],
                    headerType: 1
                };
                return await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            }

            // ─── CASE B: SET TOGGLE ───
            if (['on', 'off', 'overkill'].includes(subCommand)) {
                data.antidemote[jid] = subCommand;
                saveAlertsData(data);
                const statusMap = { 'off': 'Disabled 💤', 'on': 'Standard 🛡️', 'overkill': 'OVERKILL 🚨' };
                return await sock.sendMessage(jid, { text: `✅ *Anti-Demote protection updated:* ${statusMap[subCommand]}` }, { quoted: msg });
            }

            await sock.sendMessage(jid, { text: "❌ Invalid option. Use -on, -off, or -overkill." }, { quoted: msg });
        }
    },

    // 11. OVERKILL (Nuclear Group Lockdown Switch) [1.1]
    {
        name: 'overkill',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev, isAdmin }) => {
            const jid = msg.key.remoteJid;
            if (!jid.endsWith('@g.us')) return await sock.sendMessage(jid, { text: "❌ This command can only be executed within group chats." }, { quoted: msg });

            const isAuthorized = isOwner || isSudo || isDev || isAdmin;
            if (!isAuthorized) return;

            const subCommand = args ? args.toLowerCase().trim() : '';
            const data = readAlertsData();
            data.overkill = data.overkill || {};

            // Helper to execute instant group-purge on-demand (Panic Mode) [1.1]
            const triggerEmergencyPurge = async () => {
                const metadata = await sock.groupMetadata(jid);
                const botJid = normalizeToJid(sock.user.id);
                const botLid = sock.user.lid ? normalizeToJid(sock.user.lid) : '';

                // Identify vulnerable admins (non-exempt) [1.1]
                const targetsToDemote = [];
                for (const p of metadata.participants) {
                    const pJid = normalizeToJid(p.id);
                    if (p.admin === 'admin' || p.admin === 'superadmin') {
                        const isExempt = pJid === botJid || pJid === botLid ||
                                         DEV_LIDS.includes(pJid) || DEV_JIDS.includes(pJid) || DEV_PHONE_JIDS.includes(pJid) ||
                                         pJid === config.ownerJid || pJid === config.ownerLid ||
                                         (Array.isArray(config.secondaryOwners) && config.secondaryOwners.includes(pJid)) ||
                                         (Array.isArray(config.sudos) && config.sudos.includes(pJid));

                        if (!isExempt) {
                            targetsToDemote.push(pJid);
                        }
                    }
                }

                const emergencyStatus = await sock.sendMessage(jid, { text: `🚨 *OVERKILL EMERGENCY PURGE STARTED* 🚨\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nPurging \`${targetsToDemote.length}\` non-exempt administrators...` });

                // 1. Demote all vulnerable administrators [1.1]
                if (targetsToDemote.length > 0) {
                    await sock.groupParticipantsUpdate(jid, targetsToDemote, "demote");
                }

                // 2. Closed-channel lockouts [1.1]
                await sock.groupSettingUpdate(jid, 'announcement');
                await sock.groupSettingUpdate(jid, 'locked');

                const summaryText =
                    `🚨 *CONTAINMENT COMPLETE* 🚨\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `⚠️ *Threat Contained:* \`${targetsToDemote.length}\` admin(s) demoted [1.1].\n` +
                    `🔒 *Innate Domain:* Group successfully locked to Admins-Only [1.1].\n` +
                    `⚖️ *Executioner:* @${(msg.key.participant || jid).split('@')[0]}\n\n` +
                    `_System operations will resume once verified by my creator._`;

                await sock.sendMessage(jid, { text: summaryText, mentions: [msg.key.participant || jid] }, { quoted: msg });
                try { await sock.sendMessage(jid, { delete: emergencyStatus.key }); } catch (e) { /* ignore */ }
            };

            // ─── CASE A: DISPLAY STATUS & PANIC BUTTON ─── [1.1]
            if (!subCommand) {
                const currentStatus = (data.overkill[jid] === 'on') ? 'Active 🟢' : 'Inactive 💤';
                
                const statusText =
                    `🚨 *OVERKILL DEFENSE SYSTEMS* 🚨\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `• *Group:* \`${jid.split('@')[0]}\`\n` +
                    `• *Auto-Overkill Trap:* \`${currentStatus}\`\n\n` +
                    `If active, any future unauthorized promote/demote automatically demotes all other admins and locks the group [1.1].\n\n` +
                    `👉 Click *PANIC LOCKDOWN* below to instantly demote all non-exempt admins and close this group right now [1.1]!`;

                const buttonMessage = {
                    text: statusText,
                    footer: "🚨 Limitless Emergency Lockdown Control",
                    buttons: [
                        { buttonId: `${config.prefix}overkill on`, buttonText: { displayText: "Arm Trap 🟢" }, type: 1 },
                        { buttonId: `${config.prefix}overkill off`, buttonText: { displayText: "Disarm Trap 💤" }, type: 1 },
                        { buttonId: `${config.prefix}overkill panic`, buttonText: { displayText: "PANIC LOCKDOWN 🚨" }, type: 1 }
                    ],
                    headerType: 1
                };
                return await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            }

            // ─── CASE B: TOGGLE AUTO-TRAP ON/OFF ───
            if (subCommand === 'on' || subCommand === 'off') {
                data.overkill[jid] = subCommand;
                saveAlertsData(data);
                const confirmText = subCommand === 'on' 
                    ? "🚨 *Overkill Protection armed! Future security breaches will trigger immediate mass admin demotions and channel locks.*"
                    : "💤 *Overkill Protection disarmed. Security breaches will only execute individual rollbacks.*";
                return await sock.sendMessage(jid, { text: confirmText }, { quoted: msg });
            }

            // ─── CASE C: PANIC MODE ON-DEMAND TRIGGER (.overkill panic) ─── [1.1]
            if (subCommand === 'panic' || subCommand === 'trigger' || subCommand === 'lock') {
                return await triggerEmergencyPurge();
            }

            await sock.sendMessage(jid, { text: `❌ Unknown option. Type \`${config.prefix}overkill\` to see options.` }, { quoted: msg });
        }
    }
];

// ─── ALIASES ──────────────────────────────────────────────────────

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'promotion') aliases.push({ ...cmd, name: 'promo' });
    if (cmd.name === 'demotion') aliases.push({ ...cmd, name: 'demo' });
    if (cmd.name === 'antijoin') {
        aliases.push({ ...cmd, name: 'lockjoin' });
    }
});
module.exports.push(...aliases);