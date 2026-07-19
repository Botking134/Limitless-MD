// plugins/owner.js
const config = require('../config');
const { DEV_JIDS, DEV_LIDS } = require('../plugins/devs'); // Update import later
const {
    saveState,
    addSecondaryOwner,
    removeSecondaryOwner,
    addSudo,
    removeSudo,
    addBan,
    removeBan
} = require('../stateManager');
const { setVar, loadVars, syncVarsToConfig, DEFAULT_VARS } = require('../vars');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

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

// ─── HELPER: REPOSITORY URL (For Git Updates) ───────────────────
function getRepoUrl() {
    return config.repoUrl || 'https://github.com/itsliaaa/Limitless.git';
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

// ─── SIMPLE EXEC WITH TIMEOUT (for .update) ─────────────────────
function execWithTimeout(cmd, timeoutMs, callback) {
    const child = exec(cmd, (err, stdout, stderr) => {
        if (callback) callback(err, stdout, stderr);
    });
    const timer = setTimeout(() => {
        child.kill();
        if (callback) callback(new Error('Command timed out'), '', '');
    }, timeoutMs);
    child.on('exit', () => clearTimeout(timer));
}

// ─── UPDATE SUCCESS HELPER ─────────────────────────────────────
async function sendUpdateSuccess(jid, sock, stdout, quotedMsg) {
    let summary = stdout || 'Update complete.';
    const changed = summary.match(/(\d+) files changed/);
    const insertions = summary.match(/(\d+) insertions/);
    const deletions = summary.match(/(\d+) deletions/);
    const changes = [];
    if (changed) changes.push(changed[1] + ' files changed');
    if (insertions) changes.push(insertions[1] + ' insertions');
    if (deletions) changes.push(deletions[1] + ' deletions');

    const finalMsg =
        `✅ *Update Successful!*\n\n` +
        `📊 *Summary:* ${changes.join(' • ') || 'No changes detected.'}\n\n` +
        `🔄 *Restarting system to load updates...*`;
    await sock.sendMessage(jid, { text: finalMsg }, { quoted: quotedMsg });
    setTimeout(() => process.exit(1), 3000);
}

// ─── AUTO GIT SETUP ─────────────────────────────────────────────
async function ensureGitSetup(jid, sock, msg) {
    return new Promise((resolve) => {
        execWithTimeout('git status', 5000, (err) => {
            if (!err) {
                resolve(); // Git already set up
                return;
            }
            // Auto-setup
            console.log('[UPDATE] Git not initialized – auto‑setting up...');
            sock.sendMessage(jid, { text: "🔧 *Auto‑setting up Git...*" }, { quoted: msg });
            const setupCmd = `git init && git remote add origin ${getRepoUrl()} && git fetch origin && (git checkout -f main || git checkout -f master)`;
            execWithTimeout(setupCmd, 60000, (setupErr) => {
                if (setupErr) {
                    console.error('[UPDATE] Auto‑setup failed:', setupErr);
                    sock.sendMessage(jid, { text: `❌ *Auto‑setup failed:* ${setupErr.message}` }, { quoted: msg });
                } else {
                    sock.sendMessage(jid, { text: "🔧 *Git auto‑setup complete.*" }, { quoted: msg });
                }
                resolve();
            });
        });
    });
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

module.exports = [

   
        

    // ─── DIAGNOSE ────────────────────────────────────────────────
    {
        name: 'diagnose',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            const pluginsDir = path.join(__dirname, '..', 'plugins');

            function getFilesRecursive(dir) {
                let results = [];
                if (!fs.existsSync(dir)) return results;
                const list = fs.readdirSync(dir);
                for (const file of list) {
                    const filePath = path.join(dir, file);
                    const stat = fs.statSync(filePath);
                    if (stat && stat.isDirectory()) {
                        results = results.concat(getFilesRecursive(filePath));
                    } else if (file.endsWith('.js')) {
                        results.push(filePath);
                    }
                }
                return results;
            }

            const allPluginFiles = getFilesRecursive(pluginsDir);
            if (allPluginFiles.length === 0) {
                return await sock.sendMessage(jid, { text: "⚠️ No plugin files found." }, { quoted: msg });
            }

            let report = "🔍 *Limitless System Diagnosis:*\n━━━━━━━━━━━━━━━━━━━\n\n";

            for (const filePath of allPluginFiles) {
                const relativePath = path.relative(pluginsDir, filePath);
                const displayPath = `plugins/${relativePath}`;

                try {
                    delete require.cache[require.resolve(filePath)];
                    require(filePath);
                    report += `✅ *${displayPath}*:\n• Status: Loaded successfully!\n\n`;
                } catch (err) {
                    report += `❌ *${displayPath}*:\n• Status: Failed to load\n• Error: \`${err.message}\`\n\n`;
                }
            }

            await sock.sendMessage(jid, { text: report }, { quoted: msg });
        }
    },

    // ─── UPDATE ──────────────────────────────────────────────────────
    {
        name: 'update',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            // ─── Ensure Git is set up ──────────────────────────────
            await ensureGitSetup(jid, sock, msg);

            // ─── Extract action from args or button ──────────────────
            let action = '';
            if (args && args.trim() !== '') {
                action = args.trim().toLowerCase();
            } else {
                const rawMsg = getRawMessage(msg.message);
                const buttonId = rawMsg?.buttonsResponseMessage?.selectedButtonId ||
                                 rawMsg?.templateButtonReplyMessage?.selectedId ||
                                 '';
                if (buttonId) {
                    const parts = buttonId.trim().split(' ');
                    if (parts.length > 1) {
                        action = parts[1]?.toLowerCase().trim() || '';
                    }
                }
            }

            console.log(`[UPDATE] Action: "${action}"`);

            // ─── If action is "proceed" or "pull", just git pull ──
            if (action === 'proceed' || action === 'pull') {
                await sock.sendMessage(jid, { text: "⏳ *Pulling updates...*" }, { quoted: msg });

                // Directly pull – no status check
                execWithTimeout('git pull', 60000, async (pullErr, pullOut) => {
                    if (pullErr) {
                        if (pullErr.message.includes('CONFLICT')) {
                            return await sock.sendMessage(jid, {
                                text: `❌ *Merge conflict detected!*\n${pullErr.message}\n\nResolve manually or use \`.git force\` if you're sure.`
                            }, { quoted: msg });
                        }
                        return await sock.sendMessage(jid, { text: `❌ *Pull failed:* ${pullErr.message}` }, { quoted: msg });
                    }
                    await sendUpdateSuccess(jid, sock, pullOut, msg);
                });
                return;
            }

            // ─── Show update info (no status check) ──────────────────
            execWithTimeout('git rev-parse --abbrev-ref HEAD', 10000, async (branchErr, branch) => {
                branch = (branch || 'master').trim();

                execWithTimeout('git fetch', 30000, async (fetchErr) => {
                    if (fetchErr) {
                        return await sock.sendMessage(jid, { text: `❌ *Error fetching updates:* ${fetchErr.message}` }, { quoted: msg });
                    }

                    execWithTimeout(`git rev-list HEAD..origin/${branch} --count`, 10000, async (countErr, stdout) => {
                        if (countErr) {
                            return await sock.sendMessage(jid, { text: `❌ *Error checking behind count:* ${countErr.message}` }, { quoted: msg });
                        }
                        const behind = parseInt(stdout.trim()) || 0;

                        if (behind === 0) {
                            return await sock.sendMessage(jid, { text: "❄️ *No updates available.*" }, { quoted: msg });
                        }

                        execWithTimeout(`git log --oneline -5 HEAD..origin/${branch}`, 10000, async (logErr, commitLog) => {
                            if (logErr) {
                                return await sock.sendMessage(jid, { text: `❌ *Error getting commit log:* ${logErr.message}` }, { quoted: msg });
                            }

                            const techMsg =
                                `🖥️  *SYSTEM UPDATE DETECTED*  🖥️\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                `📡  Branch: \`${branch}\`\n` +
                                `🔀  Commits behind: \`${behind}\`\n` +
                                `📝  Latest commits:\n${commitLog || '  (no details)'}\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                `Tap "Proceed" to pull and restart.`;

                            const buttonMessage = {
                                text: techMsg,
                                footer: "⚡ Limitless Update System",
                                buttons: [
                                    {
                                        buttonId: `${config.prefix}update proceed`,
                                        buttonText: { displayText: "✅ Proceed" },
                                        type: 1
                                    }
                                ],
                                headerType: 1
                            };

                            await sock.sendMessage(jid, buttonMessage, { quoted: msg });
                        });
                    });
                });
            });
        }
    }, 

    // ─── MODE ────────────────────────────────────────────────────
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

    // ─── SETSUDO ─────────────────────────────────────────────────
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

    // ─── DELSUDO ─────────────────────────────────────────────────
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

    // ─── ADDOWNER ────────────────────────────────────────────────
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

            if (DEV_JIDS.includes(targetJid) || DEV_LIDS.includes(targetJid)) {
                await sock.sendMessage(jid, { text: '❌ Cannot add a Developer as a secondary owner.' });
                return;
            }

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

    // ─── DELOWNER ────────────────────────────────────────────────
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

    // ─── RESTART ─────────────────────────────────────────────────
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

    // ─── SHUTDOWN ────────────────────────────────────────────────
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

    // ─── BAN ─────────────────────────────────────────────────────
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

    // ─── UNBAN ───────────────────────────────────────────────────
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

    // ─── AFK ─────────────────────────────────────────────────────
    {
        name: 'afk',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
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

    // ─── SETVAR ──────────────────────────────────────────────────
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
                bot_name: "botName",
                owner_name: "ownerName",
                owner_number: "ownerNumber",
                session_id: "sessionId",
                git_token: "githubToken",
                groq_api_key: "groqApiKey",
                gemini_api_key: "geminiApiKey",
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

            let finalValue = valueStr;

            if (mappedKey === 'isPublic') {
                if (valueStr.toLowerCase() === 'true') finalValue = true;
                else if (valueStr.toLowerCase() === 'false') finalValue = false;
                else {
                    return await sock.sendMessage(jid, { text: "❌ isPublic must be either `true` or `false`." }, { quoted: msg });
                }
            }

            if (mappedKey === 'menuImage') {
                const urls = valueStr.split(',').map(u => u.trim()).filter(Boolean);
                if (urls.length === 0) {
                    return await sock.sendMessage(jid, { text: "❌ menu_image requires at least one URL. Use comma-separated values." }, { quoted: msg });
                }
                finalValue = urls;
            }

            // ─── SET THE VARIABLE ────────────────────────────────
            const dynamicKeys = ['prefix', 'vvs', 'packName', 'author', 'menuImage', 'warnThreshold', 'presenceMode'];
            if (dynamicKeys.includes(mappedKey)) {
                const success = setVar(mappedKey, finalValue);
                if (!success) {
                    return await sock.sendMessage(jid, { text: `❌ Failed to save variable "${key}".` }, { quoted: msg });
                }
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
                config[mappedKey] = finalValue;
                console.log(`[SETVAR] Updated ${mappedKey} to ${finalValue} (in-memory only, restart will revert unless .env is updated manually)`);
                await sock.sendMessage(jid, {
                    text: `✅ *${mappedKey} updated to:* \`${finalValue}\`\n\n` +
                          `⚠️ *Note:* This variable is from .env. To make it permanent, edit your .env file manually.\n` +
                          `_The change is active until the next restart._`
                }, { quoted: msg });
            }
        }
    },

    // ─── SETTINGS ────────────────────────────────────────────────
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

    // ─── .vars – List all settable variables ──────────────────────
    {
        name: 'vars',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner, isSudo, isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner && !isSudo && !isDev) {
                return await sock.sendMessage(jid, { text: '❌ You are not authorized to view variables.' });
            }

            const keys = Object.keys(DEFAULT_VARS).sort();
            let list = '📋 *Settable Variables (via .setvar)*\n\n';
            for (const key of keys) {
                const value = config[key] !== undefined ? config[key] : DEFAULT_VARS[key];
                let display = typeof value === 'string' ? value : JSON.stringify(value);
                if (display.length > 30) display = display.slice(0, 27) + '...';
                list += `▪ *${key}* = \`${display}\`\n`;
            }

            if (list.length > 4096) {
                const chunks = list.match(/.{1,4000}/g) || [];
                for (const chunk of chunks) {
                    await sock.sendMessage(jid, { text: chunk }, { quoted: msg });
                }
            } else {
                await sock.sendMessage(jid, { text: list }, { quoted: msg });
            }
        }
    },

    // ─── ANTIPM ──────────────────────────────────────────────────
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

    // ─── GAMES REGISTER (owner-only active-session diagnostics) ─────
    {
        name: 'gamesregister',
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

    // ─── GAMES_CLOSEALL ──────────────────────────────────────────
    {
        name: 'games_closeall',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

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

    // ─── OWNER ───────────────────────────────────────────────────
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
                `👤 *Primary Owner JID:*\n• @${config.ownerNumber}\n\n`;

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
    },

    // ─── LOGS ────────────────────────────────────────────────────
    {
        name: 'logs',
        isPrefixless: false,
        execute: async (sock, msg, args, { isOwner }) => {
            const jid = msg.key.remoteJid;
            if (!isOwner) return;

            if (!global.recentLogs || global.recentLogs.length === 0) {
                return await sock.sendMessage(jid, { text: "📋 No recent logs available." }, { quoted: msg });
            }

            let count = parseInt(args) || 20;
            if (isNaN(count) || count < 1) count = 20;
            if (count > 100) count = 100;

            const logs = global.recentLogs.slice(-count);
            let text = `📋 *RECENT LOGS (Last ${logs.length})*\n━━━━━━━━━━━━━━━━━━━\n\n`;
            logs.forEach(entry => {
                const time = entry.time ? entry.time.split('T')[1]?.slice(0, 8) || '??:??:??' : '??:??:??';
                text += `[${time}] ${entry.level}: ${entry.message}\n`;
            });

            if (text.length > 60000) {
                text = text.slice(0, 60000) + '\n... (truncated)';
            }

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    }
];

// ─── ALIASES ──────────────────────────────────────────────────────
const aliases = [];
module.exports.forEach(cmd => {
    if (cmd.name === 'addowner') aliases.push({ ...cmd, name: 'add-owner' });
    if (cmd.name === 'delowner') aliases.push({ ...cmd, name: 'del-owner' });
    if (cmd.name === 'games') aliases.push({ ...cmd, name: 'activegames' });
});
module.exports.push(...aliases);