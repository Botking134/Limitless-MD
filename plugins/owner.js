// plugins/owner.js
const config = require('../config');
const { DEV_JIDS, DEV_LIDS } = require('../devs');
const { 
    saveState, 
    addSecondaryOwner, 
    removeSecondaryOwner,
    addSudo,
    removeSudo,
    addBan,
    removeBan
} = require('../stateManager');
const { setVar, loadVars, syncVarsToConfig } = require('../vars');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const remindersPath = path.join(__dirname, '../storage/reminders.json');

// ─── GLOBAL SESSIONS ──────────────────────────────────────────────
if (!global.reminders) global.reminders = [];
if (!global.reminderSessions) global.reminderSessions = {};
if (!global.cancelSessions) global.cancelSessions = {};

// ─── HELPER: READ REMINDERS ──────────────────────────────────────
function readReminders() {
    try {
        if (fs.existsSync(remindersPath)) {
            return JSON.parse(fs.readFileSync(remindersPath, 'utf-8'));
        }
    } catch (e) {
        console.error("Failed to read reminders database:", e.message);
    }
    return [];
}

function saveReminders(reminders) {
    try {
        const dir = path.dirname(remindersPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(remindersPath, JSON.stringify(reminders, null, 2), 'utf-8');
    } catch (e) {
        console.error("Failed to save reminders database:", e.message);
    }
}

// ─── HELPER: PARSE DURATION ──────────────────────────────────────
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

// ─── HELPER: FORMAT UPTIME ──────────────────────────────────────
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${s}s`;
}

// ─── HELPER: NORMALIZE JID ──────────────────────────────────────
function normalizeToJid(input) {
    if (!input) return '';
    const clean = input.replace(/:[\d]+@/, '@');
    if (clean.endsWith('@s.whatsapp.net')) return clean;
    if (clean.endsWith('@lid')) return clean;
    const raw = clean.split('@')[0].replace(/[^0-9]/g, '');
    return raw ? `${raw}@s.whatsapp.net` : '';
}

// ─── HELPER: GET RAW MESSAGE ────────────────────────────────────
function getRawMessage(message) {
    if (!message) return null;
    if (message.ephemeralMessage?.message) return getRawMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return getRawMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return getRawMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) return getRawMessage(message.viewOnceMessageV2Extension.message);
    if (message.documentWithCaptionMessage?.message) return getRawMessage(message.documentWithCaptionMessage.message);
    return message;
}

// ─── HELPER: PARSE TARGET ────────────────────────────────────────
function parseTarget(msg, args) {
    const rawMsg = getRawMessage(msg.message);
    const contextInfo = rawMsg?.contextInfo ||
                        rawMsg?.extendedTextMessage?.contextInfo ||
                        rawMsg?.imageMessage?.contextInfo ||
                        rawMsg?.videoMessage?.contextInfo ||
                        rawMsg?.stickerMessage?.contextInfo ||
                        rawMsg?.audioMessage?.contextInfo ||
                        rawMsg?.documentMessage?.contextInfo;

    const quotedParticipant = contextInfo?.participant;
    let target = '';

    if (quotedParticipant) {
        target = normalizeToJid(quotedParticipant);
    } else if (contextInfo?.mentionedJid && contextInfo.mentionedJid.length > 0) {
        const botJid = config.botJid || '';
        const filteredMention = contextInfo.mentionedJid.find(jid => !jid.includes(botJid));
        const selectedJid = filteredMention || contextInfo.mentionedJid[0];
        target = normalizeToJid(selectedJid);
    } else if (args) {
        const cleanDigits = args.replace(/[^0-9]/g, '');
        if (cleanDigits.length >= 7) {
            target = `${cleanDigits}@s.whatsapp.net`;
        }
    }
    return target;
}

// ─── REMINDER INTERVAL ──────────────────────────────────────────
if (!global.reminderInterval) {
    global.reminderInterval = setInterval(async () => {
        if (!global.activeSock) return;

        const reminders = readReminders();
        if (reminders.length === 0) return;

        const now = Date.now();
        const due = reminders.filter(r => r.triggerTime <= now);
        const remaining = reminders.filter(r => r.triggerTime > now);

        if (due.length > 0) {
            for (const r of due) {
                try {
                    const formattedTime = new Date(r.timeSet).toLocaleTimeString('en-US', {
                        timeZone: 'Africa/Lagos',
                        hour12: true
                    });
                    const alertText =
                        `🔔 *LIMITLESS REMINDER ALERT!* 🔔\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `📌 *Title:* *${r.title}*\n` +
                        `📝 *Note:* _"${r.text}"_\n\n` +
                        `🕒 *Set At:* \`${formattedTime} WAT\`\n` +
                        `⏳ *Timer Duration:* \`${r.durationStr}\`\n\n` +
                        `_“My six eyes never forget a scheduled task.”_ 🤞`;

                    await global.activeSock.sendMessage(r.jid, { text: alertText });
                } catch (err) {
                    console.error("Failed to broadcast due reminder:", err.message);
                }
            }
            saveReminders(remaining);
        }
    }, 10000);
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [
    // 1. DIAGNOSE
    {
        name: 'diagnose',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            let report = "🔍 *Limitless System Diagnosis:*\n━━━━━━━━━━━━━━━━━━━\n\n";
            const filesToTest = [
                'plugins/owner.js',
                'plugins/ai.js',
                'plugins/fun.js',
                'plugins/menu.js',
                'plugins/games.js',
                'plugins/games2.js',
                'plugins/group_basic.js',
                'plugins/group_security.js',
                'plugins/group_advanced.js',
                'plugins/tools.js',
                'plugins/utilities.js',
                'plugins/converter.js',
                'plugins/downloaders/aud.js',
                'plugins/downloaders/dl.js',
                'plugins/downloaders/vid.js'
            ];

            for (const file of filesToTest) {
                const filePath = path.join(__dirname, '..', file);
                
                if (!fs.existsSync(filePath)) {
                    report += `⚠️ *${file}*:\n• *Status:* Missing ❌\n\n`;
                    continue;
                }

                try {
                    delete require.cache[require.resolve(filePath)];
                    require(filePath);
                    report += `✅ *${file}*:\n• *Status:* Loaded successfully!\n\n`;
                } catch (err) {
                    report += `❌ *${file}*:\n• *Status:* Failed to load\n• *Error:* \`${err.message}\`\n\n`;
                }
            }

            await sock.sendMessage(jid, { text: report }, { quoted: msg });
        }
    },

    // 2. UPDATE
    {
        name: 'update',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isDev }) => {
            const jid = msg.key.remoteJid;

            const parts = args ? args.split(' ') : [];
            const action = parts[0] ? parts[0].toLowerCase().trim() : '';
            const option = parts[1] ? parts[1].toLowerCase().trim() : '';
            const repoUrl = "https://github.com/Botking134/Limitless-MD.git";

            if (action === 'install' || action === 'repair' || action === 'npm') {
                if (!isDev) return;
                await sock.sendMessage(jid, { text: "⏳ *Running npm install to download and repair missing packages...*" }, { quoted: msg });
                exec('npm install', async (err, stdout, stderr) => {
                    if (err) {
                        return await sock.sendMessage(jid, {
                            text: `❌ *Package Installation Failed:*\n\`${err.message}\``
                        }, { quoted: msg });
                    }
                    await sock.sendMessage(jid, {
                        text: `✅ *All packages successfully installed and repaired!*\n\n${stdout || 'Ready.'}\n\n🔄 _Restarting the system to load plugins..._`
                    }, { quoted: msg });
                    setTimeout(() => process.exit(1), 3000);
                });
                return;
            }

            if (!isOwner) return;

            if (action === 'setup') {
                await sock.sendMessage(jid, { text: "⏳ *Initializing Git tracking directly from the server...*" }, { quoted: msg });
                const setupCommand = `git init && git remote add origin ${repoUrl} && git fetch origin && (git checkout -f main || git checkout -f master)`;
                exec(setupCommand, async (err, stdout, stderr) => {
                    if (err) {
                        if (err.message.includes('already exists')) {
                            exec(`git remote set-url origin ${repoUrl} && git fetch origin && (git checkout -f main || git checkout -f master)`, async (retryErr) => {
                                if (retryErr) {
                                    return await sock.sendMessage(jid, {
                                        text: `❌ *Setup Retry Failed:*\n\`${retryErr.message}\``
                                    }, { quoted: msg });
                                }
                                return await sock.sendMessage(jid, {
                                    text: "✅ *Git tracking successfully initialized and linked!* You can now use standard `⚡ update` commands."
                                }, { quoted: msg });
                            });
                            return;
                        }
                        return await sock.sendMessage(jid, {
                            text: `❌ *Git Setup Failed:*\n\`${err.message}\``
                        }, { quoted: msg });
                    }
                    return await sock.sendMessage(jid, {
                        text: "✅ *Git tracking successfully initialized and linked!* You can now use standard `⚡ update` commands."
                    }, { quoted: msg });
                });
                return;
            }

            const isForce = action === 'force' || option === 'force';

            if (action === 'yes' || action === 'confirm' || action === 'force') {
                if (isForce) {
                    await sock.sendMessage(jid, { text: "⏳ *Force-pulling updates from upstream... Please wait.*" }, { quoted: msg });
                    exec('git fetch --all && git reset --hard origin/master', async (err, stdout, stderr) => {
                        if (err) {
                            return await sock.sendMessage(jid, {
                                text: `❌ *Force Update Failed!*\n\n\`${err.message}\``
                            }, { quoted: msg });
                        }
                        await sock.sendMessage(jid, {
                            text: `✅ *Force Update Successful!*\n\n${stdout || 'Sync complete.'}\n\n🔄 _Restarting system..._`
                        }, { quoted: msg });
                        setTimeout(() => process.exit(1), 3000);
                    });
                } else {
                    await sock.sendMessage(jid, { text: "⏳ *Channelling dynamic updates from upstream... Please wait.*" }, { quoted: msg });
                    exec('git pull', async (err, stdout, stderr) => {
                        if (err) {
                            return await sock.sendMessage(jid, {
                                text: `❌ *Update Failed!*\n\n\`${err.message}\`\n\n💡 _If your uncommitted manual edits are preventing the update, run:_\n\`${config.prefix}update force\``
                            }, { quoted: msg });
                        }
                        await sock.sendMessage(jid, {
                            text: `✅ *Update Successful!*\n\n${stdout}\n\n🔄 _Restarting system..._`
                        }, { quoted: msg });
                        setTimeout(() => process.exit(1), 3000);
                    });
                }
                return;
            }

            if (action === 'no' || action === 'cancel') {
                return await sock.sendMessage(jid, { text: "🔮 *Process aborted.* Infinite Void update cancelled." }, { quoted: msg });
            }

            await sock.sendMessage(jid, { text: "🔍 *Checking for system updates...*" }, { quoted: msg });
            exec('git fetch && git status -uno', async (err, stdout, stderr) => {
                if (err) {
                    return await sock.sendMessage(jid, {
                        text: `❌ *Error accessing source code:*\n\`${err.message}\`\n\n💡 _If Git tracking is not set up, run:_\n\`${config.prefix}update setup\``
                    }, { quoted: msg });
                }
                const isBehind = stdout.includes('behind') || stdout.includes('can be fast-forwarded');
                if (isBehind) {
                    const promptText = `👁️ *My six eyes perceive an update.*\n\nWanna check it out?`;
                    const buttonMessage = {
                        text: promptText,
                        buttons: [
                            { buttonId: `${config.prefix}update yes`, buttonText: { displayText: 'Yes' }, type: 1 },
                            { buttonId: `${config.prefix}update no`, buttonText: { displayText: 'No' }, type: 1 }
                        ],
                        headerType: 1
                    };
                    try {
                        await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                    } catch (buttonError) {
                        await sock.sendMessage(jid, {
                            text: `${promptText}\n\n_Reply with *${config.prefix}update yes* to apply._\n_Reply with *${config.prefix}update no* to cancel._\n_Reply with *${config.prefix}update force* to force-overwrite uncommitted changes._`
                        }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, {
                        text: "❄️ *There's no Update available at the moment.*"
                    }, { quoted: msg });
                }
            });
        }
    },

    // 3. MODE (Public/Private)
    {
        name: 'mode',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            if (!args) {
                return await sock.sendMessage(jid, {
                    text: `💻 *Current Bot Mode:* ${config.isPublic ? 'Public 🌐' : 'Private 🛡️'}\n\n` +
                          `Use \`${config.prefix}mode public\` or \`${config.prefix}mode private\` to change it.`
                }, { quoted: msg });
            }

            const targetMode = args.toLowerCase().trim();
            if (targetMode === 'public') {
                config.isPublic = true;
                await sock.sendMessage(jid, { text: `🌐 *Limitless Mode Updated:* Public\n_Everyone can now interact._` }, { quoted: msg });
            } else if (targetMode === 'private') {
                config.isPublic = false;
                await sock.sendMessage(jid, { text: `🛡️ *Limitless Mode Updated:* Private\n_Only authorized owners and sudoers can interact._` }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: `❌ Invalid option. Use \`public\` or \`private\`.` }, { quoted: msg });
            }
            saveState();
        }
    },

    // 4. SETSUDO
    {
        name: 'setsudo',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            const targetJid = parseTarget(msg, args);
            if (!targetJid) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a message, mention the user (@user), or type their number." }, { quoted: msg });
            }

            const added = addSudo(targetJid);
            if (added) {
                await sock.sendMessage(jid, {
                    text: `👑 Added @${targetJid.split('@')[0]} to the sudo list.\n_They can now use the bot in Private mode._`,
                    mentions: [targetJid]
                }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, {
                    text: `⚠️ @${targetJid.split('@')[0]} is already a sudo user.`,
                    mentions: [targetJid]
                }, { quoted: msg });
            }
        }
    },

    // 5. DELSUDO
    {
        name: 'delsudo',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            const targetJid = parseTarget(msg, args);
            if (!targetJid) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a message, mention the user, or type their number." }, { quoted: msg });
            }

            const removed = removeSudo(targetJid);
            if (removed) {
                await sock.sendMessage(jid, {
                    text: `👋 Removed @${targetJid.split('@')[0]} from the sudo list.`,
                    mentions: [targetJid]
                }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, {
                    text: `⚠️ @${targetJid.split('@')[0]} is not in the sudo list.`,
                    mentions: [targetJid]
                }, { quoted: msg });
            }
        }
    },

    // 6. ADDOWNER
    {
        name: 'addowner',
        isPrefixless: false,
        execute: async (sock, msg, args, { isDev, isPrimaryOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isDev && !isPrimaryOwner) return;

            const targetJid = parseTarget(msg, args);
            if (!targetJid) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a message, mention the user, or type their number." }, { quoted: msg });
            }

            // Prevent adding Devs
            if (DEV_JIDS.includes(targetJid) || DEV_LIDS.includes(targetJid)) {
                await sock.sendMessage(jid, { text: '❌ Cannot add a Developer as a secondary owner.' });
                return;
            }

            // Prevent adding Primary Owner
            if (targetJid === config.ownerJid || targetJid === config.ownerLid) {
                await sock.sendMessage(jid, { text: '❌ Cannot add the primary owner as a secondary owner.' });
                return;
            }

            const added = addSecondaryOwner(targetJid);
            if (added) {
                await sock.sendMessage(jid, {
                    text: `👑 Added @${targetJid.split('@')[0]} as a secondary owner.\n_They now possess full system administrative capabilities._`,
                    mentions: [targetJid]
                }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, {
                    text: `⚠️ @${targetJid.split('@')[0]} is already a secondary owner.`,
                    mentions: [targetJid]
                }, { quoted: msg });
            }
        }
    },

    // 7. DELOWNER
    {
        name: 'delowner',
        isPrefixless: false,
        execute: async (sock, msg, args, { isDev, isPrimaryOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isDev && !isPrimaryOwner) return;

            const targetJid = parseTarget(msg, args);
            if (!targetJid) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a message, mention the user, or type their number." }, { quoted: msg });
            }

            if (targetJid === config.ownerJid || targetJid === config.ownerLid) {
                return await sock.sendMessage(jid, { text: "❌ You cannot remove the primary Bot Owner." }, { quoted: msg });
            }

            const removed = removeSecondaryOwner(targetJid);
            if (removed) {
                await sock.sendMessage(jid, {
                    text: `👋 Removed @${targetJid.split('@')[0]} from the secondary owners list.`,
                    mentions: [targetJid]
                }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, {
                    text: `⚠️ @${targetJid.split('@')[0]} is not a registered secondary owner.`,
                    mentions: [targetJid]
                }, { quoted: msg });
            }
        }
    },

    // 8. RESTART
    {
        name: 'restart',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;
            await sock.sendMessage(jid, { text: "🔄 _Rebooting Satoru Gojo's visual and physical engines..._" }, { quoted: msg });
            process.exit(1);
        }
    },

    // 9. SHUTDOWN
    {
        name: 'shutdown',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;
            await sock.sendMessage(jid, { text: "💤 _Deactivating Infinite Void. System shutting down..._" }, { quoted: msg });
            process.exit(0);
        }
    },

    // 10. BAN
    {
        name: 'ban',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            const targetJid = parseTarget(msg, args);
            if (!targetJid) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a message, mention the user, or type their number." }, { quoted: msg });
            }

            if (targetJid === config.ownerJid || targetJid === config.ownerLid) {
                return await sock.sendMessage(jid, { text: "❌ You cannot blacklist Satoru Gojo's creator." }, { quoted: msg });
            }

            const added = addBan(targetJid);
            if (added) {
                await sock.sendMessage(jid, {
                    text: `🚫 Blacklisted @${targetJid.split('@')[0]}.\n_They can no longer interact with any Satoru Gojo systems._`,
                    mentions: [targetJid]
                }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, {
                    text: `⚠️ @${targetJid.split('@')[0]} is already blacklisted.`,
                    mentions: [targetJid]
                }, { quoted: msg });
            }
        }
    },

    // 11. UNBAN
    {
        name: 'unban',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            const targetJid = parseTarget(msg, args);
            if (!targetJid) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a message, mention the user, or type their number." }, { quoted: msg });
            }

            const removed = removeBan(targetJid);
            if (removed) {
                await sock.sendMessage(jid, {
                    text: `✅ Restored access for @${targetJid.split('@')[0]}.`,
                    mentions: [targetJid]
                }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, {
                    text: `⚠️ @${targetJid.split('@')[0]} is not on the blacklist.`,
                    mentions: [targetJid]
                }, { quoted: msg });
            }
        }
    },

    // 12. AFK
    {
        name: 'afk',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, senderNumber }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            if (!config.afk) config.afk = {};

            const senderJid = normalizeToJid(msg.key.participant || msg.key.remoteJid || '');
            const isAlreadyAfk = config.afk[senderJid];

            if (isAlreadyAfk) {
                delete config.afk[senderJid];
                await sock.sendMessage(jid, {
                    text: `👋 *Welcome Back!* AFK mode has been deactivated.`
                }, { quoted: msg });
            } else {
                config.afk[senderJid] = {
                    time: Date.now(),
                    reason: args || "Infinite Void meditation"
                };
                await sock.sendMessage(jid, {
                    text: `💤 *AFK Mode Activated.* Mentions of your name in group chats will be auto-replied by my infinity.`
                }, { quoted: msg });
            }
            saveState();
        }
    },

    // 13. SETVAR
    {
        name: 'setvar',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            const eqIndex = args.indexOf('=');
            if (eqIndex === -1) {
                return await sock.sendMessage(jid, {
                    text: `❌ Invalid format.\nUsage: \`${config.prefix}setvar KEY=VALUE\`\nExample: \`${config.prefix}setvar prefix=!\``
                }, { quoted: msg });
            }

            const key = args.slice(0, eqIndex).trim();
            const valueStr = args.slice(eqIndex + 1).trim();

            // ─── KEY MAPPING ──────────────────────────────────────
            const keyMapping = {
                // Environment/Static (can be overridden via setvar)
                bot_name: "botName",
                owner_name: "ownerName",
                owner_number: "ownerNumber",
                session_id: "sessionId",
                git_token: "githubToken",
                groq_api_key: "groqApiKey",
                gemini_api_key: "geminiApiKey",

                // Dynamic (vars.json)
                prefix: "prefix",
                vvs: "vvs",
                pack_name: "packName",
                author: "author",
                menu_image: "menuImage",
                warn: "warnThreshold",
                presence: "presenceMode"
            };

            const mappedKey = keyMapping[key.toLowerCase()];
            if (!mappedKey) {
                return await sock.sendMessage(jid, {
                    text: `❌ Variable "${key}" cannot be configured dynamically.`
                }, { quoted: msg });
            }

            // ─── SPECIAL HANDLING ────────────────────────────────
            let finalValue = valueStr;

            // Boolean handling for isPublic (though it's managed via .mode, keeping for safety)
            if (mappedKey === 'isPublic') {
                if (valueStr.toLowerCase() === 'true') finalValue = true;
                else if (valueStr.toLowerCase() === 'false') finalValue = false;
                else {
                    return await sock.sendMessage(jid, { text: "❌ isPublic must be either `true` or `false`." }, { quoted: msg });
                }
            }

            // ─── MENU IMAGE: comma-separated URLs ──────────────
            if (mappedKey === 'menuImage') {
                const urls = valueStr.split(',').map(u => u.trim()).filter(Boolean);
                if (urls.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ menu_image requires at least one URL. Use comma-separated values." }, { quoted: msg });
                }
                finalValue = urls;
            }

            // ─── SET THE VARIABLE ────────────────────────────────
            // If it's a dynamic var (in vars.json), use setVar
            const dynamicKeys = ['prefix', 'vvs', 'packName', 'author', 'menuImage', 'warnThreshold', 'presenceMode'];
            if (dynamicKeys.includes(mappedKey)) {
                const success = setVar(mappedKey, finalValue);
                if (!success) {
                    return await sock.sendMessage(jid, { text: `❌ Failed to save variable "${key}".` }, { quoted: msg });
                }
                // Reload commands if prefix changed
                if (mappedKey === 'prefix') {
                    const commandsList = require('../commands');
                    commandsList.reload();
                }
                await sock.sendMessage(jid, {
                    text: `✅ *Variable Configured Successfully!*\n\n` +
                          `• *Key:* \`${mappedKey}\`\n` +
                          `• *Value:* \`${Array.isArray(finalValue) ? finalValue.join(', ') : finalValue}\`\n\n` +
                          `_Value has been persisted to vars.json and applied instantly._`
                }, { quoted: msg });
            } else {
                // Environment/static vars: update config directly and save to .env? We'll just update config.
                config[mappedKey] = finalValue;
                // Try to also update .env? That's risky. We'll just log.
                console.log(`[SETVAR] Updated ${mappedKey} to ${finalValue} (in-memory only, restart will revert unless .env is updated manually)`);
                await sock.sendMessage(jid, {
                    text: `✅ *${mappedKey} updated to:* \`${finalValue}\`\n\n` +
                          `⚠️ *Note:* This variable is from .env. To make it permanent, edit your .env file manually.\n` +
                          `_The change is active until the next restart._`
                }, { quoted: msg });
            }
        }
    },

    // 14. SETTINGS
    {
        name: 'settings',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            const ownersList = (config.secondaryOwners || []).length > 0 ?
                config.secondaryOwners.map(n => `@${n.split('@')[0]}`).join(', ') : '_None_';
            const sudoList = (config.sudos || []).length > 0 ?
                config.sudos.map(n => `@${n.split('@')[0]}`).join(', ') : '_None_';
            const bannedList = (config.banned || []).length > 0 ?
                config.banned.map(n => `@${n.split('@')[0]}`).join(', ') : '_None_';

            const antilinkCount = Object.keys(config.antilink || {}).filter(k => config.antilink[k] !== 'off').length;
            const antitagCount = Object.keys(config.antitag || {}).filter(k => config.antitag[k] !== 'off').length;
            const antibotCount = Object.keys(config.antibot || {}).filter(k => config.antibot[k] !== 'off').length;

            const settingsText =
                `💻 *${config.botName.toUpperCase()} SYSTEM SETTINGS* 💻\n` +
                `━━━━━━━━━━━━━━━━━━━\n\n` +
                `🤖 *Bot Name:* \`${config.botName}\`\n` +
                `👑 *Owner:* \`${config.ownerName}\`\n` +
                `⚡ *Prefix:* \`${config.prefix || '(prefixless)'}\`\n` +
                `🌐 *Mode:* \`${config.isPublic ? 'Public' : 'Private'}\`\n` +
                `📱 *Owner Number:* \`${config.ownerNumber}\`\n\n` +
                `📦 *Sticker Pack:* \`${config.packName}\`\n` +
                `🎨 *Sticker Author:* \`${config.author}\`\n` +
                `🔮 *VVS Trigger:* \`${config.vvs || 'kamui'}\`\n` +
                `⚠️ *Warn Threshold:* \`${config.warnThreshold || 5}\`\n\n` +
                `👥 *Secondary Owners:* ${ownersList}\n` +
                `🛡️ *Sudos:* ${sudoList}\n` +
                `🚫 *Banned:* ${bannedList}\n\n` +
                `🛡️ *Active Protections:*\n` +
                `• *Antilink:* \`${antilinkCount}\` groups\n` +
                `• *Antitag:* \`${antitagCount}\` groups\n` +
                `• *Antibot:* \`${antibotCount}\` groups\n\n` +
                `🧠 *Gojo Sleep:* \`${config.gojoGlobalSleep ? '💤' : '🟢'}\``;

            const allMentions = [
                ...(config.secondaryOwners || []),
                ...(config.sudos || []),
                ...(config.banned || [])
            ];

            await sock.sendMessage(jid, {
                text: settingsText,
                mentions: allMentions
            }, { quoted: msg });
        }
    },

    // 15. UPGRADE (Dev-only)
    {
        name: 'upgrade',
        isPrefixless: false,
        execute: async (sock, msg, args, { isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isDev) return;

            const GITHUB_TOKEN = config.githubToken;
            if (!GITHUB_TOKEN) {
                return await sock.sendMessage(jid, { text: "❌ GitHub token not configured. Please set GITHUB_TOKEN in .env" }, { quoted: msg });
            }

            const GITHUB_OWNER = "Botking134";
            const GITHUB_REPO = "Limitless-MD";
            const GITHUB_BRANCH = "master";

            const spaceIndex = args ? args.indexOf(' ') : -1;
            if (spaceIndex === -1) {
                return await sock.sendMessage(jid, {
                    text: `❌ Invalid upgrade format.\nUsage: \`${config.prefix}upgrade <file_path> <entire_code>\``
                }, { quoted: msg });
            }

            const relativePathInput = args.slice(0, spaceIndex).trim();
            const fileContent = args.slice(spaceIndex + 1).trim();

            await sock.sendMessage(jid, { text: `📡 *Connecting to source to upgrade master files...*` }, { quoted: msg });

            try {
                const getUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${relativePathInput}?ref=${GITHUB_BRANCH}`;
                let currentSha = null;

                const getResponse = await fetch(getUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2022-11-28'
                    }
                });

                if (getResponse.ok) {
                    const fileData = await getResponse.json();
                    currentSha = fileData.sha;
                }

                const base64Content = Buffer.from(fileContent, 'utf-8').toString('base64');

                const putUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${relativePathInput}`;
                const bodyPayload = {
                    message: `Upgrade file: ${relativePathInput}`,
                    content: base64Content,
                    branch: GITHUB_BRANCH
                };

                if (currentSha) {
                    bodyPayload.sha = currentSha;
                }

                const putResponse = await fetch(putUrl, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${GITHUB_TOKEN}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2022-11-28'
                    },
                    body: JSON.stringify(bodyPayload)
                });

                if (!putResponse.ok) {
                    const errorText = await putResponse.text();
                    throw new Error(`GitHub API Error ${putResponse.status}: ${errorText}`);
                }

                const putData = await putResponse.json();

                await sock.sendMessage(jid, {
                    text: `✅ *Master Files Upgraded!*\n\n` +
                          `• *Branch:* \`${GITHUB_BRANCH}\`\n` +
                          `• *Path:* \`${relativePathInput}\`\n` +
                          `• *Commit SHA:* \`${putData.commit?.sha?.slice(0, 7) || 'N/A'}\`\n` +
                          `• *Status:* Pushed directly to source successfully! 🚀`
                }, { quoted: msg });

            } catch (error) {
                console.error("Upgrade Command Error:", error);
                await sock.sendMessage(jid, { text: `❌ Upgrade failed: ${error.message}` }, { quoted: msg });
            }
        }
    },

    // 16. ANTIPM
    {
        name: 'antipm',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            if (!args) {
                const current = config.antipm || 'off';
                return await sock.sendMessage(jid, {
                    text: `💻 *Anti-PM Protection status:* \`${current.toUpperCase()}\`\n\nUse \`${config.prefix}antipm on\` or \`off\` to configure.`
                }, { quoted: msg });
            }

            const mode = args.toLowerCase().trim();
            if (mode === 'on') {
                config.antipm = 'on';
                await sock.sendMessage(jid, { text: "🔒 *Anti-PM Autoblocker activated!* Non-owners sending direct messages to the bot number will be blocked instantly." }, { quoted: msg });
            } else if (mode === 'off') {
                config.antipm = 'off';
                await sock.sendMessage(jid, { text: "🔓 *Anti-PM Autoblocker deactivated completely.*" }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: "❌ Invalid option. Use `on` or `off`." }, { quoted: msg });
            }
            saveState();
        }
    },

    // 17. REMINDER
    {
        name: 'reminder',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            if (!args) {
                return await sock.sendMessage(jid, {
                    text: `❌ Please provide a timer and the reminder text.\nExample: \`${config.prefix}reminder 10m study Jujutsu history\``
                }, { quoted: msg });
            }

            global.activeSock = sock;

            const parts = args.trim().split(' ');
            const durationString = parts[0] || '';
            const textContent = parts.slice(1).join(' ').trim();

            const durationMs = parseDuration(durationString);
            if (!durationMs) {
                return await sock.sendMessage(jid, { text: "❌ Invalid duration parameter. Use formats like `10s`, `5m`, `2h`." }, { quoted: msg });
            }

            if (!textContent) {
                return await sock.sendMessage(jid, { text: "❌ Please provide a text description for your reminder." }, { quoted: msg });
            }

            try {
                const prompt = await sock.sendMessage(jid, {
                    text: `⏳ *Reminder Scheduled!*\n\n• *Duration:* \`${durationString}\`\n• *Note:* _"${textContent}"_\n\n⚠️ *Action Required:* Please reply directly to *this message* with a short *Title* to complete the setup.`
                }, { quoted: msg });

                global.reminderSessions[prompt.key.id] = {
                    jid: jid,
                    durationMs: durationMs,
                    durationStr: durationString,
                    text: textContent,
                    timeSet: Date.now()
                };
            } catch (err) {
                console.error("Reminder setup error:", err.message);
            }
        }
    },

    // 18. REMIND (List/Cancel)
    {
        name: 'remind',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            global.activeSock = sock;
            const reminders = readReminders();

            if (args && args.toLowerCase().trim().startsWith('abort')) {
                const idx = parseInt(args.toLowerCase().replace('abort', '').trim());
                if (isNaN(idx) || idx < 1 || idx > reminders.length) {
                    return await sock.sendMessage(jid, {
                        text: `❌ Invalid selection index. Please enter a number between 1 and ${reminders.length}.`
                    }, { quoted: msg });
                }
                const removed = reminders[idx - 1];
                reminders.splice(idx - 1, 1);
                saveReminders(reminders);
                return await sock.sendMessage(jid, {
                    text: `✅ *Reminder Successfully Cancelled!*\n\n• *Title:* *${removed.title}*\n• *Remaining:* Aborted.`
                }, { quoted: msg });
            }

            if (args && args.toLowerCase().trim() === 'cancel') {
                if (reminders.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ No active reminders available to cancel." }, { quoted: msg });
                }

                let cancelMenu = `❌ *CANCEL REMINDER PANEL* ❌\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                reminders.forEach((r, idx) => {
                    const remainingMs = Math.max(0, r.triggerTime - Date.now());
                    const remainingStr = formatUptime(Math.floor(remainingMs / 1000));
                    cancelMenu += `${idx + 1}. *${r.title}* (${remainingStr} left)\n`;
                });
                cancelMenu += `\n💡 *Action Required:* Reply to this message with the *number* of the reminder you want to abort.`;

                const cancelPrompt = await sock.sendMessage(jid, { text: cancelMenu }, { quoted: msg });
                global.cancelSessions[cancelPrompt.key.id] = true;
                return;
            }

            if (reminders.length === 0) {
                return await sock.sendMessage(jid, { text: "📋 *No active reminders scheduled.*" }, { quoted: msg });
            }

            let dashboard = `📋 *ACTIVE REMINDERS SCHEDULED* 📋\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                            `Total Reminders Active: \`${reminders.length}\`\n\n`;

            reminders.forEach((r, idx) => {
                const remainingMs = Math.max(0, r.triggerTime - Date.now());
                const remainingStr = formatUptime(Math.floor(remainingMs / 1000));
                const formattedTime = new Date(r.timeSet).toLocaleTimeString('en-US', {
                    timeZone: 'Africa/Lagos',
                    hour12: true
                });

                dashboard += `${idx + 1}. *${r.title}*\n`;
                dashboard += `   • *Note:* _"${r.text}"_\n`;
                dashboard += `   • *Set At:* \`${formattedTime} WAT\`\n`;
                dashboard += `   • *Remaining:* \`${remainingStr}\` (set for ${r.durationStr})\n\n`;
            });

            const buttonMessage = {
                text: dashboard,
                buttons: [
                    { buttonId: `${config.prefix}remind cancel`, buttonText: { displayText: 'Cancel Reminder ❌' }, type: 1 }
                ],
                headerType: 1
            };

            try {
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (err) {
                const fallbackText = `${dashboard}\n💡 _Use \`${config.prefix}remind cancel\` to show the cancellation dashboard._`;
                await sock.sendMessage(jid, { text: fallbackText }, { quoted: msg });
            }
        }
    },

    // 19. GAMES (List active games)
    {
        name: 'games',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            const tttCount = Object.keys(global.gameSessions || {}).filter(k => k.endsWith('_ttt')).length;
            const guessCount = Object.keys(global.gameSessions || {}).filter(k => k.endsWith('_guess')).length;
            const v8Count = Object.keys(global.vault8Sessions || {}).length;
            const triviaCount = Object.keys(global.triviaSessions || {}).length;
            const charadeCount = Object.keys(global.charadeSessions || {}).length;
            const anagramCount = Object.keys(global.anagramSessions || {}).length;
            const wcgCount = Object.keys(global.wcgSessions || {}).length;
            const millionaireCount = Object.keys(global.millionaireSessions || {}).length;
            const torfCount = Object.keys(global.torfSessions || {}).length;
            const pvpCount = Object.keys(global.pvpSessions || {}).length;
            const escapeCount = Object.keys(global.escapeSessions || {}).length;

            const totalActive = tttCount + guessCount + v8Count + triviaCount + charadeCount + anagramCount + wcgCount + millionaireCount + torfCount + pvpCount + escapeCount;

            const summary =
                `🎮 *LIMITLESS ACTIVE GAMES REGISTER* 🎮\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `• *Tic-Tac-Toe:* \`${tttCount}\` active\n` +
                `• *Cursed Energy Guessing:* \`${guessCount}\` active\n` +
                `• *The Vault 8 RPG:* \`${v8Count}\` active\n` +
                `• *Trivia Quizzes:* \`${triviaCount}\` active\n` +
                `• *Emoji Charades:* \`${charadeCount}\` active\n` +
                `• *Anagram Scrambles:* \`${anagramCount}\` active\n` +
                `• *Word Chain Game:* \`${wcgCount}\` active\n` +
                `• *Who Wants to Be a Millionaire:* \`${millionaireCount}\` active\n` +
                `• *Truth or False:* \`${torfCount}\` active\n` +
                `• *PVP Lore Battles:* \`${pvpCount}\` active\n` +
                `• *Escape Rooms:* \`${escapeCount}\` active\n\n` +
                `📈 *Total Running Instances:* \`${totalActive}\` game(s)\n\n` +
                `👉 _Click the button below to force-terminate all running game instances instantly._`;

            const buttons = {
                text: summary,
                buttons: [
                    { buttonId: `${config.prefix}games_closeall`, buttonText: { displayText: 'Terminate All Games 🛑' }, type: 1 }
                ],
                headerType: 1
            };

            await sock.sendMessage(jid, buttons, { quoted: msg });
        }
    },

    // 20. GAMES_CLOSEALL
    {
        name: 'games_closeall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            // Clear all active game sessions
            global.gameSessions = {};
            global.vault8Sessions = {};
            global.vault8SavedStories = {};
            global.triviaSessions = {};
            global.charadeSessions = {};
            global.anagramSessions = {};
            global.wcgSessions = {};
            global.millionaireSessions = {};
            global.torfSessions = {};
            global.pvpSessions = {};
            global.escapeSessions = {};

            await sock.sendMessage(jid, { text: "🛑 *RECOVERY ACTION COMPLETE: All running games terminated.*" }, { quoted: msg });
        }
    },

    // 21. OWNER (List owners)
    {
        name: 'owner',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            const secondaries = config.secondaryOwners || [];
            const sudos = config.sudos || [];

            let list = `👑 *LIMITLESS OWNER & SUDO REGISTER* 👑\n` +
                       `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                       `👤 *Primary Owner JID:*\n` +
                       `• @${config.ownerNumber}\n\n`;

            if (secondaries.length > 0) {
                list += `👑 *Secondary Owners:*\n`;
                secondaries.forEach((num) => {
                    list += `• @${num.split('@')[0]}\n`;
                });
                list += `\n`;
            } else {
                list += `👑 *Secondary Owners:* _None_\n\n`;
            }

            if (sudos.length > 0) {
                list += `🛡️ *Registered Sudoers:*\n`;
                sudos.forEach((num) => {
                    list += `• @${num.split('@')[0]}\n`;
                });
                list += `\n`;
            } else {
                list += `🛡️ *Registered Sudoers:* _None_\n\n`;
            }

            const mentionsList = [
                config.ownerJid,
                ...secondaries,
                ...sudos
            ].filter(Boolean);

            await sock.sendMessage(jid, { text: list, mentions: mentionsList }, { quoted: msg });
        }
    }
];

// ─── ALIASES ──────────────────────────────────────────────────────
// Add aliases for commands that have alternate names.

const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'addowner') {
        aliases.push({ ...cmd, name: 'add-owner' });
    }
    if (cmd.name === 'delowner') {
        aliases.push({ ...cmd, name: 'del-owner' });
    }
    if (cmd.name === 'games') {
        aliases.push({ ...cmd, name: 'activegames' });
    }
});
module.exports.push(...aliases);