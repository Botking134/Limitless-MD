// plugins/devs.js
/**
 * Developer-Only Plugin – Git Management & Code Upgrades
 * All commands here are restricted to DEV_LIDS / DEV_JIDS.
 */

const config = require('../config');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── HARDCODED DEVELOPER LISTS ──────────────────────────────────

const DEV_LIDS = [
    "90181998776472@lid", // Dev 1
    "139780398567572@lid", // Dev 2
    "724371671200049@lid", // Dev 3
    "70442412994675@lid", // Dev 4
    "66113102717169@lid" // Dev 5
];

const DEV_JIDS = DEV_LIDS.map(lid => lid);
const DEV_PHONE_JIDS = [
    "27713655070@s.whatsapp.net",
    "601129363700@s.whatsapp.net",
    "2347040401291@s.whatsapp.net",
    "2347059092107@s.whatsapp.net",
    "2347015233898@s.whatsapp.net"
];
const DEV_NUMBERS = [];

// Git commands must run in the bot's own folder, not in whatever directory
// the process happened to be started from.
const REPO_DIR = path.join(__dirname, '..');

// ─── TEMPORARY DEVELOPERS ───────────────────────────────────────
// Added with `add-dev`, removed with `del-dev`, kept in storage/temp_devs.json.
// They are pushed into the SAME arrays as the hardcoded devs (DEV_LIDS, DEV_JIDS,
// DEV_PHONE_JIDS), because Infinity.js, owner.js, pair.js and the group plugins all
// test those arrays with .includes() — so a temp dev is a dev everywhere at once,
// with no restart. The hardcoded entries are remembered in HARD_IDS and can never
// be touched by add-dev / del-dev.

const HARD_IDS = new Set([...DEV_LIDS, ...DEV_JIDS, ...DEV_PHONE_JIDS]);
const TEMP_FILE = path.join(__dirname, '..', 'storage', 'temp_devs.json');
let tempDevs = [];      // [{ id, alt, addedBy, addedAt }]   id = main jid/lid, alt = its other form (if known)
let appliedIds = [];    // what we pushed into the live lists (so we remove exactly that and nothing else)

function cleanId(j) {
    const s = String(j || '').trim();
    const at = s.indexOf('@');
    if (at === -1) return '';
    return s.slice(0, at).split(':')[0] + s.slice(at);
}
const isLid = (id) => String(id).endsWith('@lid');
const isPhone = (id) => String(id).endsWith('@s.whatsapp.net');
const idsOf = (e) => [e.id, e.alt].filter(Boolean);
const tag = (id) => '@' + String(id).split('@')[0];

function detachTemp() {
    for (const id of appliedIds) {
        if (HARD_IDS.has(id)) continue;
        for (const list of [DEV_LIDS, DEV_JIDS, DEV_PHONE_JIDS]) {
            let i;
            while ((i = list.indexOf(id)) !== -1) list.splice(i, 1);
        }
    }
    appliedIds = [];
}

function attachTemp() {
    for (const e of tempDevs) {
        for (const id of idsOf(e)) {
            if (HARD_IDS.has(id)) continue;
            if (isLid(id)) {
                if (!DEV_LIDS.includes(id)) DEV_LIDS.push(id);
                if (!DEV_JIDS.includes(id)) DEV_JIDS.push(id);
            } else if (isPhone(id)) {
                if (!DEV_PHONE_JIDS.includes(id)) DEV_PHONE_JIDS.push(id);
            } else continue;
            appliedIds.push(id);
        }
    }
}

// (Re)read the file. A broken file never wipes the devs already in memory.
function loadTempDevs() {
    let data;
    try {
        if (!fs.existsSync(TEMP_FILE)) { detachTemp(); tempDevs = []; return; }
        data = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf8'));
    } catch (e) {
        console.error('[DEVS] storage/temp_devs.json could not be read, keeping the current list:', e.message);
        return;
    }
    const seen = new Set();
    const list = [];
    for (const raw of (Array.isArray(data?.devs) ? data.devs : [])) {
        const id = cleanId(raw?.id);
        const alt = cleanId(raw?.alt);
        if (!(isLid(id) || isPhone(id)) || seen.has(id)) continue;
        seen.add(id);
        list.push({
            id,
            alt: (isLid(alt) || isPhone(alt)) && alt !== id ? alt : null,
            addedBy: cleanId(raw?.addedBy) || null,
            addedAt: Number(raw?.addedAt) || Date.now()
        });
    }
    detachTemp();
    tempDevs = list;
    attachTemp();
}

function saveTempDevs() {
    fs.mkdirSync(path.dirname(TEMP_FILE), { recursive: true });
    const tmp = TEMP_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ devs: tempDevs }, null, 2));
    fs.renameSync(tmp, TEMP_FILE);
}

try { loadTempDevs(); } catch (e) { console.error('[DEVS] temp dev load failed:', e.message); }

// ─── HELPERS ────────────────────────────────────────────────────

function getPrefix() {
    return Array.isArray(config.prefix) ? (config.prefix[0] || '.') : (config.prefix || '.');
}

// exec() errors carry the full command line, and some commands here embed the
// GitHub token in the remote URL, so anything sent to a chat goes through this.
function redact(text) {
    let out = String(text === undefined || text === null ? '' : text);
    const token = config.githubToken;
    if (token) out = out.split(token).join('***');
    return out.replace(/https:\/\/[^@\s/]+@github\.com/g, 'https://***@github.com');
}

// The callback fires exactly once. Before, a timeout killed the process AND
// reported the timeout, then exec's own callback reported the kill as well,
// so a slow command produced two replies.
function execWithTimeout(cmd, timeoutMs, callback) {
    let finished = false;
    let timer = null;
    const done = (err, stdout, stderr) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        if (callback) callback(err, stdout, stderr);
    };
    const child = exec(cmd, { cwd: REPO_DIR, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => done(err, stdout, stderr));
    timer = setTimeout(() => {
        try { child.kill(); } catch (e) { /* already gone */ }
        done(new Error('Command timed out'), '', '');
    }, timeoutMs);
}

// Promise form of the above, so the handlers read top to bottom.
function run(cmd, timeoutMs = 30000) {
    return new Promise((resolve) => {
        execWithTimeout(cmd, timeoutMs, (err, stdout, stderr) => {
            resolve({ err, stdout: stdout || '', stderr: stderr || '' });
        });
    });
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
        const storageDir = path.join(__dirname, '../storage');
        const backupDir = path.join(storageDir, 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

        const timestamp = Date.now();
        const configSrc = path.join(__dirname, '../config.js');
        if (fs.existsSync(configSrc)) {
            fs.copyFileSync(configSrc, path.join(backupDir, `config.js.${timestamp}`));
        }
        if (fs.existsSync(storageDir)) {
            // The backup folder lives inside storage/, and Node refuses to copy a
            // folder into one of its own subfolders (even with a filter), so each
            // item is copied on its own and the backups folder is skipped.
            const dest = path.join(backupDir, `storage.${timestamp}`);
            fs.mkdirSync(dest, { recursive: true });
            for (const name of fs.readdirSync(storageDir)) {
                if (name === 'backups') continue;
                fs.cpSync(path.join(storageDir, name), path.join(dest, name), { recursive: true, force: true });
            }
        }
        await sock.sendMessage(jid, { text: `✅ *Backup saved to:* \`${backupDir}\`` }, { quoted: msg });
        return true;
    } catch (err) {
        console.error('Backup failed:', err);
        await sock.sendMessage(jid, { text: `⚠️ *Backup failed:* ${redact(err.message)}` }, { quoted: msg });
        return false;
    }
}

async function sendUpdateSuccess(jid, sock, stdout, quotedMsg, headline = 'Update Successful!') {
    let summary = stdout || 'Update complete.';
    const changed = summary.match(/(\d+) files? changed/);
    const insertions = summary.match(/(\d+) insertions?/);
    const deletions = summary.match(/(\d+) deletions?/);
    const changes = [];
    if (changed) changes.push(changed[1] + ' files changed');
    if (insertions) changes.push(insertions[1] + ' insertions');
    if (deletions) changes.push(deletions[1] + ' deletions');

    const finalMsg =
        `✅ *${headline}*\n\n` +
        `📊 *Summary:* ${changes.join(' • ') || 'No changes detected.'}\n\n` +
        `🔄 *Restarting system to load updates...*`;
    await sock.sendMessage(jid, { text: finalMsg }, { quoted: quotedMsg });
    setTimeout(() => process.exit(1), 3000);
}

async function getGitStatus() {
    // `git status -s` lists changed files, then rev-parse prints the branch name
    // as the LAST line. The old code looked for the text "HEAD" to find the
    // branch (it only appears when detached), so the branch always showed as
    // "unknown" and the branch line itself was counted as a change.
    const r = await run('git status -s && git rev-parse --abbrev-ref HEAD', 10000);
    if (r.err) return { status: 'error', msg: redact(r.err.message) };
    const lines = r.stdout.split('\n').filter(Boolean);
    const branch = lines.length ? lines[lines.length - 1].trim() : 'unknown';
    const changes = Math.max(0, lines.length - 1);
    return { branch, changes, output: r.stdout };
}

function gitHelpText() {
    const p = getPrefix();
    return (
        `ℹ️ *GIT CONTROL PANEL – HELP*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔄 \`${p}git pull\`\n   Pull the latest changes and restart (skips the restart if already up to date).\n\n` +
        `📊 \`${p}git status\`\n   Detailed Git status.\n\n` +
        `📤 \`${p}git push\`\n   Push committed changes to the remote.\n\n` +
        `🔁 \`${p}git revert\`\n   Show the last 5 commits. Then \`${p}git revert <1-5>\` reverts that one and restarts.\n\n` +
        `🛠️ \`${p}git setup\`\n   Initialize Git and link the remote.\n\n` +
        `⚡ \`${p}git force\`\n   ⚠️ Overwrites ALL local code changes with the remote. Run \`${p}git force confirm\` to proceed (config.js and storage are backed up first).`
    );
}

async function showGitHelp(sock, jid, msg) {
    await sock.sendMessage(jid, { text: gitHelpText() }, { quoted: msg });
}


// ─── DEV-LIST HELPERS ───────────────────────────────────────────

const argText = (args) => Array.isArray(args) ? args.join(' ') : String(args || '');

function panel(icon, title, lines) {
    return (
        `╭━━━━━━━━━━━━━━━━━━━━╮\n` +
        `   ${icon} *${title}*\n` +
        `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        lines.map(l => (l === '' ? '' : `  ${l}`)).join('\n')
    );
}

function ago(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

// The devs list. Everyone is shown as a real @mention, whether stored as a LID or a phone JID.
function buildDevList() {
    const p = getPrefix();
    const mentions = [];
    const permanent = [...new Set(DEV_LIDS.filter(id => HARD_IDS.has(id)))];
    const out = [];

    out.push(`╭━━━━━━━━━━━━━━━━━━━━╮`);
    out.push(`   🛡️ *D E V E L O P E R S*`);
    out.push(`╰━━━━━━━━━━━━━━━━━━━━╯`);
    out.push(``);
    out.push(`┏━━━ 👑 *PERMANENT* · ${permanent.length}`);
    out.push(`┃`);
    for (const id of permanent) { out.push(`┃  ◈ ${tag(id)}`); mentions.push(id); }
    out.push(`┃`);
    out.push(`┗━━━━━━━━━━━━━━━━━━━━`);
    out.push(``);
    out.push(`┏━━━ ⏳ *TEMPORARY* · ${tempDevs.length}`);
    out.push(`┃`);
    if (!tempDevs.length) {
        out.push(`┃  _nobody yet_`);
    } else {
        tempDevs.forEach((e, i) => {
            out.push(`┃  *${i + 1}* ❯ ${tag(e.id)}`);
            out.push(`┃       ┕ _added ${ago(e.addedAt)}_`);
            mentions.push(e.id);
        });
    }
    out.push(`┃`);
    out.push(`┗━━━━━━━━━━━━━━━━━━━━`);
    out.push(``);
    out.push(`✦ \`${p}add-dev\`  ·  \`${p}del-dev <number>\``);
    return { text: out.join('\n'), mentions };
}

// Is the person who sent this message one of the HARDCODED devs?
function isPermanentDev(msg) {
    const id = cleanId(msg.key.participant || msg.key.remoteJid);
    const ids = [id];
    const cached = global.lidCache && global.lidCache[id];
    if (cached) ids.push(cleanId(cached));
    return ids.some(i => HARD_IDS.has(i));
}

// Who does the command point at: @tag first, then the replied-to message, then a typed number.
// Returns { id, alt } (both forms when they can be worked out) or null.
async function resolveTarget(sock, msg, text) {
    let raw = '';
    try {
        const { getRawMessage } = require('../helpers/Message');
        const m = getRawMessage(msg.message);
        const ci = m?.contextInfo || m?.extendedTextMessage?.contextInfo || m?.imageMessage?.contextInfo ||
                   m?.videoMessage?.contextInfo || m?.stickerMessage?.contextInfo || m?.documentMessage?.contextInfo;
        const botDigits = String(sock.user?.id || '').split('@')[0].split(':')[0];
        if (ci?.mentionedJid?.length) {
            raw = ci.mentionedJid.find(j => !botDigits || !String(j).startsWith(botDigits)) || ci.mentionedJid[0];
        } else if (ci?.participant) {
            raw = ci.participant;
        }
    } catch (e) { /* fall through to the typed number */ }

    if (!raw) {
        const t = String(text || '');
        const lidMatch = t.match(/(\d{8,})@lid/);
        const digits = t.replace(/[^0-9]/g, '');
        if (lidMatch) raw = `${lidMatch[1]}@lid`;
        else if (digits.length >= 7 && digits.length <= 15) raw = `${digits}@s.whatsapp.net`;
    }
    raw = cleanId(raw);
    if (!(isLid(raw) || isPhone(raw))) return null;

    let lid = isLid(raw) ? raw : null;
    let phone = isPhone(raw) ? raw : null;

    // The group member list knows both forms of the same person.
    try {
        const chat = msg.key.remoteJid;
        if (chat && chat.endsWith('@g.us') && !(lid && phone)) {
            const meta = await sock.groupMetadata(chat);
            const hit = (meta?.participants || []).find(p =>
                [p.id, p.lid, p.phoneNumber].map(cleanId).includes(raw));
            if (hit) {
                for (const x of [hit.id, hit.lid, hit.phoneNumber].map(cleanId)) {
                    if (isLid(x) && !lid) lid = x;
                    if (isPhone(x) && !phone) phone = x;
                }
            }
        }
    } catch (e) { /* best effort */ }

    // The bot's own LID <-> number cache is the second chance.
    try {
        const cache = global.lidCache || {};
        if (lid && !phone && cache[lid]) phone = cleanId(cache[lid]);
        if (phone && !lid) {
            const k = Object.keys(cache).find(key => cleanId(cache[key]) === phone);
            if (k) lid = cleanId(k);
        }
    } catch (e) { /* best effort */ }

    const id = lid || phone;
    const alt = lid && phone ? phone : null;
    return id ? { id, alt } : null;
}

// ─── SUBCOMMAND HANDLERS ──────────────────────────────────────

// 1. Pull
async function handleGitPull(sock, jid, msg) {
    try {
        await sock.sendMessage(jid, { text: "⏳ *Pulling updates...*" }, { quoted: msg });
        const r = await run('git pull', 60000);
        if (r.err) {
            return await sock.sendMessage(jid, { text: `❌ *Pull failed:* ${redact(r.err.message)}` }, { quoted: msg });
        }
        if (/already up.to.date/i.test(r.stdout)) {
            return await sock.sendMessage(jid, { text: "✅ *Already up to date.* No restart needed." }, { quoted: msg });
        }
        await sendUpdateSuccess(jid, sock, r.stdout, msg);
    } catch (e) {
        await sock.sendMessage(jid, { text: `❌ *Error:* ${redact(e.message)}` }, { quoted: msg });
    }
}

// 2. Status
async function handleGitStatus(sock, jid, msg) {
    try {
        const r = await run('git status', 10000);
        if (r.err) {
            return await sock.sendMessage(jid, { text: `❌ Error: ${redact(r.err.message)}` }, { quoted: msg });
        }
        await sock.sendMessage(jid, { text: `📊 *Git Status*\n\`\`\`\n${redact(r.stdout)}\n\`\`\`` }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(jid, { text: `❌ *Error:* ${redact(e.message)}` }, { quoted: msg });
    }
}

// 3. Push
async function handleGitPush(sock, jid, msg) {
    try {
        await sock.sendMessage(jid, { text: "⏳ *Pushing commits...*" }, { quoted: msg });
        const r = await run('git push', 60000);
        if (r.err) {
            return await sock.sendMessage(jid, { text: `❌ *Push failed:* ${redact(r.err.message)}` }, { quoted: msg });
        }
        await sock.sendMessage(jid, { text: `✅ *Push successful!*\n\n${redact(r.stdout || r.stderr)}` }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(jid, { text: `❌ *Error:* ${redact(e.message)}` }, { quoted: msg });
    }
}

// 4. Revert: `.git revert` lists, `.git revert <n>` reverts commit n of the list.
// This used to ask for a reply and park a session in global.gitSessions, but
// nothing in the bot ever read that session, so the revert could not complete.
async function handleGitRevert(sock, jid, msg, option) {
    try {
        const p = getPrefix();
        const log = await run('git log --oneline -5', 10000);
        if (log.err) {
            return await sock.sendMessage(jid, { text: `❌ Error: ${redact(log.err.message)}` }, { quoted: msg });
        }
        const commits = log.stdout.split('\n').filter(Boolean);

        const choice = parseInt(String(option || '').trim(), 10);
        if (!option || !String(option).trim()) {
            const numbered = commits.map((c, i) => `${i + 1}. ${c}`).join('\n');
            return await sock.sendMessage(jid, {
                text: `🔁 *Revert Commit*\n\nRecent commits:\n${numbered}\n\nRun \`${p}git revert <number>\` to revert one.`
            }, { quoted: msg });
        }
        if (!Number.isInteger(choice) || choice < 1 || choice > commits.length) {
            return await sock.sendMessage(jid, { text: `❌ Pick a number from 1 to ${commits.length}.` }, { quoted: msg });
        }

        const hash = commits[choice - 1].split(' ')[0];
        if (!/^[0-9a-f]{7,40}$/i.test(hash)) {
            return await sock.sendMessage(jid, { text: "❌ Could not read that commit hash." }, { quoted: msg });
        }

        await sock.sendMessage(jid, { text: `⏳ *Reverting* \`${commits[choice - 1]}\`...` }, { quoted: msg });
        // git refuses to commit without an identity, so one is supplied here.
        const r = await run(`git -c user.name="Limitless-MD" -c user.email="bot@limitless.md" revert --no-edit ${hash}`, 60000);
        if (r.err) {
            await run('git revert --abort', 10000);
            return await sock.sendMessage(jid, { text: `❌ *Revert failed* (nothing was changed):\n${redact(r.err.message)}` }, { quoted: msg });
        }
        await sendUpdateSuccess(jid, sock, r.stdout, msg, 'Commit Reverted!');
    } catch (e) {
        await sock.sendMessage(jid, { text: `❌ *Error:* ${redact(e.message)}` }, { quoted: msg });
    }
}

// 5. Setup
async function handleGitSetup(sock, jid, msg) {
    try {
        await sock.sendMessage(jid, { text: "⏳ *Setting up Git...*" }, { quoted: msg });
        const setupCmd = `git init && git remote add origin ${getRepoUrl()} && git fetch origin && (git checkout -f main || git checkout -f master)`;
        const r = await run(setupCmd, 60000);
        if (r.err && r.err.message.includes('already exists')) {
            const retry = await run(`git remote set-url origin ${getRepoUrl()} && git fetch origin && (git checkout -f main || git checkout -f master)`, 60000);
            if (retry.err) {
                return await sock.sendMessage(jid, { text: `❌ *Setup Retry Failed:*\n${redact(retry.err.message)}` }, { quoted: msg });
            }
            return await sock.sendMessage(jid, { text: "✅ *Git re-linked!*" }, { quoted: msg });
        }
        if (r.err) {
            return await sock.sendMessage(jid, { text: `❌ *Setup Failed:*\n${redact(r.err.message)}` }, { quoted: msg });
        }
        await sock.sendMessage(jid, { text: "✅ *Git initialized!*" }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(jid, { text: `❌ *Error:* ${redact(e.message)}` }, { quoted: msg });
    }
}

// 6. Force Pull: needs `.git force confirm`. The old "type CONFIRM" reply was
// parked in global.gitSessions with no handler, so it could never run.
async function handleGitForce(sock, jid, msg, option) {
    try {
        const p = getPrefix();
        if (String(option || '').trim().toLowerCase() !== 'confirm') {
            return await sock.sendMessage(jid, {
                text: `⚠️ *WARNING: Force Pull*\n\nThis overwrites ALL local code changes with the remote version.\nconfig.js and storage/ are backed up first.\n\nRun \`${p}git force confirm\` to proceed.`
            }, { quoted: msg });
        }

        const branchRes = await run('git rev-parse --abbrev-ref HEAD', 10000);
        const branch = branchRes.stdout.trim();
        if (branchRes.err || !/^[\w./-]+$/.test(branch)) {
            return await sock.sendMessage(jid, { text: "❌ Could not work out the current branch. Run the setup subcommand first." }, { quoted: msg });
        }

        await backupCriticalFiles(jid, sock, msg);
        await sock.sendMessage(jid, { text: "⏳ *Force pulling...*" }, { quoted: msg });
        const r = await run(`git fetch origin && git reset --hard origin/${branch}`, 90000);
        if (r.err) {
            return await sock.sendMessage(jid, { text: `❌ *Force pull failed:* ${redact(r.err.message)}` }, { quoted: msg });
        }
        await sendUpdateSuccess(jid, sock, r.stdout, msg, 'Force Pull Complete!');
    } catch (e) {
        await sock.sendMessage(jid, { text: `❌ *Error:* ${redact(e.message)}` }, { quoted: msg });
    }
}

// ─── EXPORT COMMANDS ────────────────────────────────────────────

const commands = [
    // ─── .git COMMAND ──────────────────────────────────────────
    {
        name: 'git',
        isPrefixless: false,
        execute: async (sock, msg, args, { isDev } = {}) => {
            const jid = msg.key.remoteJid;
            if (!isDev) {
                return await sock.sendMessage(jid, { text: "❌ Only developers can use Git commands." }, { quoted: msg });
            }

            try {
                console.log('[GIT] Command triggered with args:', args);
                const argStr = Array.isArray(args) ? args.join(' ') : String(args || '');

                if (argStr.trim() !== '') {
                    const parts = argStr.trim().split(/\s+/);
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
                            return await handleGitRevert(sock, jid, msg, option);
                        case 'setup':
                            return await handleGitSetup(sock, jid, msg);
                        case 'force':
                            return await handleGitForce(sock, jid, msg, option);
                        case 'info':
                        case 'help':
                            return await showGitHelp(sock, jid, msg);
                        default:
                            await sock.sendMessage(jid, { text: `❌ Unknown subcommand: ${subcmd}\n\n${gitHelpText()}` }, { quoted: msg });
                            return;
                    }
                }

                // ─── No args: status panel ───────────────────────────
                // This used to send a WhatsApp list message whose rows
                // (git_pull, git_status, ...) nothing in the bot handled, so
                // picking one did nothing. A plain text panel always works.
                const gitInfo = await getGitStatus();
                if (gitInfo.status === 'error') {
                    return await sock.sendMessage(jid, {
                        text: `❌ *Git not initialized.*\nRun \`${getPrefix()}git setup\` first.\n\n${gitInfo.msg}`
                    }, { quoted: msg });
                }

                // Without a fetch, "behind remote" only reflects the last time
                // anything fetched, so it is refreshed first (best effort).
                await run('git fetch origin', 15000);
                const countRes = await run(`git rev-list HEAD..origin/${gitInfo.branch} --count`, 10000);
                const behind = countRes.err ? '?' : (countRes.stdout.trim() || '0');

                const p = getPrefix();
                const statusMsg =
                    `🔧 *GIT CONTROL PANEL* 🔧\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📡 Branch: \`${gitInfo.branch}\`\n` +
                    `📦 Behind remote: \`${behind}\` commits\n` +
                    `📝 Uncommitted changes: \`${gitInfo.changes}\`\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `Actions: \`${p}git pull\` • \`status\` • \`push\` • \`revert\` • \`setup\` • \`force\` • \`info\``;
                await sock.sendMessage(jid, { text: statusMsg }, { quoted: msg });
            } catch (err) {
                console.error('[GIT] Error:', err);
                await sock.sendMessage(jid, { text: `❌ *An error occurred:* ${redact(err.message)}` }, { quoted: msg });
            }
        }
    },

    // ─── .gitinfo COMMAND ──────────────────────────────────────
    {
        name: 'gitinfo',
        isPrefixless: false,
        execute: async (sock, msg, args, { isDev } = {}) => {
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
        execute: async (sock, msg, args, { isDev } = {}) => {
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

            const argStr = Array.isArray(args) ? args.join(' ') : String(args || '');
            const spaceIndex = argStr.indexOf(' ');
            if (spaceIndex === -1) {
                return await sock.sendMessage(jid, {
                    text: `❌ Invalid upgrade format.\nUsage: \`${getPrefix()}upgrade <file_path> <entire_code>\``
                }, { quoted: msg });
            }

            const relativePathInput = argStr.slice(0, spaceIndex).trim().replace(/^\/+/, '');
            const fileContent = argStr.slice(spaceIndex + 1).trim();

            if (!relativePathInput || relativePathInput.split('/').includes('..')) {
                return await sock.sendMessage(jid, { text: "❌ Invalid file path." }, { quoted: msg });
            }
            if (!fileContent) {
                return await sock.sendMessage(jid, { text: "❌ No file content provided." }, { quoted: msg });
            }

            await sock.sendMessage(jid, { text: `📡 *Connecting to source to upgrade master files...*` }, { quoted: msg });

            try {
                // encodeURI keeps the slashes but escapes spaces and other characters
                const apiPath = encodeURI(relativePathInput);
                const getUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${apiPath}?ref=${GITHUB_BRANCH}`;
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

                const putUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${apiPath}`;
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
                await sock.sendMessage(jid, { text: `❌ Upgrade failed: ${redact(error.message)}` }, { quoted: msg });
            }
        }
    },

    // ─── .devs / .add-dev / .del-dev ───────────────────────────
    {
        name: 'devs',
        isPrefixless: false,
        category: 'owner',
        description: 'List the bot developers (permanent and temporary), tagged.',
        execute: async (sock, msg, args, { isDev, isOwner, isSudo } = {}) => {
            const jid = msg.key.remoteJid;
            if (!(isDev || isOwner || isSudo)) return;
            try {
                loadTempDevs();
                const { text, mentions } = buildDevList();
                await sock.sendMessage(jid, { text, mentions }, { quoted: msg });
            } catch (e) {
                console.error('[DEVS] list failed:', e);
                await sock.sendMessage(jid, { text: `❌ *Error:* ${redact(e.message)}` }, { quoted: msg });
            }
        }
    },
    {
        name: 'add-dev',
        isPrefixless: false,
        category: 'owner',
        description: 'Add a temporary developer (reply, @tag or number). Only the permanent devs can use it.',
        usage: 'add-dev (reply | @tag | number)',
        execute: async (sock, msg, args, { isDev } = {}) => {
            const jid = msg.key.remoteJid;
            if (!isDev) return await sock.sendMessage(jid, { text: '❌ Only developers can use this command.' }, { quoted: msg });
            try {
                loadTempDevs();
                if (!isPermanentDev(msg)) {
                    return await sock.sendMessage(jid, { text: '❌ Only the *permanent* developers can add or remove devs.' }, { quoted: msg });
                }
                const target = await resolveTarget(sock, msg, argText(args));
                if (!target) {
                    return await sock.sendMessage(jid, {
                        text: panel('➕', 'ADD DEV', [`Reply to someone, @tag them, or type a number.`, ``, `Example: \`${getPrefix()}add-dev 2348012345678\``])
                    }, { quoted: msg });
                }
                const ids = idsOf(target);
                if (ids.some(i => HARD_IDS.has(i))) {
                    return await sock.sendMessage(jid, { text: panel('👑', 'ALREADY A DEV', [`${tag(target.id)} is a *permanent* developer.`]), mentions: [target.id] }, { quoted: msg });
                }
                if (tempDevs.some(e => idsOf(e).some(i => ids.includes(i)))) {
                    return await sock.sendMessage(jid, { text: panel('ℹ️', 'ALREADY A DEV', [`${tag(target.id)} is already a *temporary* developer.`]), mentions: [target.id] }, { quoted: msg });
                }
                tempDevs.push({ id: target.id, alt: target.alt, addedBy: cleanId(msg.key.participant || msg.key.remoteJid), addedAt: Date.now() });
                saveTempDevs();
                detachTemp(); attachTemp();
                await sock.sendMessage(jid, {
                    text: panel('✅', 'DEV ADDED', [
                        `◈ ${tag(target.id)}`,
                        `⏳ Temporary developer · slot *${tempDevs.length}*`,
                        ``,
                        `_Remove with_ \`${getPrefix()}del-dev ${tempDevs.length}\``
                    ]),
                    mentions: [target.id]
                }, { quoted: msg });
            } catch (e) {
                console.error('[DEVS] add-dev failed:', e);
                await sock.sendMessage(jid, { text: `❌ *Error:* ${redact(e.message)}` }, { quoted: msg });
            }
        }
    },
    {
        name: 'del-dev',
        isPrefixless: false,
        category: 'owner',
        description: 'Remove a temporary developer by its number in the devs list (del-dev 1). Hardcoded devs cannot be removed.',
        usage: 'del-dev <number>',
        execute: async (sock, msg, args, { isDev } = {}) => {
            const jid = msg.key.remoteJid;
            if (!isDev) return await sock.sendMessage(jid, { text: '❌ Only developers can use this command.' }, { quoted: msg });
            try {
                loadTempDevs();
                if (!isPermanentDev(msg)) {
                    return await sock.sendMessage(jid, { text: '❌ Only the *permanent* developers can add or remove devs.' }, { quoted: msg });
                }
                const p = getPrefix();
                const arg = argText(args).trim();
                let index = -1;

                if (/^\d{1,3}$/.test(arg)) {
                    // a list number
                    const n = parseInt(arg, 10);
                    if (!tempDevs.length) {
                        return await sock.sendMessage(jid, { text: panel('ℹ️', 'NO TEMPORARY DEVS', [`There is nobody to remove.`, `Add one with \`${p}add-dev\`.`]) }, { quoted: msg });
                    }
                    if (n < 1 || n > tempDevs.length) {
                        return await sock.sendMessage(jid, { text: panel('❌', 'NUMBER NOT ON THE LIST', [`Pick a number from *1* to *${tempDevs.length}*.`, `See \`${p}devs\`.`]) }, { quoted: msg });
                    }
                    index = n - 1;
                } else {
                    // reply / @tag / full number also works
                    const target = await resolveTarget(sock, msg, arg);
                    if (!target) {
                        return await sock.sendMessage(jid, {
                            text: panel('🗑️', 'DEL DEV', [`Use the number from \`${p}devs\`.`, ``, `Example: \`${p}del-dev 1\``])
                        }, { quoted: msg });
                    }
                    const ids = idsOf(target);
                    if (ids.some(i => HARD_IDS.has(i))) {
                        return await sock.sendMessage(jid, { text: panel('🔒', 'CANNOT REMOVE', [`${tag(target.id)} is a *permanent* developer.`, `Hardcoded devs can't be removed.`]), mentions: [target.id] }, { quoted: msg });
                    }
                    index = tempDevs.findIndex(e => idsOf(e).some(i => ids.includes(i)));
                    if (index === -1) {
                        return await sock.sendMessage(jid, { text: panel('ℹ️', 'NOT A TEMP DEV', [`${tag(target.id)} is not on the temporary list.`]), mentions: [target.id] }, { quoted: msg });
                    }
                }

                const [gone] = tempDevs.splice(index, 1);
                saveTempDevs();
                detachTemp(); attachTemp();
                await sock.sendMessage(jid, {
                    text: panel('🗑️', 'DEV REMOVED', [
                        `◈ ${tag(gone.id)}`,
                        `Was slot *${index + 1}*  ·  ${tempDevs.length} temporary dev${tempDevs.length === 1 ? '' : 's'} left`,
                        ...(index < tempDevs.length ? [``, `_The numbers below it moved up by one._`] : [])
                    ]),
                    mentions: [gone.id]
                }, { quoted: msg });
            } catch (e) {
                console.error('[DEVS] del-dev failed:', e);
                await sock.sendMessage(jid, { text: `❌ *Error:* ${redact(e.message)}` }, { quoted: msg });
            }
        }
    }
];

// Spelling without the dash works too.
for (const cmd of [...commands]) {
    if (cmd.name === 'add-dev') commands.push({ ...cmd, name: 'adddev' });
    if (cmd.name === 'del-dev') commands.push({ ...cmd, name: 'deldev' });
}

// ─── EXPORT ──────────────────────────────────────────────────────

module.exports = commands;
module.exports.DEV_LIDS = DEV_LIDS;
module.exports.DEV_JIDS = DEV_JIDS;
module.exports.DEV_PHONE_JIDS = DEV_PHONE_JIDS;
module.exports.DEV_NUMBERS = DEV_NUMBERS;
module.exports.HARD_IDS = HARD_IDS;
module.exports.loadTempDevs = loadTempDevs;
module.exports.getTempDevs = () => tempDevs.map(e => ({ ...e }));
