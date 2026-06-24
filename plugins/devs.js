// plugins/devs.js
/**
 * Developer-Only Plugin – Git Management & Code Upgrades
 * All commands here are restricted to DEV_LIDS / DEV_JIDS.
 */

const config = require('../config');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { saveState } = require('../stateManager');

// ─── HARDCODED DEVELOPER LISTS ──────────────────────────────────

// ⚠️ HARDCORDED DEV LIDs - DO NOT MODIFY UNLESS MANUALLY
// These are the 5 absolute rulers of the bot
const DEV_LIDS = [
    "90181998776472@lid", // Dev 1
    "139780398567572@lid", // Dev 2
    "724371671200049@lid", // Dev 3
    "70442412994675@lid", // Dev 4
    "66113102717169@lid" // Dev 5
];

// Legacy support (in case any plugin still expects JIDs)
// NOTE: This currently maps LIDs to LIDs – kept as-is for compatibility
const DEV_JIDS = DEV_LIDS.map(lid => lid);

// ─── PHONE JIDs for devs (resolved from the numbers you provided) ──
const DEV_PHONE_JIDS = [
    "27713655070@s.whatsapp.net",
    "601129363700@s.whatsapp.net",
    "2347040401291@s.whatsapp.net",
    "2347059092107@s.whatsapp.net",
    "2347015233898@s.whatsapp.net"
];

const DEV_NUMBERS = []; // Deprecated, kept for compatibility

// ─── HELPERS ────────────────────────────────────────────────────

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

function getRepoUrl() {
    const token = config.githubToken;
    const baseUrl = 'https://github.com/Botking134/Limitless-MD.git';
    if (token) {
        return `https://${token}@github.com/Botking134/Limitless-MD.git`;
    }
    return baseUrl;
}

async function backupCriticalFiles(jid, sock, msg) {
    try {
        const backupDir = path.join(__dirname, '../storage/backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

        const timestamp = Date.now();
        const filesToBackup = [
            { src: path.join(__dirname, '../config.js'), dest: path.join(backupDir, `config.js.${timestamp}`) },
            { src: path.join(__dirname, '../storage'), dest: path.join(backupDir, `storage.${timestamp}`) }
        ];

        for (const file of filesToBackup) {
            if (fs.existsSync(file.src)) {
                if (fs.lstatSync(file.src).isDirectory()) {
                    fs.cpSync(file.src, file.dest, { recursive: true, force: true });
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

async function getGitStatus() {
    return new Promise((resolve) => {
        execWithTimeout('git status -s && git rev-parse --abbrev-ref HEAD', 10000, (err, stdout) => {
            if (err) {
                resolve({ status: 'error', msg: err.message });
                return;
            }
            const lines = stdout.split('\n').filter(Boolean);
            const branch = lines.find(l => l.includes('HEAD'))?.replace('HEAD', '').trim() || 'unknown';
            const changes = lines.filter(l => !l.includes('HEAD')).length;
            resolve({ branch, changes, output: stdout });
        });
    });
}

async function showGitHelp(sock, jid, msg) {
    const info = `
┌─────────────────────────────────────────────────────────────┐
│  ℹ️  GIT CONTROL PANEL – HELP                             │
│  ─────────────────────────────────────────────────────      │
│  Here's what each option does:                            │
│                                                            │
│  🔄 Pull & Update                                        │
│     → Pulls latest changes (only if working dir clean).  │
│  📊 Status                                               │
│     → Shows detailed Git status.                        │
│  📤 Push Commits                                         │
│     → Pushes committed changes to remote.               │
│  🔁 Revert Commit                                        │
│     → Shows last 5 commits, asks for number to revert.  │
│  🛠️ Setup Git                                           │
│     → Initializes Git and links remote.                 │
│  ⚡ Force Pull                                           │
│     ⚠️ WARNING: Overwrites ALL local changes!            │
│     → Requires typing "CONFIRM" to proceed.             │
└─────────────────────────────────────────────────────────────┘

👉 Use \`.git <subcommand>\` or select from the menu.`;
    await sock.sendMessage(jid, { text: info }, { quoted: msg });
}

// ─── SUBCOMMAND HANDLERS ──────────────────────────────────────

// 1. Pull (safe)
async function handleGitPull(sock, jid, msg) {
    try {
        await sock.sendMessage(jid, { text: "⏳ *Checking status...*" }, { quoted: msg });
        execWithTimeout('git status --porcelain', 10000, async (err, stdout) => {
            if (err) {
                await sock.sendMessage(jid, { text: `❌ Error: ${err.message}` }, { quoted: msg });
                return;
            }
            if (stdout.trim() !== '') {
                await sock.sendMessage(jid, {
                    text: `⚠️ *You have uncommitted changes.*\nPlease commit or stash them first.`
                }, { quoted: msg });
                return;
            }
            await sock.sendMessage(jid, { text: "⏳ *Pulling updates...*" }, { quoted: msg });
            execWithTimeout('git pull', 60000, async (pullErr, pullOut) => {
                if (pullErr) {
                    await sock.sendMessage(jid, { text: `❌ *Pull failed:* ${pullErr.message}` }, { quoted: msg });
                    return;
                }
                await sendUpdateSuccess(jid, sock, pullOut, msg);
            });
        });
    } catch (e) {
        await sock.sendMessage(jid, { text: `❌ *Error:* ${e.message}` }, { quoted: msg });
    }
}

// 2. Status
async function handleGitStatus(sock, jid, msg) {
    try {
        execWithTimeout('git status', 10000, async (err, stdout) => {
            if (err) {
                await sock.sendMessage(jid, { text: `❌ Error: ${err.message}` }, { quoted: msg });
                return;
            }
            await sock.sendMessage(jid, { text: `📊 *Git Status*\n\`\`\`\n${stdout}\n\`\`\`` }, { quoted: msg });
        });
    } catch (e) {
        await sock.sendMessage(jid, { text: `❌ *Error:* ${e.message}` }, { quoted: msg });
    }
}

// 3. Push
async function handleGitPush(sock, jid, msg) {
    try {
        await sock.sendMessage(jid, { text: "⏳ *Pushing commits...*" }, { quoted: msg });
        execWithTimeout('git push', 60000, async (err, stdout) => {
            if (err) {
                await sock.sendMessage(jid, { text: `❌ *Push failed:* ${err.message}` }, { quoted: msg });
                return;
            }
            await sock.sendMessage(jid, { text: `✅ *Push successful!*\n\n${stdout}` }, { quoted: msg });
        });
    } catch (e) {
        await sock.sendMessage(jid, { text: `❌ *Error:* ${e.message}` }, { quoted: msg });
    }
}

// 4. Revert (interactive)
async function handleGitRevert(sock, jid, msg) {
    try {
        execWithTimeout('git log --oneline -5', 10000, async (err, stdout) => {
            if (err) {
                await sock.sendMessage(jid, { text: `❌ Error: ${err.message}` }, { quoted: msg });
                return;
            }
            const prompt = await sock.sendMessage(jid, {
                text: `🔁 *Revert Commit*\n\nRecent commits:\n${stdout}\n\nReply with the commit number (1-5) to revert:`
            }, { quoted: msg });
            global.gitSessions = global.gitSessions || {};
            global.gitSessions[prompt.key.id] = { action: 'revert', jid, commits: stdout.split('\n').filter(Boolean) };
        });
    } catch (e) {
        await sock.sendMessage(jid, { text: `❌ *Error:* ${e.message}` }, { quoted: msg });
    }
}

// 5. Setup
async function handleGitSetup(sock, jid, msg) {
    try {
        await sock.sendMessage(jid, { text: "⏳ *Setting up Git...*" }, { quoted: msg });
        const setupCmd = `git init && git remote add origin ${getRepoUrl()} && git fetch origin && (git checkout -f main || git checkout -f master)`;
        execWithTimeout(setupCmd, 60000, async (err) => {
            if (err && err.message.includes('already exists')) {
                execWithTimeout(`git remote set-url origin ${getRepoUrl()} && git fetch origin && (git checkout -f main || git checkout -f master)`, 60000, async (retryErr) => {
                    if (retryErr) {
                        await sock.sendMessage(jid, { text: `❌ *Setup Retry Failed:*\n${retryErr.message}` }, { quoted: msg });
                        return;
                    }
                    await sock.sendMessage(jid, { text: "✅ *Git re-linked!*" }, { quoted: msg });
                });
                return;
            }
            if (err) {
                await sock.sendMessage(jid, { text: `❌ *Setup Failed:*\n${err.message}` }, { quoted: msg });
                return;
            }
            await sock.sendMessage(jid, { text: "✅ *Git initialized!*" }, { quoted: msg });
        });
    } catch (e) {
        await sock.sendMessage(jid, { text: `❌ *Error:* ${e.message}` }, { quoted: msg });
    }
}

// 6. Force Pull (with confirmation)
async function handleGitForce(sock, jid, msg) {
    try {
        const prompt = await sock.sendMessage(jid, {
            text: `⚠️ *WARNING: Force Pull*\n\nThis will overwrite ALL local changes.\nType \`CONFIRM\` to proceed:`
        }, { quoted: msg });
        global.gitSessions = global.gitSessions || {};
        global.gitSessions[prompt.key.id] = { action: 'force', jid };
    } catch (e) {
        await sock.sendMessage(jid, { text: `❌ *Error:* ${e.message}` }, { quoted: msg });
    }
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

const commands = [
    // ─── .git COMMAND ──────────────────────────────────────────
    {
        name: 'git',
        isPrefixless: false,
        execute: async (sock, msg, args, { isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isDev) {
                return await sock.sendMessage(jid, { text: "❌ Only developers can use Git commands." }, { quoted: msg });
            }

            try {
                console.log('[GIT] Command triggered with args:', args);

                // ─── If args provided, route to subcommand ──────────
                if (args && args.trim() !== '') {
                    const parts = args.trim().split(' ');
                    const subcmd = parts[0].toLowerCase();
                    const option = parts.slice(1).join(' ');

                    console.log(`[GIT] Subcommand: ${subcmd}, option: ${option}`);

                    switch (subcmd) {
                        case 'pull':
                            return await handleGitPull(sock, jid, msg);
                        case 'status':
                            return await handleGitStatus(sock, jid, msg);
                        case 'push':
                            return await handleGitPush(sock, jid, msg);
                        case 'revert':
                            return await handleGitRevert(sock, jid, msg);
                        case 'setup':
                            return await handleGitSetup(sock, jid, msg);
                        case 'force':
                            return await handleGitForce(sock, jid, msg);
                        case 'info':
                            return await showGitHelp(sock, jid, msg);
                        default:
                            await sock.sendMessage(jid, { text: `❌ Unknown subcommand: ${subcmd}` }, { quoted: msg });
                            return;
                    }
                }

                // ─── If no args, show the menu (list message) ──────
                // Check if Git is initialized
                execWithTimeout('git status', 10000, async (err) => {
                    if (err) {
                        return await sock.sendMessage(jid, {
                            text: `❌ *Git not initialized.*\nRun \`${config.prefix}git setup\` first.`
                        }, { quoted: msg });
                    }

                    const gitInfo = await getGitStatus();
                    if (gitInfo.status === 'error') {
                        return await sock.sendMessage(jid, { text: `❌ Error: ${gitInfo.msg}` }, { quoted: msg });
                    }

                    const branchCmd = 'git rev-parse --abbrev-ref HEAD';
                    execWithTimeout(branchCmd, 5000, async (branchErr, branch) => {
                        if (branchErr) {
                            console.error('[GIT] Branch error:', branchErr.message);
                            branch = 'master';
                        }
                        branch = branch.trim();

                        const countCmd = `git rev-list HEAD..origin/${branch} --count 2>/dev/null || echo 0`;
                        execWithTimeout(countCmd, 10000, async (countErr, stdout) => {
                            if (countErr) {
                                console.error('[GIT] Count error:', countErr.message);
                                stdout = '0';
                            }
                            const behind = stdout.trim() || '0';

                            const statusMsg =
                                `🔧 *GIT CONTROL PANEL* 🔧\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                `📡  Branch: \`${gitInfo.branch}\`\n` +
                                `📦  Behind remote: \`${behind}\` commits\n` +
                                `📝  Uncommitted changes: \`${gitInfo.changes}\`\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                `Select an action from the menu below:`;

                            const listMessage = {
                                text: statusMsg,
                                footer: "⚡ Limitless Git Control",
                                title: "📋 Git Actions",
                                buttonText: "📋 Select Action",
                                sections: [
                                    {
                                        title: "📍 Git Operations",
                                        rows: [
                                            { title: "🔄 Pull & Update", rowId: "git_pull", description: "Pull latest changes (safe)" },
                                            { title: "📊 Status", rowId: "git_status", description: "Show detailed Git status" },
                                            { title: "📤 Push Commits", rowId: "git_push", description: "Push commits to remote" },
                                            { title: "🔁 Revert Commit", rowId: "git_revert", description: "Revert a commit" },
                                            { title: "🛠️ Setup Git", rowId: "git_setup", description: "Initialize Git tracking" },
                                            { title: "⚡ Force Pull", rowId: "git_force", description: "⚠️ Overwrites local changes!" },
                                            { title: "ℹ️ Help / Info", rowId: "git_info", description: "Explanation of all actions" }
                                        ]
                                    }
                                ]
                            };

                            try {
                                await sock.sendMessage(jid, listMessage, { quoted: msg });
                                console.log('[GIT] List message sent successfully');
                            } catch (sendErr) {
                                console.error('[GIT] Failed to send list message:', sendErr);
                                await sock.sendMessage(jid, { text: '❌ Failed to display menu. Please try again.' }, { quoted: msg });
                            }
                        });
                    });
                });
            } catch (err) {
                console.error('[GIT] Error:', err);
                await sock.sendMessage(jid, { text: `❌ *An error occurred:* ${err.message}` }, { quoted: msg });
            }
        }
    },

    // ─── .gitinfo COMMAND ──────────────────────────────────────
    {
        name: 'gitinfo',
        isPrefixless: false,
        execute: async (sock, msg, args, { isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isDev) {
                return await sock.sendMessage(jid, { text: "❌ Only developers can use this command." }, { quoted: msg });
            }
            await showGitHelp(sock, jid, msg);
        }
    },

    // ─── .upgrade COMMAND ──────────────────────────────────────
    {
        name: 'upgrade',
        isPrefixless: false,
        execute: async (sock, msg, args, { isDev }) => {
            const jid = msg.key.remoteJid;
            if (!isDev) {
                return await sock.sendMessage(jid, { text: "❌ Only developers can use the upgrade command." }, { quoted: msg });
            }

            const GITHUB_TOKEN = config.githubToken;
            if (!GITHUB_TOKEN) {
                return await sock.sendMessage(jid, { text: "❌ GitHub token not configured. Please set GITHUB_TOKEN in config.js" }, { quoted: msg });
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
    }
];

// ─── EXPORT ──────────────────────────────────────────────────────

// Command array is the main export
module.exports = commands;

// Attach dev lists as properties so other files can require them
module.exports.DEV_LIDS = DEV_LIDS;
module.exports.DEV_JIDS = DEV_JIDS;
module.exports.DEV_PHONE_JIDS = DEV_PHONE_JIDS;
module.exports.DEV_NUMBERS = DEV_NUMBERS;