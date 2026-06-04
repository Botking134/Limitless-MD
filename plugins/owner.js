// plugins/owner.js
const settings = require('../settings'); // Up one level to settings.js
const { saveSettings } = require('../settingsSaver'); // Save straight to settings.js persistently [1]
const { exec } = require('child_process'); // Process runner for system commands

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
    // 1. SYSTEM UPDATE COMMAND
    {
        name: 'update',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return; // Strict Sudo/Owner Guard

            const parts = args ? args.split(' ') : [];
            const action = parts[0] ? parts[0].toLowerCase().trim() : '';

            // Git Auto-Setup bypass for Spaceify/Pterodactyl
            if (action === 'setup') {
                const repoUrl = parts[1] ? parts[1].trim() : '';
                if (!repoUrl || !repoUrl.startsWith('http')) {
                    return await sock.sendMessage(jid, { 
                        text: `❌ Please provide your GitHub link.\n\nExample:\n\`${settings.prefix}update setup https://github.com/your-username/your-repo-name.git\`` 
                    }, { quoted: msg });
                }

                await sock.sendMessage(jid, { text: "⏳ *Initializing Git and linking your repository directly from the server...*" }, { quoted: msg });

                // Run the initialization chain on the server
                const setupCommand = `git init && git remote add origin ${repoUrl} && git fetch origin && (git checkout -f main || git checkout -f master)`;
                
                exec(setupCommand, async (err, stdout, stderr) => {
                    if (err) {
                        // If origin already exists, re-target it
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

            // Handle confirmation action: Apply the update
            if (action === 'yes' || action === 'confirm') {
                await sock.sendMessage(jid, { text: "⏳ *Channelling dynamic updates from upstream... Please wait.*" }, { quoted: msg });

                exec('git pull', async (err, stdout, stderr) => {
                    if (err) {
                        return await sock.sendMessage(jid, { 
                            text: `❌ *Update Failed!*\n\n\`\`\`${err.message}\`\`\`` 
                        }, { quoted: msg });
                    }

                    await sock.sendMessage(jid, { 
                        text: `✅ *Update Successful!*\n\n${stdout}\n\n🔄 _Restarting system..._` 
                    }, { quoted: msg });

                    setTimeout(() => {
                        process.exit(1); // Panel restarts the process
                    }, 3000);
                });
                return;
            }

            // Handle decline action: Cancel update
            if (action === 'no' || action === 'cancel') {
                return await sock.sendMessage(jid, { text: "🔮 *Process aborted.* Infinite Void update cancelled." }, { quoted: msg });
            }

            // Default Action: Check for updates
            await sock.sendMessage(jid, { text: "🔍 *Checking for system updates...*" }, { quoted: msg });

            exec('git fetch && git status -uno', async (err, stdout, stderr) => {
                if (err) {
                    return await sock.sendMessage(jid, { 
                        text: `❌ *Error accessing repository:*\n\`\`\`${err.message}\`\`\`\n\n💡 _If Git is not set up, run:_\n\`${settings.prefix}update setup <your-github-link>\`` 
                    }, { quoted: msg });
                }

                // If git status output indicates the branch is behind the remote
                const isBehind = stdout.includes('behind') || stdout.includes('can be fast-forwarded');

                if (isBehind) {
                    const promptText = `👁️ *My six eyes perceive an update.*\n\nWanna check it out?\n\n` +
                                       `_Reply with *${settings.prefix}update yes* to apply update._\n` +
                                       `_Reply with *${settings.prefix}update no* to cancel._`;

                    // Prepare interactive button structures
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
                        await sock.sendMessage(jid, { text: promptText }, { quoted: msg });
                    }
                } else {
                    await sock.sendMessage(jid, { 
                        text: "❄️ *There's no Update available at the moment.*" 
                    }, { quoted: msg });
                }
            });
        }
    },

    // 2. TOGGLE PUBLIC/PRIVATE MODE (Owner & Sudo Authorized) [1]
    {
        name: 'mode',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return; // Strict Sudo/Owner Guard

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
            saveSettings(); // Physically rewrites settings.js [1]
        }
    },

    // 3. ADD SUDO (Owner Only - Sudoers cannot run this) [1]
    {
        name: 'setsudo',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return; // Locked strictly to Owners/Devs

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
            saveSettings(); // Syncs to settings.js [1]
        }
    },

    // 4. REMOVE SUDO (Owner Only) [1]
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
            saveSettings(); // Syncs to settings.js [1]
        }
    },

    // 5. ADD BOT OWNER (Owner Only) [1]
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
            saveSettings(); // Syncs to settings.js [1]
        }
    },

    // 6. REMOVE OWNER (Owner Only) [1]
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
            saveSettings(); // Syncs to settings.js [1]
        }
    },

    // 7. SYSTEM RESTART (Owner & Sudo Authorized) [1]
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

    // 8. SYSTEM SHUTDOWN (Owner & Sudo Authorized) [1]
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

    // 9. GLOBAL BOT BAN CONTROLLER (Owner & Sudo Authorized) [1]
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
            saveSettings(); // Syncs to settings.js [1]
        }
    },

    // 10. GLOBAL BOT UNBAN CONTROLLER (Owner & Sudo Authorized) [1]
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
            saveSettings(); // Syncs to settings.js [1]
        }
    },

    // 11. SYSTEM CREATOR EXCLUSIVE COMMAND: ADD DEVELOPER (Strict Developer Guard) [1.1]
    {
        name: 'adddev',
        isPrefixless: false,
        execute: async (sock, msg, args, { isDev }) => {
            const jid = msg.key.remoteJid;

            // Completely private: strictly ignored if called by non-devs [1.1]
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
            saveSettings(); // Syncs to settings.js [1]
        }
    },

    // 12. REMOVE DEVELOPER [1.1]
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

            // Prevent removing base core developers
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
            saveSettings(); // Syncs to settings.js [1]
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
            saveSettings(); // Syncs to settings.js [1]
        }
    },

    // 14. DYNAMIC CONFIGURATION EDITOR (.setvar) (Owner & Sudo Authorized) [1]
    {
        name: 'setvar',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return; // Owner & Sudo Authorized [1]

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
                ownernumber: "ownerNumber",
                geminiapikey: "geminiApiKey"
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

            // Update in-memory configuration
            settings[mappedKey] = finalValue;
            
            // Physically write straight to settings.js persistently [1]
            saveSettings();

            // Rebuild the command registry triggers in real-time [1]
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

    // 15. GET SYSTEM SETTINGS (.settings) (Owner & Sudo Authorized) [1]
    {
        name: 'settings',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo) return; // Strict Sudo/Owner Guard [1]

            // Format dynamic arrays securely with mentions
            const ownersList = (settings.owners || []).length > 0 ? settings.owners.map(n => `@${n}`).join(', ') : '_None_';
            const sudoList = (settings.sudo || []).length > 0 ? settings.sudo.map(n => `@${n}`).join(', ') : '_None_';
            const bannedList = (settings.banned || []).length > 0 ? settings.banned.map(n => `@${n}`).join(', ') : '_None_';

            // Gather active group automation counts [1]
            const antilinkCount = Object.keys(settings.antilink || {}).filter(k => settings.antilink[k] !== 'off').length;
            const antitagCount = Object.keys(settings.antitag || {}).filter(k => settings.antitag[k] !== 'off').length;
            const antibotCount = Object.keys(settings.antibot || {}).filter(k => settings.antibot[k] !== 'off').length;

            const isKeyConfigured = settings.geminiApiKey && settings.geminiApiKey !== "YOUR_GEMINI_API_KEY_HERE" ? "Yes ✅" : "No ❌";

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
                `• *Antibot Groups:* \`${antibotCount}\` chat(s)\n\n` +
                
                `🧠 *Gemini AI Engine Key:* \`${isKeyConfigured}\``;

            // Combine JIDs to render @mentions cleanly inside WhatsApp [1]
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
    }
];

// Add structural aliases manually
module.exports.forEach(cmd => {
    if (cmd.name === 'adddev') {
        module.exports.push({ ...cmd, name: 'add-dev' });
    }
    if (cmd.name === 'deldev') {
        module.exports.push({ ...cmd, name: 'del-dev' });
    }
});
