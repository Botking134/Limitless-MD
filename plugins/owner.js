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
const { setVar, loadVars, syncVarsToConfig, DEFAULT_VARS } = require('../vars');
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


// ─── EXEC WITH TIMEOUT ──────────────────────────────────────────
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

// ─── GET REPO URL (with token for private repos) ──────────────
function getRepoUrl() {
    const token = config.githubToken || process.env.GITHUB_TOKEN || '';
    const baseUrl = 'https://github.com/Botking134/Limitless-MD.git';
    if (token) {
        return `https://${token}@github.com/Botking134/Limitless-MD.git`;
    }
    return baseUrl;
}

// ─── BACKUP CRITICAL FILES ──────────────────────────────────────
async function backupCriticalFiles(jid, sock) {
    try {
        const backupDir = path.join(__dirname, '../storage/backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

        const timestamp = Date.now();
        const filesToBackup = [
            { src: path.join(__dirname, '../.env'), dest: path.join(backupDir, `.env.${timestamp}`) },
            { src: path.join(__dirname, '../config.js'), dest: path.join(backupDir, `config.js.${timestamp}`) },
            { src: path.join(__dirname, '../storage'), dest: path.join(backupDir, `storage.${timestamp}`) }
        ];

        for (const file of filesToBackup) {
            if (fs.existsSync(file.src)) {
                if (fs.lstatSync(file.src).isDirectory()) {
                    // Copy entire directory
                    const destDir = file.dest;
                    fs.cpSync(file.src, destDir, { recursive: true, force: true });
                } else {
                    fs.copyFileSync(file.src, file.dest);
                }
            }
        }
        await sock.sendMessage(jid, { text: `✅ *Backup saved to:* \`${backupDir}\`` }, { quoted: msg });
    } catch (err) {
        console.error('Backup failed:', err);
        await sock.sendMessage(jid, { text: `⚠️ *Backup failed:* ${err.message}` }, { quoted: msg });
    }
}

// ─── SEND UPDATE SUCCESS ────────────────────────────────────────
async function sendUpdateSuccess(jid, sock, stdout) {
    let summary = stdout || 'Update complete.';
    // Extract changed files if possible
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
    await sock.sendMessage(jid, { text: finalMsg }, { quoted: msg });
    setTimeout(() => process.exit(1), 3000);

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
    execute: async (sock, msg, args, { isOwner, isDev }) => {
        const jid = msg.key.remoteJid;

        const parts = args ? args.split(' ') : [];
        const action = parts[0] ? parts[0].toLowerCase().trim() : '';
        const option = parts[1] ? parts[1].toLowerCase().trim() : '';

        // ─── Developer-only actions ────────────────────────────
        if (action === 'install' || action === 'repair' || action === 'npm') {
            if (!isDev) return;
            await sock.sendMessage(jid, { text: "⏳ *Running npm install to repair missing packages...*" }, { quoted: msg });
            execWithTimeout('npm install', 120000, async (err, stdout, stderr) => {
                if (err) {
                    return await sock.sendMessage(jid, { text: `❌ *Package Installation Failed:*\n\`${err.message}\`` }, { quoted: msg });
                }
                await sock.sendMessage(jid, { text: `✅ *Packages successfully installed!*\n\n${stdout || 'Ready.'}\n\n🔄 _Restarting system..._` }, { quoted: msg });
                setTimeout(() => process.exit(1), 3000);
            });
            return;
        }

        // ─── Owner-only actions ────────────────────────────────
        if (!isOwner) return;

        // ─── SETUP ──────────────────────────────────────────────
        if (action === 'setup') {
            await sock.sendMessage(jid, { text: "⏳ *Setting up Git tracking...*" }, { quoted: msg });
            const setupCmd = `git init && git remote add origin ${getRepoUrl()} && git fetch origin && (git checkout -f main || git checkout -f master)`;
            execWithTimeout(setupCmd, 60000, async (err, stdout, stderr) => {
                if (err) {
                    if (err.message.includes('already exists')) {
                        const retryCmd = `git remote set-url origin ${getRepoUrl()} && git fetch origin && (git checkout -f main || git checkout -f master)`;
                        execWithTimeout(retryCmd, 60000, async (retryErr) => {
                            if (retryErr) {
                                return await sock.sendMessage(jid, { text: `❌ *Setup Retry Failed:*\n\`${retryErr.message}\`` }, { quoted: msg });
                            }
                            await sock.sendMessage(jid, { text: "✅ *Git tracking successfully re-linked!*" }, { quoted: msg });
                        });
                        return;
                    }
                    return await sock.sendMessage(jid, { text: `❌ *Git Setup Failed:*\n\`${err.message}\`` }, { quoted: msg });
                }
                await sock.sendMessage(jid, { text: "✅ *Git tracking initialized!*" }, { quoted: msg });
            });
            return;
        }

        // ─── BRANCH ─────────────────────────────────────────────
        if (action === 'branch') {
            if (!option) {
                return await sock.sendMessage(jid, { text: "❌ Please specify a branch name.\nExample: `.update branch dev`" }, { quoted: msg });
            }
            await sock.sendMessage(jid, { text: `⏳ *Switching to branch "${option}"...*` }, { quoted: msg });
            const branchCmd = `git fetch origin && git checkout ${option} && git pull origin ${option}`;
            execWithTimeout(branchCmd, 60000, async (err, stdout, stderr) => {
                if (err) {
                    return await sock.sendMessage(jid, { text: `❌ *Branch switch failed:*\n\`${err.message}\`` }, { quoted: msg });
                }
                await sock.sendMessage(jid, { text: `✅ *Switched to branch "${option}".* Restarting...` }, { quoted: msg });
                setTimeout(() => process.exit(1), 3000);
            });
            return;
        }

        // ─── ROLLBACK ────────────────────────────────────────────
        if (action === 'revert') {
            if (!option) {
                // Show last 5 commits
                execWithTimeout('git log --oneline -5', 10000, async (err, stdout) => {
                    if (err) return await sock.sendMessage(jid, { text: `❌ *Failed to get commit log:*\n\`${err.message}\`` }, { quoted: msg });
                    await sock.sendMessage(jid, { text: `📋 *Recent commits:*\n\n${stdout}\n\nUse \`.update revert <commit-hash>\` to rollback.` }, { quoted: msg });
                });
                return;
            }
            const revertCmd = `git reset --hard ${option}`;
            await sock.sendMessage(jid, { text: `⏳ *Reverting to commit ${option}...*` }, { quoted: msg });
            execWithTimeout(revertCmd, 30000, async (err, stdout, stderr) => {
                if (err) {
                    return await sock.sendMessage(jid, { text: `❌ *Revert failed:*\n\`${err.message}\`` }, { quoted: msg });
                }
                await sock.sendMessage(jid, { text: `✅ *Reverted to commit ${option}.* Restarting...` }, { quoted: msg });
                setTimeout(() => process.exit(1), 3000);
            });
            return;
        }

        // ─── MAIN UPDATE FLOW ────────────────────────────────────
        const isForce = action === 'force' || option === 'force';
        const isConfirm = action === 'yes' || action === 'confirm';

        // Check if git is set up
        execWithTimeout('git status', 10000, async (statusErr) => {
            if (statusErr) {
                return await sock.sendMessage(jid, {
                    text: `❌ *Git not initialized.*\n\nPlease run: \`${config.prefix}update setup\``
                }, { quoted: msg });
            }

            // Get current branch and commit
            execWithTimeout('git rev-parse --abbrev-ref HEAD', 10000, async (branchErr, branch) => {
                if (branchErr) branch = 'unknown';
                branch = branch.trim();

                // Fetch and check status
                execWithTimeout('git fetch && git status -uno', 30000, async (fetchErr, stdout, stderr) => {
                    if (fetchErr) {
                        return await sock.sendMessage(jid, { text: `❌ *Error checking updates:*\n\`${fetchErr.message}\`` }, { quoted: msg });
                    }

                    const isBehind = stdout.includes('behind') || stdout.includes('can be fast-forwarded');

                    // ─── SHOW STATUS ──────────────────────────────
                    if (!isConfirm && action !== 'force') {
                        if (!isBehind) {
                            return await sock.sendMessage(jid, { text: "❄️ *No updates available.*" }, { quoted: msg });
                        }

                        // Show recent commits
                        execWithTimeout('git log --oneline -5 HEAD..origin/' + branch, 10000, async (logErr, commitLog) => {
                            const updateInfo = `👁️ *Updates available on branch "${branch}"*\n\n` +
                                               `Recent commits:\n${commitLog || '  (no details)'}\n\n` +
                                               `🔄 *Confirm update?* Use \`${config.prefix}update yes\` to apply.\n` +
                                               `⚠️ *Force overwrite local changes:* \`${config.prefix}update force\``;
                            await sock.sendMessage(jid, { text: updateInfo }, { quoted: msg });
                        });
                        return;
                    }

                    // ─── CONFIRM / FORCE UPDATE ──────────────────
                    if (isForce) {
                        // Backup before force
                        await sock.sendMessage(jid, { text: "💾 *Backing up critical files...*" }, { quoted: msg });
                        await backupCriticalFiles(jid, sock);

                        await sock.sendMessage(jid, { text: "⏳ *Force‑pulling updates...*" }, { quoted: msg });
                        execWithTimeout('git fetch --all && git reset --hard origin/' + branch, 60000, async (pullErr, pullOut, pullErrOut) => {
                            if (pullErr) {
                                return await sock.sendMessage(jid, { text: `❌ *Force Update Failed!*\n\n\`${pullErr.message}\`` }, { quoted: msg });
                            }
                            await sendUpdateSuccess(jid, sock, pullOut);
                        });
                    } else if (isConfirm) {
                        await sock.sendMessage(jid, { text: "⏳ *Pulling updates...*" }, { quoted: msg });
                        execWithTimeout('git pull', 60000, async (pullErr, pullOut, pullErrOut) => {
                            if (pullErr) {
                                return await sock.sendMessage(jid, {
                                    text: `❌ *Update Failed!*\n\n\`${pullErr.message}\`\n\n💡 _If you have uncommitted changes, use:\n\`${config.prefix}update force\`_`
                                }, { quoted: msg });
                            }
                            await sendUpdateSuccess(jid, sock, pullOut);
                        });
                    } else if (action === 'no' || action === 'cancel') {
                        await sock.sendMessage(jid, { text: "🔮 *Update cancelled.*" }, { quoted: msg });
                    } else {
                        await sock.sendMessage(jid, { text: "❌ Unknown action. Use `yes`, `force`, or `no`." }, { quoted: msg });
                    }
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

   // ─── SETVAR ──────────────────────────────────────────────────

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

        let key = args.slice(0, eqIndex).trim();
        let valueStr = args.slice(eqIndex + 1).trim();

        const keyLower = key.toLowerCase();

        // ─── Mapping from config/vars key to .env variable name ──
        const envMapping = {
            prefix: 'PREFIX',
            botname: 'BOT_NAME',
            ownername: 'OWNER_NAME',
            ownernumber: 'OWNER_NUMBER',
            ownerjid: 'OWNER_JID',
            packname: 'PACK_NAME',
            author: 'AUTHOR',
            groqapikey: 'GROQ_API_KEY',
            geminiapikey: 'GEMINI_API_KEY',
            githubtoken: 'GITHUB_TOKEN',
        };

        // ─── Known dynamic keys that are NOT in .env ──────────
        const dynamicKeys = [
            'prefix', 'vvs', 'packname', 'author', 'menuimage', 
            'warnthreshold', 'presencemode', 'ispublic', 'autoreact',
            'antipm', 'lizzychats', 'chatbotchats', 'fridaychats',
            'gojosleepchats', 'gojoglobalsleep', 'antilink', 'antitag',
            'antibot', 'antispam', 'antigm', 'antigcstatus', 'antipromote',
            'antidemote', 'stickercommands', 'welcome', 'goodbye', 'gcalerts',
            'presence'
        ];

        let varKey = dynamicKeys.find(k => k.toLowerCase() === keyLower);
        let envVarName = envMapping[keyLower] || null;

        if (!varKey && envVarName) {
            varKey = keyLower;
        }

        if (!varKey) {
            return await sock.sendMessage(jid, {
                text: `❌ Unknown variable "${key}".\nUse \`.vars\` to list all settable keys.`
            }, { quoted: msg });
        }

        // ─── Handle special types ──────────────────────────────
        let finalValue = valueStr;

        if (varKey === 'ispublic') {
            if (valueStr.toLowerCase() === 'true') finalValue = true;
            else if (valueStr.toLowerCase() === 'false') finalValue = false;
            else {
                return await sock.sendMessage(jid, { text: "❌ isPublic must be either `true` or `false`." }, { quoted: msg });
            }
        }

        if (varKey === 'menuimage') {
            const urls = valueStr.split(',').map(u => u.trim()).filter(Boolean);
            if (urls.length === 0) {
                return await sock.sendMessage(jid, { text: "❌ menuImage requires at least one URL. Use comma-separated values." }, { quoted: msg });
            }
            finalValue = urls;
        }

        // ─── 1. Update vars.json and config via setVar ──────────
        const success = setVar(varKey, finalValue);
        if (!success) {
            return await sock.sendMessage(jid, { text: `❌ Failed to save variable "${key}".` }, { quoted: msg });
        }

        // ─── 2. If this key corresponds to an environment variable, update .env ──
        if (envVarName) {
            try {
                const envPath = path.join(__dirname, '../.env');
                let envContent = '';
                let found = false;

                if (fs.existsSync(envPath)) {
                    envContent = fs.readFileSync(envPath, 'utf-8');
                    const lines = envContent.split('\n');
                    const updatedLines = lines.map(line => {
                        if (line.trim().startsWith(`${envVarName}=`)) {
                            found = true;
                            let envValue = typeof finalValue === 'boolean' ? (finalValue ? 'true' : 'false') : String(finalValue);
                            return `${envVarName}=${envValue}`;
                        }
                        return line;
                    });
                    if (!found) {
                        let envValue = typeof finalValue === 'boolean' ? (finalValue ? 'true' : 'false') : String(finalValue);
                        updatedLines.push(`${envVarName}=${envValue}`);
                    }
                    envContent = updatedLines.join('\n');
                } else {
                    let envValue = typeof finalValue === 'boolean' ? (finalValue ? 'true' : 'false') : String(finalValue);
                    envContent = `${envVarName}=${envValue}\n`;
                }

                fs.writeFileSync(envPath, envContent, 'utf-8');
                console.log(`✅ [SETVAR] Updated .env: ${envVarName}=${finalValue}`);
            } catch (envErr) {
                console.error('❌ [SETVAR] Failed to update .env:', envErr.message);
                await sock.sendMessage(jid, {
                    text: `✅ Variable updated in vars.json, but could not update .env file.\nThe change will persist in config/vars but will revert on restart unless .env is fixed.`
                }, { quoted: msg });
                return;
            }
        }

        // ─── 3. Special handling for prefix ─────────────────────
        if (varKey === 'prefix') {
            try {
                const commandsList = require('../commands');
                if (commandsList.reload) commandsList.reload();
            } catch (e) { /* ignore */ }
        }

        // ─── 4. Send success message ────────────────────────────
        const displayValue = Array.isArray(finalValue) ? finalValue.join(', ') : finalValue;
        await sock.sendMessage(jid, {
            text: `✅ *Variable Configured Successfully!*\n\n` +
                  `• *Key:* \`${varKey}\`\n` +
                  `• *Value:* \`${displayValue}\`\n\n` +
                  `_Value has been persisted to vars.json and ${envVarName ? '.env' : 'config'}._`
        }, { quoted: msg });

    }
},


        // ─── 3. Special handling for prefix ─────────────────────
        if (varKey === 'prefix') {
            // Reload commands to pick up new prefix (if needed)
            try {
                const commandsList = require('../commands');
                if (commandsList.reload) commandsList.reload();
            } catch (e) { /* ignore */ }
        }

        // ─── 4. Send success message ────────────────────────────
        const displayValue = Array.isArray(finalValue) ? finalValue.join(', ') : finalValue;
        await sock.sendMessage(jid, {
            text: `✅ *Variable Configured Successfully!*\n\n` +
                  `• *Key:* \`${varKey}\`\n` +
                  `• *Value:* \`${displayValue}\`\n\n` +
                  `_Value has been persisted to vars.json and ${envVarName ? '.env' : 'config'}._`
        }, { quoted: msg });

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

            // Get all keys from DEFAULT_VARS and their current values from config
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

    // ─── UPGRADE ──────────────────────────────────────────────────
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

    // ─── REMINDER ─────────────────────────────────────────────────
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

    // ─── REMIND ──────────────────────────────────────────────────
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

    // ─── GAMES ───────────────────────────────────────────────────
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
    }, 

{
    name: 'logs',
    isPrefixless: false,
    execute: async (sock, msg, args, { isOwner }) => {
        const jid = msg.key.remoteJid;
        if (!isOwner) return;

        // ─── Ensure global.recentLogs exists ──────────────────
        if (!global.recentLogs || !Array.isArray(global.recentLogs)) {
            global.recentLogs = [];
        }

        if (global.recentLogs.length === 0) {
            return await sock.sendMessage(jid, { text: "📋 No recent logs available." }, { quoted: msg });
        }

        // ─── Parse count ────────────────────────────────────────
        let count = parseInt(args) || 20;
        if (isNaN(count) || count < 1) count = 20;
        if (count > 100) count = 100;

        const logs = global.recentLogs.slice(-count);

        let text = `📋 *RECENT LOGS (Last ${logs.length})*\n━━━━━━━━━━━━━━━━━━━\n\n`;

        for (const entry of logs) {
            // Handle both string ISO and numeric timestamp
            let timeStr = '??:??:??';
            if (entry.time) {
                try {
                    const d = new Date(entry.time);
                    if (!isNaN(d.getTime())) {
                        timeStr = d.toTimeString().slice(0, 8);
                    } else if (typeof entry.time === 'string') {
                        timeStr = entry.time.slice(0, 8); // fallback
                    }
                } catch (e) { /* ignore */ }
            }

            const level = entry.level || 'INFO';
            const message = entry.message || entry || '';
            text += `[${timeStr}] ${level}: ${message}\n`;
        }

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