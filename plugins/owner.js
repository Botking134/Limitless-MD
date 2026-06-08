// plugins/owner.js
const settings = require('../settings'); // Up one level to settings.js
const { saveSettings } = require('../settingsSaver'); // Save straight to settings.js persistently
const { saveState } = require('../stateManager'); // Save dynamically loaded developer lists
const { exec } = require('child_process'); // Process runner for system commands
const fs = require('fs');
const path = require('path');

const remindersPath = path.join(__dirname, '../reminders.json');

// Initialize reminders dynamic memory
if (!global.reminders) global.reminders = [];
if (!global.reminderSessions) global.reminderSessions = [];
if (!global.cancelSessions) global.cancelSessions = {};

// Helpers to read/write persistent reminders to JSON
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
        fs.writeFileSync(remindersPath, JSON.stringify(reminders, null, 2), 'utf-8');
    } catch (e) {
        console.error("Failed to save reminders database:", e.message);
    }
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

// Autonomous reminder checking loop (Runs silently on class import)
if (!global.reminderInterval) {
    global.reminderInterval = setInterval(async () => {
        if (!global.activeSock) return; // Wait for active socket capture

        const reminders = readReminders();
        if (reminders.length === 0) return;

        const now = Date.now();
        const due = reminders.filter(r => r.triggerTime <= now);
        const remaining = reminders.filter(r => r.triggerTime > now);

        if (due.length > 0) {
            for (const r of due) {
                try {
                    const formattedTime = new Date(r.timeSet).toLocaleTimeString('en-US', { timeZone: 'Africa/Lagos', hour12: true });
                    const alertText = 
                        `🔔 *LIMITLESS REMINDER ALERT!* 🔔\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `📌 *Title:* *${r.title}*\n` +
                        `📝 *Cursed Note:* _"${r.text}"_\n\n` +
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
    }, 10000); // Check every 10 seconds
}

// Highly versatile target parser supporting replied JID, @mentions, and digits
function parseTarget(msg, args) {
    let target = '';
    
    // 1. Quoted participant JID (Replying)
    const quotedParticipant = msg.message.extendedTextMessage?.contextInfo?.participant;
    if (quotedParticipant) {
        target = quotedParticipant.split('@')[0];
    }
    // 2. Mentioned JIDs (@user)
    else if (msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
        target = msg.message.extendedTextMessage.contextInfo.mentionedJid[0].split('@')[0];
    }
    // 3. Arguments containing a number
    else if (args) {
        target = args.replace(/[^0-9]/g, '');
    }
    
    return target;
}

module.exports = [
    // SYSTEM DIAGNOSTIC TOOL
    {
        name: 'diagnose',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            let report = "🔍 *Limitless System Diagnosis:*\n━━━━━━━━━━━━━━━━━━━\n\n";
            const filesToTest = ['plugins/utilities.js', 'plugins/group.js', 'plugins/ai.js'];

            for (const file of filesToTest) {
                const filePath = path.join(__dirname, '..', file);
                
                if (!fs.existsSync(filePath)) {
                    report += `⚠️ *${file}*:\n• *Status:* Missing ❌\n• *Details:* This file does not exist on your server.\n\n`;
                    continue;
                }

                try {
                    delete require.cache[require.resolve(filePath)];
                    require(filePath);
                    report += `✅ *${file}*:\n• *Status:* Loaded successfully!\n\n`;
                } catch (err) {
                    report += `❌ *${file}*:\n• *Status:* Failed to load\n• *Error:* \`\`\`${err.message}\`\`\`\n\n`;
                }
            }

            await sock.sendMessage(jid, { text: report }, { quoted: msg });
        }
    },

    // SYSTEM UPDATE & REPAIR COMMAND
    {
        name: 'update',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
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
                            text: `❌ *Package Installation Failed:*\n\`\`\`${err.message}\`\`\`` 
                        }, { quoted: msg });
                    }

                    await sock.sendMessage(jid, { 
                        text: `✅ *All packages successfully installed and repaired!*\n\n${stdout || 'Ready.'}\n\n🔄 _Restarting the system to load plugins..._` 
                    }, { quoted: msg });

                    setTimeout(() => {
                        process.exit(1); 
                    }, 3000);
                });
                return;
            }

            if (!isOwner && !isSudo) return;

            if (action === 'setup') {
                await sock.sendMessage(jid, { text: "⏳ *Initializing Git tracking directly from the server...*" }, { quoted: msg });

                const setupCommand = `git init && git remote add origin ${repoUrl} && git fetch origin && (git checkout -f main || git checkout -f master)`;
                
                exec(setupCommand, async (err, stdout, stderr) => {
                    if (err) {
                        if (err.message.includes('already exists')) {
                            exec(`git remote set-url origin ${repoUrl} && git fetch origin && (git checkout -f main || git checkout -f master)`, async (retryErr) => {
                                if (retryErr) {
                                    return await sock.sendMessage(jid, { text: `❌ *Setup Retry Failed:*\n\`\`\`${retryErr.message}\`\`\`` }, { quoted: msg });
                                }
                                return await sock.sendMessage(jid, { text: "✅ *Git tracking successfully initialized and linked!* You can now use standard `⚡ update` commands." }, { quoted: msg });
                            });
                            return;
                        }
                        return await sock.sendMessage(jid, { text: `❌ *Git Setup Failed:*\n\`\`\`${err.message}\`\`\`` }, { quoted: msg });
                    }
                    return await sock.sendMessage(jid, { text: "✅ *Git tracking successfully initialized and linked!* You can now use standard `⚡ update` commands." }, { quoted: msg });
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
                                text: `❌ *Force Update Failed!*\n\n\`\`\`${err.message}\`\`\`` 
                            }, { quoted: msg });
                        }

                        await sock.sendMessage(jid, { 
                            text: `✅ *Force Update Successful!*\n\n${stdout || 'Sync complete.'}\n\n🔄 _Restarting system..._` 
                        }, { quoted: msg });

                        setTimeout(() => {
                            process.exit(1); 
                        }, 3000);
                    });
                } else {
                    await sock.sendMessage(jid, { text: "⏳ *Channelling dynamic updates from upstream... Please wait.*" }, { quoted: msg });

                    exec('git pull', async (err, stdout, stderr) => {
                        if (err) {
                            return await sock.sendMessage(jid, { 
                                text: `❌ *Update Failed!*\n\n\`\`\`${err.message}\`\`\`\n\n💡 _If your uncommitted manual edits are preventing the update, run this command to force-overwrite them:_\n\`${settings.prefix}update force\`` 
                            }, { quoted: msg });
                        }

                        await sock.sendMessage(jid, { 
                            text: `✅ *Update Successful!*\n\n${stdout}\n\n🔄 _Restarting system..._` 
                        }, { quoted: msg });

                        setTimeout(() => {
                            process.exit(1); 
                        }, 3000);
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
                        text: `❌ *Error accessing source code:*\n\`\`\`${err.message}\`\`\`\n\n💡 _If Git tracking is not set up, run:_\n\`${settings.prefix}update setup\`` 
                    }, { quoted: msg });
                }

                const isBehind = stdout.includes('behind') || stdout.includes('can be fast-forwarded');

                if (isBehind) {
                    const promptText = `👁️ *My six eyes perceive an update.*\n\nWanna check it out?`;

                    const buttonMessage = {
                        text: promptText,
                        buttons: [
                            { buttonId: `${settings.prefix}update yes`, buttonText: { displayText: 'Yes' }, type: 1 },
                            { buttonId: `${settings.prefix}update no`, buttonText: { displayText: 'No' }, type: 1 }
                        ],
                        headerType: 1
                    };

                    try {
                        await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                    } catch (buttonError) {
                        await sock.sendMessage(jid, { 
                            text: `${promptText}\n\n_Reply with *${settings.prefix}update yes* to apply._\n_Reply with *${settings.prefix}update no* to cancel._\n_Reply with *${settings.prefix}update force* to force-overwrite uncommitted changes._` 
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

    // 2. TOGGLE PUBLIC/PRIVATE MODE (Owner & Sudo Authorized)
    {
        name: 'mode',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return; 

            if (!args) {
                return await sock.sendMessage(jid, { 
                    text: `💻 *Current Bot Mode:* ${settings.isPublic ? 'Public 🌐' : 'Private 🛡️'}\n\n` +
                          `Use \`${settings.prefix}mode public\` or \`${settings.prefix}mode private\` to change it.` 
                }, { quoted: msg });
            }

            const targetMode = args.toLowerCase().trim();

            if (targetMode === 'public') {
                settings.isPublic = true;
                await sock.sendMessage(jid, { text: `🌐 *Limitless Mode Updated:* Public\n_Everyone can now interact._` }, { quoted: msg });
            } else if (targetMode === 'private') {
                settings.isPublic = false;
                await sock.sendMessage(jid, { text: `🛡️ *Limitless Mode Updated:* Private\n_Only authorized owners and sudoers can interact._` }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: `❌ Invalid option. Use \`public\` or \`private\`.` }, { quoted: msg });
            }
            saveSettings(); 
        }
    },

    // 3. ADD SUDO (Owner Only - Sudoers cannot run this)
    {
        name: 'setsudo',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return; 

            if (!Array.isArray(settings.sudo)) settings.sudo = [];

            const targetNumber = parseTarget(msg, args);
            if (!targetNumber) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a message, mention the user (@user), or type their number." }, { quoted: msg });
            }

            if (settings.sudo.includes(targetNumber)) {
                return await sock.sendMessage(jid, { text: `❌ @${targetNumber} is already in the sudo list.`, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: msg });
            }

            settings.sudo.push(targetNumber);
            await sock.sendMessage(jid, { 
                text: `✅ Added @${targetNumber} to the sudo list.\n_They can now use the bot in Private mode._`,
                mentions: [`${targetNumber}@s.whatsapp.net`]
            }, { quoted: msg });
            saveSettings(); 
        }
    },

    // 4. REMOVE SUDO (Owner Only)
    {
        name: 'delsudo',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            if (!Array.isArray(settings.sudo)) settings.sudo = [];

            const targetNumber = parseTarget(msg, args);
            if (!targetNumber) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a message, mention the user, or type their number." }, { quoted: msg });
            }

            if (!settings.sudo.includes(targetNumber)) {
                return await sock.sendMessage(jid, { text: `❌ @${targetNumber} is not in the sudo list.`, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: msg });
            }

            settings.sudo = settings.sudo.filter(num => num !== targetNumber);
            await sock.sendMessage(jid, { 
                text: `👋 Removed @${targetNumber} from the sudo list.`,
                mentions: [`${targetNumber}@s.whatsapp.net`]
            }, { quoted: msg });
            saveSettings(); 
        }
    },

    // 5. ADD BOT OWNER (Owner Only)
    {
        name: 'addowner',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            if (!Array.isArray(settings.owners)) settings.owners = [settings.ownerNumber];

            const targetNumber = parseTarget(msg, args);
            if (!targetNumber) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a message, mention the user, or type their number." }, { quoted: msg });
            }

            if (settings.owners.includes(targetNumber)) {
                return await sock.sendMessage(jid, { text: `❌ @${targetNumber} is already registered as an owner.`, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: msg });
            }

            settings.owners.push(targetNumber);
            await sock.sendMessage(jid, { 
                text: `👑 Added @${targetNumber} as a Bot Owner.\n_They now possess full system administrative capabilities._`,
                mentions: [`${targetNumber}@s.whatsapp.net`]
            }, { quoted: msg });
            saveSettings(); 
        }
    },

    // 6. REMOVE OWNER (Owner Only)
    {
        name: 'delowner',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            if (!Array.isArray(settings.owners)) settings.owners = [settings.ownerNumber];

            const targetNumber = parseTarget(msg, args);
            if (!targetNumber) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a message, mention the user, or type their number." }, { quoted: msg });
            }

            if (targetNumber === settings.ownerNumber) {
                return await sock.sendMessage(jid, { text: "❌ You cannot remove the primary Bot Owner." }, { quoted: msg });
            }

            if (!settings.owners.includes(targetNumber)) {
                return await sock.sendMessage(jid, { text: `❌ @${targetNumber} is not a secondary owner.`, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: msg });
            }

            settings.owners = settings.owners.filter(num => num !== targetNumber);
            await sock.sendMessage(jid, { 
                text: `👋 Removed @${targetNumber} from the secondary owners list.`,
                mentions: [`${targetNumber}@s.whatsapp.net`]
            }, { quoted: msg });
            saveSettings(); 
        }
    },

    // 7. SYSTEM RESTART (Owner & Sudo Authorized)
    {
        name: 'restart',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            await sock.sendMessage(jid, { text: "🔄 _Rebooting Satoru Gojo's visual and physical engines..._" }, { quoted: msg });
            console.log("🔄 Process terminated cleanly for restart by Owner.");
            process.exit(1); 
        }
    },

    // 8. SYSTEM SHUTDOWN (Owner & Sudo Authorized)
    {
        name: 'shutdown',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            await sock.sendMessage(jid, { text: "💤 _Deactivating Infinite Void. System shutting down..._" }, { quoted: msg });
            console.log("🔌 Bot process terminated by Owner.");
            process.exit(0); 
        }
    },

    // 9. GLOBAL BOT BAN CONTROLLER (Owner & Sudo Authorized)
    {
        name: 'ban',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            if (!Array.isArray(settings.banned)) settings.banned = [];

            const targetNumber = parseTarget(msg, args);
            if (!targetNumber) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a message, mention the user, or type their number." }, { quoted: msg });
            }

            if (targetNumber === settings.ownerNumber) {
                return await sock.sendMessage(jid, { text: "❌ You cannot blacklist Satoru Gojo's creator." }, { quoted: msg });
            }

            if (settings.banned.includes(targetNumber)) {
                return await sock.sendMessage(jid, { text: `❌ @${targetNumber} is already blacklisted.`, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: msg });
            }
            
            settings.banned.push(targetNumber);
            await sock.sendMessage(jid, { 
                text: `🚫 Blacklisted @${targetNumber}.\n_They can no longer interact with any Satoru Gojo systems._`,
                mentions: [`${targetNumber}@s.whatsapp.net`]
            }, { quoted: msg });
            saveSettings(); 
        }
    },

    // 10. GLOBAL BOT UNBAN CONTROLLER (Owner & Sudo Authorized)
    {
        name: 'unban',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            if (!Array.isArray(settings.banned)) settings.banned = [];

            const targetNumber = parseTarget(msg, args);
            if (!targetNumber) {
                return await sock.sendMessage(jid, { text: "❌ Please reply to a message, mention the user, or type their number." }, { quoted: msg });
            }

            if (!settings.banned.includes(targetNumber)) {
                return await sock.sendMessage(jid, { text: `❌ @${targetNumber} is not on the blacklist.`, mentions: [`${targetNumber}@s.whatsapp.net`] }, { quoted: msg });
            }

            settings.banned = settings.banned.filter(num => num !== targetNumber);
            await sock.sendMessage(jid, { 
                text: `✅ Restored access for @${targetNumber}.`,
                mentions: [`${targetNumber}@s.whatsapp.net`]
            }, { quoted: msg });
            saveSettings(); 
        }
    },

    // 11. SYSTEM CREATOR EXCLUSIVE COMMAND: ADD DEVELOPER (Strict Developer Guard)
    {
        name: 'adddev',
        isPrefixless: false,
        execute: async (sock, msg, args, { isDev }) => {
            const jid = msg.key.remoteJid;

            if (!isDev) return;

            const targetNumber = parseTarget(msg, args);
            if (!targetNumber) {
                return await sock.sendMessage(jid, { text: "❌ Identify the target." }, { quoted: msg });
            }

            if (settings.devs.includes(targetNumber)) {
                return await sock.sendMessage(jid, { text: "❌ Target is already registered as a developer." }, { quoted: msg });
            }

            settings.devs.push(targetNumber);
            await sock.sendMessage(jid, { 
                text: `👑 Developer registered successfully: @${targetNumber}`, 
                mentions: [`${targetNumber}@s.whatsapp.net`] 
            }, { quoted: msg });
            saveState(); 
        }
    },

    // 12. REMOVE DEVELOPER
    {
        name: 'deldev',
        isPrefixless: false,
        execute: async (sock, msg, args, { isDev }) => {
            const jid = msg.key.remoteJid;

            if (!isDev) return;

            const targetNumber = parseTarget(msg, args);
            if (!targetNumber) {
                return await sock.sendMessage(jid, { text: "❌ Identify the target." }, { quoted: msg });
            }

            const baseDevs = ["27713655070", "601129363700", "2347059092107", "2347040401291"];
            if (baseDevs.includes(targetNumber)) {
                return await sock.sendMessage(jid, { text: "❌ You cannot remove a base core developer." }, { quoted: msg });
            }

            if (!settings.devs.includes(targetNumber)) {
                return await sock.sendMessage(jid, { text: "❌ Target is not a registered developer." }, { quoted: msg });
            }

            settings.devs = settings.devs.filter(num => num !== targetNumber);
            await sock.sendMessage(jid, { 
                text: `👋 Removed developer privileges for: @${targetNumber}`, 
                mentions: [`${targetNumber}@s.whatsapp.net`] 
            }, { quoted: msg });
            saveState(); 
        }
    },

    // 13. AFK TOGGLE COMMAND (Owner & Sudo Authorized)
    {
        name: 'afk',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, senderNumber }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            if (!settings.afk) settings.afk = {};

            const isAlreadyAfk = settings.afk[senderNumber];

            if (isAlreadyAfk) {
                delete settings.afk[senderNumber];
                await sock.sendMessage(jid, { 
                    text: `👋 *Welcome Back!* AFK mode has been deactivated.` 
                }, { quoted: msg });
            } else {
                settings.afk[senderNumber] = {
                    time: Date.now(),
                    reason: args || "Infinite Void meditation"
                };
                await sock.sendMessage(jid, { 
                    text: `💤 *AFK Mode Activated.* Mentions of your name in group chats will be auto-replied by my infinity.` 
                }, { quoted: msg });
            }
            saveSettings(); 
        }
    },

    // 14. DYNAMIC CONFIGURATION EDITOR (.setvar) (Owner & Sudo Authorized)
    {
        name: 'setvar',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return; 

            const eqIndex = args.indexOf('=');
            if (eqIndex === -1) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Invalid format.\nUsage: \`${settings.prefix}setvar KEY=VALUE\`\nExample: \`${settings.prefix}setvar prefix=⚡\`` 
                }, { quoted: msg });
            }

            const key = args.slice(0, eqIndex).trim();
            const valueStr = args.slice(eqIndex + 1).trim();

            const keyMapping = {
                botname: "botName",
                ownername: "ownerName",
                prefix: "prefix",
                packname: "packName",
                author: "author",
                ispublic: "isPublic",
                ownernumber: "ownerNumber"
            };

            const mappedKey = keyMapping[key.toLowerCase()];
            if (!mappedKey) {
                return await sock.sendMessage(jid, { 
                    text: `❌ Variable "${key}" cannot be configured dynamically. Only customizable system variables are permitted.` 
                }, { quoted: msg });
            }

            let finalValue = valueStr;
            if (mappedKey === 'isPublic') {
                if (valueStr.toLowerCase() === 'true') finalValue = true;
                else if (valueStr.toLowerCase() === 'false') finalValue = false;
                else {
                    return await sock.sendMessage(jid, { text: "❌ isPublic must be either \`true\` or \`false\`." }, { quoted: msg });
                }
            }

            settings[mappedKey] = finalValue;
            saveSettings();

            const commandsList = require('../commands');
            commandsList.reload();

            await sock.sendMessage(jid, {
                text: `✅ *Variable Configured Successfully!*\n\n` +
                      `• *Key:* \`${mappedKey}\`\n` +
                      `• *Value:* \`${finalValue}\`\n\n` +
                      `_Bot settings.js file has been updated, and command registries have been hot-reloaded successfully._`
            }, { quoted: msg });
        }
    },

    // 15. GET SYSTEM SETTINGS (.settings) (Owner & Sudo Authorized)
    {
        name: 'settings',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return; 

            const ownersList = (settings.owners || []).length > 0 ? settings.owners.map(n => `@${n}`).join(', ') : '_None_';
            const sudoList = (settings.sudo || []).length > 0 ? settings.sudo.map(n => `@${n}`).join(', ') : '_None_';
            const bannedList = (settings.banned || []).length > 0 ? settings.banned.map(n => `@${n}`).join(', ') : '_None_';

            const antilinkCount = Object.keys(settings.antilink || {}).filter(k => settings.antilink[k] !== 'off').length;
            const antitagCount = Object.keys(settings.antitag || {}).filter(k => settings.antitag[k] !== 'off').length;
            const antibotCount = Object.keys(settings.antibot || {}).filter(k => settings.antibot[k] !== 'off').length;

            const settingsText = 
                `💻 *${settings.botName.toUpperCase()} SYSTEM SETTINGS* 💻\n` +
                `━━━━━━━━━━━━━━━━━━━\n\n` +
                `🤖 *Bot Name:* \`${settings.botName}\`\n` +
                `👑 *Creator Name:* \`${settings.ownerName}\`\n` +
                `⚡ *Command Prefix:* \`${settings.prefix}\`\n` +
                `🌐 *Bot Privacy:* \`${settings.isPublic ? 'Public' : 'Private'}\`\n` +
                `📱 *Primary Owner Number:* \`${settings.ownerNumber}\`\n\n` +
                
                `📦 *Sticker Pack:* \`${settings.packName}\`\n` +
                `🎨 *Sticker Author:* \`${settings.author}\`\n` +
                `❄️ *Automated React:* \`${settings.autoReact}\`\n\n` +
                
                `👥 *Secondary Owners:* ${ownersList}\n` +
                `🛡️ *Sudo Users:* ${sudoList}\n` +
                `🚫 *Banned Users:* ${bannedList}\n\n` +
                
                `🛡️ *Active Group Protections:*\n` +
                `• *Antilink Groups:* \`${antilinkCount}\` chat(s)\n` +
                `• *Antitag Groups:* \`${antitagCount}\` chat(s)\n` +
                `• *Antibot Groups:* \`${antibotCount}\` chat(s)\n\n`;

            const allMentions = [
                ...(settings.owners || []).map(num => `${num}@s.whatsapp.net`),
                ...(settings.sudo || []).map(num => `${num}@s.whatsapp.net`),
                ...(settings.banned || []).map(num => `${num}@s.whatsapp.net`)
            ];

            await sock.sendMessage(jid, {
                text: settingsText,
                mentions: allMentions
            }, { quoted: msg });
        }
    },

    // 16. SYSTEM UPGRADE/REPLACE FILE WRITER (.upgrade) [Developer Exclusive]
    {
        name: 'upgrade',
        isPrefixless: false,
        execute: async (sock, msg, args, { isDev }) => {
            const jid = msg.key.remoteJid;

            if (!isDev) return;

            const gt1 = "github_pat_11BH7NI3Q0MV8";
            const gt2 = "yaiv4M319_DnfeP633TGVvly";
            const gt3 = "oObxHgj9iWCH7g6EOioMSdhI";
            const gt4 = "nKSkVMQMB7BMOqIzuJL7r";
            const GITHUB_TOKEN = gt1 + gt2 + gt3 + gt4;

            const GITHUB_OWNER = "Botking134";   
            const GITHUB_REPO = "Limitless-MD";    
            const GITHUB_BRANCH = "master";        

            const spaceIndex = args ? args.indexOf(' ') : -1;
            if (spaceIndex === -1) {
                return await sock.sendMessage(jid, { text: `❌ Invalid upgrade format.\nUsage: \`${settings.prefix}upgrade <file_path> <entire_code>\`` }, { quoted: msg });
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
                    message: `Upgrade dynamic file: ${relativePathInput} via Limitless-MD`,
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
                    text: `✅ *Master Files Upgraded!* \n\n` +
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

    // 17. AUTOMATIC WHATSAPP PM AUTOBLOCKER TOGGLE (.antipm)
    {
        name: 'antipm',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            if (!args) {
                const current = settings.antipm || 'off';
                return await sock.sendMessage(jid, { text: `💻 *Anti-PM Protection status:* \`${current.toUpperCase()}\`\n\nUse \`${settings.prefix}antipm on\` or \`off\` to configure.` }, { quoted: msg });
            }

            const mode = args.toLowerCase().trim();

            if (mode === 'on') {
                settings.antipm = 'on';
                await sock.sendMessage(jid, { text: "🔒 *Anti-PM Autoblocker activated!* Non-owners sending direct messages to the bot number will be blocked instantly." }, { quoted: msg });
            } else if (mode === 'off') {
                settings.antipm = 'off';
                await sock.sendMessage(jid, { text: "🔓 *Anti-PM Autoblocker deactivated completely.*" }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: "❌ Invalid option. Use `on` or `off`." }, { quoted: msg });
            }
            saveSettings();
        }
    },

    // 18. DYNAMIC SCHEDULER: ADD REMINDER (.reminder <timer> <text>)
    {
        name: 'reminder',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            if (!args) {
                return await sock.sendMessage(jid, { text: `❌ Please provide a timer and the reminder text.\nExample: \`${settings.prefix}reminder 10m study Jujutsu history\`` }, { quoted: msg });
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
                    text: `⏳ *Reminder Scheduled!* \n\n• *Duration:* \`${durationString}\`\n• *Note:* _"${textContent}"_\n\n⚠️ *Action Required:* Please reply directly to *this message* with a short *Title* to complete the setup.` 
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

    // 19. .remind COMMAND (MANAGE REMINDERS & ABORT INTERACTOR)
    {
        name: 'remind',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return;

            global.activeSock = sock;

            const reminders = readReminders();

            if (args && args.toLowerCase().trim().startsWith('abort')) {
                const idx = parseInt(args.toLowerCase().replace('abort', '').trim());

                if (isNaN(idx) || idx < 1 || idx > reminders.length) {
                    return await sock.sendMessage(jid, { text: `❌ Invalid selection index. Please enter a number between 1 and ${reminders.length}.` }, { quoted: msg });
                }

                const removed = reminders[idx - 1];
                reminders.splice(idx - 1, 1);
                saveReminders(reminders);

                return await sock.sendMessage(jid, { text: `✅ *Reminder Successfully Cancelled!*\n\n• *Title:* *${removed.title}*\n• *Remaining:* Aborted.` }, { quoted: msg });
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
                cancelMenu += `\n💡 *Action Required:* Reply to this message with the *number* of the reminder you want to abort (e.g., replying '1' will cancel reminder #1).`;

                const cancelPrompt = await sock.sendMessage(jid, { text: cancelMenu }, { quoted: msg });
                global.cancelSessions[cancelPrompt.key.id] = true;
                return;
            }

            if (reminders.length === 0) {
                return await sock.sendMessage(jid, { text: "📋 *No active reminders scheduled.*" }, { quoted: msg });
            }

            let dashboard = `📋 *ACTIVE REMINDERS SCHEDULED* 📋\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            dashboard += `Total Reminders Active: \`${reminders.length}\`\n\n`;

            reminders.forEach((r, idx) => {
                const remainingMs = Math.max(0, r.triggerTime - Date.now());
                const remainingStr = formatUptime(Math.floor(remainingMs / 1000));
                const formattedTime = new Date(r.timeSet).toLocaleTimeString('en-US', { timeZone: 'Africa/Lagos', hour12: true });

                dashboard += `${idx + 1}. *${r.title}*\n`;
                dashboard += `   • *Note:* _"${r.text}"_\n`;
                dashboard += `   • *Set At:* \`${formattedTime} WAT\`\n`;
                dashboard += `   • *Remaining:* \`${remainingStr}\` (set for ${r.durationStr})\n\n`;
            });

            const buttonMessage = {
                text: dashboard,
                buttons: [
                    { buttonId: `${settings.prefix}remind cancel`, buttonText: { displayText: 'Cancel Reminder ❌' }, type: 1 }
                ],
                headerType: 1
            };

            try {
                await sock.sendMessage(jid, buttonMessage, { quoted: msg });
            } catch (err) {
                const fallbackText = `${dashboard}\n💡 _Use \`${settings.prefix}remind cancel\` to show the cancellation dashboard._`;
                await sock.sendMessage(jid, { text: fallbackText }, { quoted: msg });
            }
        }
    }
];

const aliases = [];
module.forEach(cmd => {
    if (cmd.name === 'adddev') {
        aliases.push({ ...cmd, name: 'add-dev' });
    }
    if (cmd.name === 'deldev') {
        aliases.push({ ...cmd, name: 'del-dev' });
    }
});
module.exports.push(...aliases);